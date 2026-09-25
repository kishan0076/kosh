import { Router, type Request } from "express";
import { z } from "zod";
import { canGrantExpiry, driveHasTextSource, EXPIRY_ROLES } from "@kosh/shared";
import { getStore, type DriveAccountDoc } from "../db/index.js";
import { aiAvailable, AiBudgetError, AiNotConfiguredError } from "../integrations/claude.js";
import { nlToDriveQuery, prioritizeCleanup, summarizeDriveFile } from "../integrations/driveAi.js";
import { AppError, ah, badRequest, forbidden, notFound } from "../errors.js";
import { requireWrite } from "../auth/middleware.js";
import { decryptSecret } from "../auth/crypto.js";
import { GoogleAuthError, GoogleTransientError } from "../integrations/googleDrive.js";
import { accessTokenFor, invalidateAccessToken } from "../integrations/driveTokenCache.js";
import {
  copyNode,
  createComment,
  createFolderV2,
  createPermission,
  createReply,
  deleteNode,
  deletePermission,
  deleteRevision,
  emptyTrash,
  fetchFileTextServer,
  folderPath,
  getFile,
  getStartPageToken,
  GoogleBadRequestError,
  GoogleForbiddenError,
  GoogleGoneError,
  listChanges,
  listChildren,
  listComments,
  listDrives,
  listPermissions,
  listRecent,
  listRevisions,
  listSharedWithMe,
  listStarred,
  listTrash,
  moveNode,
  renameNode,
  scanFiles,
  searchFiles,
  setStarred,
  setTrashed,
  updateMeta,
  updatePermission,
  updateRevision,
  type ViewOpts,
} from "../integrations/googleDriveV2.js";
import { addSubscriber, ensureWatch, handleNotification, pushEnabled, removeSubscriber } from "../integrations/driveV2Push.js";

/**
 * Google Drive V2 router — full-CRUD "control center". SEPARATE from routes/drive.ts (V1), which is
 * left untouched. Reuses the same accounts + refresh-token store; the tiny ownership/token helpers are
 * duplicated here on purpose so V1 needs no edits. Every route is owner-scoped and proxies a Drive
 * call with a short-lived access token — file BYTES never flow through here (that's the V1 uploader).
 */
export const driveV2Router: Router = Router();

const nowIso = () => new Date().toISOString();
const FILE_ID = /^[A-Za-z0-9_-]{5,256}$/; // Drive ids (and "root" handled separately)

async function ownedAccount(uid: string, id: string): Promise<DriveAccountDoc> {
  const acc = await getStore().driveAccounts.findById(id);
  if (!acc || acc.userId !== uid) throw notFound("Google account not found.");
  return acc;
}

function mapGoogleError(err: unknown): never {
  if (err instanceof GoogleAuthError) throw badRequest("NEEDS_RECONNECT", err.message);
  if (err instanceof GoogleForbiddenError) throw forbidden(err.message);
  if (err instanceof GoogleBadRequestError) throw badRequest("DRIVE_BAD_REQUEST", err.message);
  // Preserve 410 so the client's sync poller re-anchors its page token instead of retrying a dead one.
  if (err instanceof GoogleGoneError) throw new AppError("PAGE_TOKEN_GONE", err.message, 410);
  if (err instanceof GoogleTransientError) throw new AppError("UPSTREAM", err.message, 502);
  throw err;
}

/**
 * Run a Drive operation with the account's access token, re-minting once on a stale-token 401.
 *
 * A cached access token can die mid-life — Google rotates or revokes it before its stated ~1h expiry. The
 * first Drive call to hit a dead token gets a 401 (GoogleAuthError). Rather than kick the user to the
 * reconnect gate (the *refresh* token is almost always still valid), drop the cached access token, re-mint
 * once, and retry the SAME call so it self-heals transparently. Only a SECOND auth failure — or a refresh
 * failure (invalid_grant / real revocation, surfaced by tokenFor) — becomes NEEDS_RECONNECT.
 *
 * This is why search used to "expire" the account: My Drive browse is served from the folder cache and,
 * with SSE push active, the background poller idles — so search was often the first *uncached* Drive call
 * after the token quietly went stale, and its lone 401 nuked the whole account. A 401 means the request
 * was rejected, never applied, so the single retry is safe for mutations too.
 */
async function driveCall<T>(acc: DriveAccountDoc, run: (token: string) => Promise<T>): Promise<T> {
  try {
    return await run(await tokenFor(acc)); // tokenFor throws NEEDS_RECONNECT only when the refresh token is dead
  } catch (err) {
    if (!(err instanceof GoogleAuthError)) mapGoogleError(err); // 400/403-perm/410/transient → map straight through
    invalidateAccessToken(acc.id); // stale access token — drop it and retry once with a freshly minted one
    try {
      return await run(await tokenFor(acc));
    } catch (retryErr) {
      if (retryErr instanceof GoogleAuthError) invalidateAccessToken(acc.id);
      mapGoogleError(retryErr); // a second auth failure is a genuine reconnect
    }
  }
}

const lastUsedWrites = new Map<string, number>(); // accountId → last lastUsedAt write (throttle DB churn)
const LAST_USED_THROTTLE_MS = 5 * 60 * 1000;

async function tokenFor(acc: DriveAccountDoc): Promise<string> {
  const refresh = decryptSecret(acc.refreshToken);
  if (!refresh) throw badRequest("NEEDS_RECONNECT", "This Google account needs to be reconnected.");
  try {
    const accessToken = await accessTokenFor(acc.id, refresh); // cached ~1h; refreshes ~1min early
    // Throttle the lastUsedAt write — it was on the hot path of every read/poll. Best-effort, fire-and-forget.
    const now = Date.now();
    if (now - (lastUsedWrites.get(acc.id) ?? 0) > LAST_USED_THROTTLE_MS) {
      lastUsedWrites.set(acc.id, now);
      void getStore().driveAccounts.updateById(acc.id, { lastUsedAt: nowIso() }).catch(() => {});
    }
    return accessToken;
  } catch (err) {
    mapGoogleError(err);
  }
}

const fileId = (v: string): string => {
  if (v !== "root" && !FILE_ID.test(v)) throw badRequest("BAD_ID", "Invalid file id.");
  return v;
};

// Comment/reply ids use a slightly wider charset than file ids (they can contain '.'); still no path chars.
const SUB_ID = /^[A-Za-z0-9_.-]{1,256}$/;
const subId = (v: string, what: string): string => {
  if (!SUB_ID.test(v)) throw badRequest("BAD_ID", `Invalid ${what} id.`);
  return v;
};

/** Run an AI call, mapping the budget-cap primitives' errors to clean HTTP statuses. */
async function runAi<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof AiNotConfiguredError) throw new AppError("AI_OFF", e.message, 503);
    if (e instanceof AiBudgetError) throw new AppError("AI_CAP", e.message, 429);
    throw e;
  }
}

const AI_TEXT_CAP = 2_000_000; // don't read a huge binary text file server-side (native-doc exports are bounded)

/** Optional `?driveId=` — scopes a read to a Shared Drive (validated like a file id). */
const driveIdOf = (req: Request): string | undefined => {
  const v = req.query.driveId;
  if (typeof v !== "string" || !v) return undefined;
  if (!FILE_ID.test(v)) throw badRequest("BAD_ID", "Invalid Shared Drive id.");
  return v;
};

/* ── read: browse / search / recent / starred / trash / details / breadcrumb ── */

driveV2Router.get(
  "/drive-v2/accounts/:id/list",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const acc = await ownedAccount(uid, String(req.params.id));
    const parent = typeof req.query.parent === "string" && req.query.parent ? fileId(req.query.parent) : "root";
    const pageToken = typeof req.query.pageToken === "string" ? req.query.pageToken : undefined;
    const orderBy = typeof req.query.orderBy === "string" ? req.query.orderBy : undefined;
    res.json(await driveCall(acc, (token) => listChildren(token, parent, { pageToken, orderBy, driveId: driveIdOf(req) })));
  }),
);

driveV2Router.get(
  "/drive-v2/accounts/:id/search",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const acc = await ownedAccount(uid, String(req.params.id));
    const str = (v: unknown, n: number) => (typeof v === "string" && v ? v.slice(0, n) : undefined);
    res.json(
      await driveCall(acc, (token) =>
        searchFiles(token, {
          text: str(req.query.text, 200),
          mimeType: str(req.query.mimeType, 120),
          mimeContains: str(req.query.mimeContains, 60),
          owner: str(req.query.owner, 320),
          before: str(req.query.before, 40),
          after: str(req.query.after, 40),
          starred: req.query.starred === "true",
          pageToken: str(req.query.pageToken, 4096),
          driveId: driveIdOf(req),
        }),
      ),
    );
  }),
);

driveV2Router.get(
  "/drive-v2/accounts/:id/scan",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const acc = await ownedAccount(uid, String(req.params.id));
    const orderBy = typeof req.query.orderBy === "string" ? req.query.orderBy.slice(0, 60) : undefined;
    const pageCap = Math.min(Math.max(Number(req.query.cap) || 10, 1), 20);
    res.json(await driveCall(acc, (token) => scanFiles(token, { orderBy, pageCap, driveId: driveIdOf(req) })));
  }),
);

const viewRoute = (path: string, fn: (t: string, opts: ViewOpts) => Promise<unknown>) =>
  driveV2Router.get(
    path,
    ah(async (req, res) => {
      const uid = requireWrite(req);
      const acc = await ownedAccount(uid, String(req.params.id));
      const pageToken = typeof req.query.pageToken === "string" ? req.query.pageToken : undefined;
      res.json(await driveCall(acc, (token) => fn(token, { pageToken, driveId: driveIdOf(req) })));
    }),
  );
viewRoute("/drive-v2/accounts/:id/recent", listRecent);
viewRoute("/drive-v2/accounts/:id/starred", listStarred);
viewRoute("/drive-v2/accounts/:id/trash", listTrash);
viewRoute("/drive-v2/accounts/:id/shared", listSharedWithMe);

/* ── Shared Drives (space picker) ── */
driveV2Router.get(
  "/drive-v2/accounts/:id/drives",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const acc = await ownedAccount(uid, String(req.params.id));
    const pageToken = typeof req.query.pageToken === "string" ? req.query.pageToken : undefined;
    res.json(await driveCall(acc, (token) => listDrives(token, pageToken)));
  }),
);

/* ── change tracking (real-time two-way sync) ── */
driveV2Router.get(
  "/drive-v2/accounts/:id/changes/start",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const acc = await ownedAccount(uid, String(req.params.id));
    res.json({ startPageToken: await driveCall(acc, (token) => getStartPageToken(token, driveIdOf(req))) });
  }),
);
driveV2Router.get(
  "/drive-v2/accounts/:id/changes",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const acc = await ownedAccount(uid, String(req.params.id));
    const pageToken = typeof req.query.pageToken === "string" ? req.query.pageToken.slice(0, 4096) : "";
    if (!pageToken) throw badRequest("BAD_TOKEN", "A pageToken is required to list changes.");
    res.json(await driveCall(acc, (token) => listChanges(token, pageToken, driveIdOf(req))));
  }),
);

/* ── push sync (changes.watch → SSE) ── */

// Server-Sent Events: the browser opens this once and receives change batches pushed from the webhook.
driveV2Router.get(
  "/drive-v2/accounts/:id/events",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const acc = await ownedAccount(uid, String(req.params.id)); // 404s if not the caller's account
    if (!pushEnabled()) throw new AppError("PUSH_DISABLED", "Push sync isn't configured on this server.", 501);
    res.status(200);
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no"); // don't let a reverse proxy buffer the stream
    res.flushHeaders?.();
    res.write("retry: 10000\n\n");
    res.write(`data: ${JSON.stringify({ type: "ready" })}\n\n`);
    addSubscriber(acc.id, res);
    const heartbeat = setInterval(() => {
      try {
        res.write(": ping\n\n"); // comment frame keeps the connection alive through proxies
      } catch {
        /* closed */
      }
    }, 25_000);
    heartbeat.unref?.();
    // Register cleanup BEFORE the await: a disconnect during channel setup must still evict the
    // subscriber + heartbeat (otherwise the socket, timer and Google channel would leak forever).
    let closed = false;
    req.on("close", () => {
      closed = true;
      clearInterval(heartbeat);
      removeSubscriber(acc.id, res);
    });
    // Only claim push once a watch channel is CONFIRMED live. If it couldn't be created (unverified
    // webhook domain, token/quota error, transient 5xx), tell the client so it keeps polling and never
    // shows a false "Live" pill while receiving nothing.
    if (!closed) {
      const pushOk = await ensureWatch(acc.id, uid).catch(() => false);
      if (!closed) {
        try {
          res.write(`data: ${JSON.stringify({ type: pushOk ? "push-ready" : "push-unavailable" })}\n\n`);
        } catch {
          /* socket closed between the check and the write */
        }
      }
    }
  }),
);

// Google's webhook target: a headers-only ping. Unauthenticated (Google can't send a cookie) — it is
// validated by the per-channel X-Goog-Channel-Token inside handleNotification. Respond 200 fast, then
// poll + fan out asynchronously so Google doesn't time out and retry.
driveV2Router.post("/drive-v2/webhook/changes", (req, res) => {
  const h = {
    channelId: req.header("x-goog-channel-id"),
    token: req.header("x-goog-channel-token"),
    state: req.header("x-goog-resource-state"),
  };
  res.status(200).end();
  void handleNotification(h).catch(() => {});
});

driveV2Router.get(
  "/drive-v2/accounts/:id/files/:fileId",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const acc = await ownedAccount(uid, String(req.params.id));
    res.json({ file: await driveCall(acc, (token) => getFile(token, fileId(String(req.params.fileId)))) });
  }),
);

driveV2Router.get(
  "/drive-v2/accounts/:id/path",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const acc = await ownedAccount(uid, String(req.params.id));
    const folder = typeof req.query.folder === "string" && req.query.folder ? fileId(req.query.folder) : "root";
    res.json({ path: await driveCall(acc, (token) => folderPath(token, folder)) });
  }),
);

/* ── write: create / rename / star / trash / restore / meta / move / copy / delete ── */

driveV2Router.post(
  "/drive-v2/accounts/:id/folders",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const acc = await ownedAccount(uid, String(req.params.id));
    const body = z
      .object({
        name: z.string().min(1).max(255),
        parentId: z.string().min(1).max(256).default("root"),
        folderColorRgb: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
        description: z.string().max(1000).optional(),
      })
      .parse(req.body);
    res.status(201).json({ file: await driveCall(acc, (token) => createFolderV2(token, body)) });
  }),
);

driveV2Router.patch(
  "/drive-v2/accounts/:id/files/:fileId/rename",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const acc = await ownedAccount(uid, String(req.params.id));
    const { name } = z.object({ name: z.string().min(1).max(255) }).parse(req.body);
    res.json({ file: await driveCall(acc, (token) => renameNode(token, fileId(String(req.params.fileId)), name)) });
  }),
);

driveV2Router.patch(
  "/drive-v2/accounts/:id/files/:fileId/star",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const acc = await ownedAccount(uid, String(req.params.id));
    const { starred } = z.object({ starred: z.boolean() }).parse(req.body);
    res.json({ file: await driveCall(acc, (token) => setStarred(token, fileId(String(req.params.fileId)), starred)) });
  }),
);

driveV2Router.patch(
  "/drive-v2/accounts/:id/files/:fileId/trash",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const acc = await ownedAccount(uid, String(req.params.id));
    const { trashed } = z.object({ trashed: z.boolean() }).parse(req.body);
    res.json({ file: await driveCall(acc, (token) => setTrashed(token, fileId(String(req.params.fileId)), trashed)) });
  }),
);

driveV2Router.patch(
  "/drive-v2/accounts/:id/files/:fileId/meta",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const acc = await ownedAccount(uid, String(req.params.id));
    const patch = z
      .object({
        description: z.string().max(1000).optional(),
        folderColorRgb: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
        // App-private metadata (Kosh tags). A null value removes the key. Bounded to Drive's limits.
        appProperties: z
          .record(z.string().min(1).max(124), z.string().max(124).nullable())
          .refine((m) => Object.keys(m).length <= 30, "Too many properties")
          .optional(),
        // When true, readers/commenters lose the download/print/copy option.
        copyRequiresWriterPermission: z.boolean().optional(),
      })
      .parse(req.body);
    res.json({ file: await driveCall(acc, (token) => updateMeta(token, fileId(String(req.params.fileId)), patch)) });
  }),
);

driveV2Router.post(
  "/drive-v2/accounts/:id/files/:fileId/move",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const acc = await ownedAccount(uid, String(req.params.id));
    const { addParents, removeParents } = z
      .object({ addParents: z.array(z.string().min(1).max(256)).max(20).default([]), removeParents: z.array(z.string().min(1).max(256)).max(20).default([]) })
      .parse(req.body);
    res.json({ file: await driveCall(acc, (token) => moveNode(token, fileId(String(req.params.fileId)), addParents, removeParents)) });
  }),
);

driveV2Router.post(
  "/drive-v2/accounts/:id/files/:fileId/copy",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const acc = await ownedAccount(uid, String(req.params.id));
    const opts = z.object({ name: z.string().min(1).max(255).optional(), parents: z.array(z.string().min(1).max(256)).max(20).optional() }).parse(req.body);
    res.status(201).json({ file: await driveCall(acc, (token) => copyNode(token, fileId(String(req.params.fileId)), opts)) });
  }),
);

driveV2Router.delete(
  "/drive-v2/accounts/:id/files/:fileId",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const acc = await ownedAccount(uid, String(req.params.id));
    await driveCall(acc, (token) => deleteNode(token, fileId(String(req.params.fileId))));
    res.json({ ok: true });
  }),
);

driveV2Router.post(
  "/drive-v2/accounts/:id/empty-trash",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const acc = await ownedAccount(uid, String(req.params.id));
    await driveCall(acc, (token) => emptyTrash(token, driveIdOf(req)));
    res.json({ ok: true });
  }),
);

/* ── revisions (version history) ── */

driveV2Router.get(
  "/drive-v2/accounts/:id/files/:fileId/revisions",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const acc = await ownedAccount(uid, String(req.params.id));
    res.json({ revisions: await driveCall(acc, (token) => listRevisions(token, fileId(String(req.params.fileId)))) });
  }),
);

driveV2Router.patch(
  "/drive-v2/accounts/:id/files/:fileId/revisions/:revId",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const acc = await ownedAccount(uid, String(req.params.id));
    const { keepForever } = z.object({ keepForever: z.boolean() }).parse(req.body);
    res.json({ revision: await driveCall(acc, (token) => updateRevision(token, fileId(String(req.params.fileId)), String(req.params.revId), keepForever)) });
  }),
);

driveV2Router.delete(
  "/drive-v2/accounts/:id/files/:fileId/revisions/:revId",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const acc = await ownedAccount(uid, String(req.params.id));
    await driveCall(acc, (token) => deleteRevision(token, fileId(String(req.params.fileId)), String(req.params.revId)));
    res.json({ ok: true });
  }),
);

/* ── sharing / permissions ── */

const ROLE = z.enum(["reader", "commenter", "writer", "fileOrganizer", "organizer", "owner"]);

driveV2Router.get(
  "/drive-v2/accounts/:id/files/:fileId/permissions",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const acc = await ownedAccount(uid, String(req.params.id));
    res.json({ permissions: await driveCall(acc, (token) => listPermissions(token, fileId(String(req.params.fileId)))) });
  }),
);

driveV2Router.post(
  "/drive-v2/accounts/:id/files/:fileId/permissions",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const acc = await ownedAccount(uid, String(req.params.id));
    const body = z
      .object({
        role: ROLE,
        type: z.enum(["user", "group", "domain", "anyone"]),
        emailAddress: z.string().email().max(320).optional(),
        domain: z.string().max(255).optional(),
        allowFileDiscovery: z.boolean().optional(),
        sendNotificationEmail: z.boolean().optional(),
        message: z.string().max(2000).optional(),
        expirationTime: z.string().datetime().optional(),
      })
      .parse(req.body);
    if ((body.type === "user" || body.type === "group") && !body.emailAddress) throw badRequest("BAD_TARGET", "An email address is required to share with a person or group.");
    // Drive rejects expiry on link/domain grants and on manager/owner roles — fail fast with a clear reason.
    if (body.expirationTime && !canGrantExpiry(body.type, body.role)) {
      throw badRequest("BAD_EXPIRY", "An expiry can only be set for a specific person or group with Viewer, Commenter, or Editor access.");
    }
    res.status(201).json({ permission: await driveCall(acc, (token) => createPermission(token, fileId(String(req.params.fileId)), body)) });
  }),
);

driveV2Router.patch(
  "/drive-v2/accounts/:id/files/:fileId/permissions/:permId",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const acc = await ownedAccount(uid, String(req.params.id));
    const patch = z
      .object({
        role: ROLE.optional(),
        expirationTime: z.string().datetime().optional(),
        removeExpiration: z.boolean().optional(),
      })
      .refine((p) => p.role !== undefined || p.expirationTime !== undefined || p.removeExpiration === true, "Nothing to update.")
      .refine((p) => !(p.expirationTime && p.removeExpiration), "Set an expiry or clear it, not both.")
      // Setting an expiry must carry the role so the eligibility rule is enforced here, not just by Drive.
      // (We can't learn the grant's type without an extra round-trip; the client only offers expiry on
      // user/group grants, and the role gate below is the security-relevant half.)
      .refine((p) => !p.expirationTime || p.role !== undefined, "A role is required when setting an expiry.")
      .parse(req.body);
    if (patch.expirationTime && (!patch.role || !EXPIRY_ROLES.has(patch.role))) {
      throw badRequest("BAD_EXPIRY", "An expiry can only be set for Viewer, Commenter, or Editor access.");
    }
    res.json({ permission: await driveCall(acc, (token) => updatePermission(token, fileId(String(req.params.fileId)), String(req.params.permId), patch)) });
  }),
);

driveV2Router.delete(
  "/drive-v2/accounts/:id/files/:fileId/permissions/:permId",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const acc = await ownedAccount(uid, String(req.params.id));
    await driveCall(acc, (token) => deletePermission(token, fileId(String(req.params.fileId)), String(req.params.permId)));
    res.json({ ok: true });
  }),
);

/* ── comments / replies (Drive discussion threads) ── */

driveV2Router.get(
  "/drive-v2/accounts/:id/files/:fileId/comments",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const acc = await ownedAccount(uid, String(req.params.id));
    res.json({ comments: await driveCall(acc, (token) => listComments(token, fileId(String(req.params.fileId)))) });
  }),
);

driveV2Router.post(
  "/drive-v2/accounts/:id/files/:fileId/comments",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const acc = await ownedAccount(uid, String(req.params.id));
    const { content } = z.object({ content: z.string().trim().min(1).max(4000) }).parse(req.body);
    res.status(201).json({ comment: await driveCall(acc, (token) => createComment(token, fileId(String(req.params.fileId)), content)) });
  }),
);

driveV2Router.post(
  "/drive-v2/accounts/:id/files/:fileId/comments/:commentId/replies",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const acc = await ownedAccount(uid, String(req.params.id));
    const input = z
      .object({ content: z.string().trim().min(1).max(4000).optional(), action: z.enum(["resolve", "reopen"]).optional() })
      .refine((p) => p.content !== undefined || p.action !== undefined, "A reply needs text or an action.")
      .parse(req.body);
    res.status(201).json({
      reply: await driveCall(acc, (token) => createReply(token, fileId(String(req.params.fileId)), subId(String(req.params.commentId), "comment"), input)),
    });
  }),
);

/* ── AI: per-file summary + tag suggestions ── */

driveV2Router.post(
  "/drive-v2/accounts/:id/files/:fileId/summarize",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    // Fail fast before any Drive call when AI is off for this user, so we don't do wasted work.
    if (!(await aiAvailable(uid))) throw new AppError("AI_OFF", "AI isn't configured — add an API key in Settings.", 503);
    const acc = await ownedAccount(uid, String(req.params.id));
    const id = fileId(String(req.params.fileId));
    const node = await driveCall(acc, (token) => getFile(token, id));
    if (node.isFolder || !driveHasTextSource(node.mimeType)) {
      throw badRequest("NO_TEXT", "AI can only read documents, sheets, slides, and text files.");
    }
    // Only binary text files carry a real size; gate those up front (native-doc exports are byte-capped
    // inside fetchFileTextServer instead, since their size is unknown until fetched).
    if (node.size != null && node.size > AI_TEXT_CAP) throw badRequest("TOO_LARGE", "This file is too large to read for AI.");
    const text = await driveCall(acc, (token) => fetchFileTextServer(token, id, node.mimeType));
    if (!text || !text.trim()) throw badRequest("EMPTY", "This file has no readable text to summarize.");
    const result = await runAi(() => summarizeDriveFile(uid, { name: node.name, mimeType: node.mimeType, text }));
    if (!result.summary && result.suggestedTags.length === 0) throw new AppError("AI_FAILED", "The AI couldn't generate a summary right now — please try again.", 502);
    res.json(result);
  }),
);

/* ── AI: natural-language search (NL -> the Drive operator DSL parseDriveSearch understands) ── */

driveV2Router.post(
  "/drive-v2/accounts/:id/ai-search",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    if (!(await aiAvailable(uid))) throw new AppError("AI_OFF", "AI isn't configured — add an API key in Settings.", 503);
    // Pure LLM step (no Drive call) — the client runs the returned query through the normal search path.
    const { query, today } = z
      .object({ query: z.string().trim().min(1).max(500), today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() })
      .parse(req.body);
    res.json(await runAi(() => nlToDriveQuery(uid, query, today)));
  }),
);

/* ── AI: cleanup wizard — prioritize/explain the buckets the client detected (keys only, no file ids) ── */

driveV2Router.post(
  "/drive-v2/accounts/:id/ai-cleanup",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    if (!(await aiAvailable(uid))) throw new AppError("AI_OFF", "AI isn't configured — add an API key in Settings.", 503);
    const { buckets } = z
      .object({
        buckets: z
          .array(
            z.object({
              key: z.string().min(1).max(40),
              label: z.string().min(1).max(80),
              count: z.number().int().nonnegative(),
              bytes: z.number().nonnegative(),
              sampleNames: z.array(z.string().max(300)).max(8),
            }),
          )
          .max(10),
      })
      .parse(req.body);
    res.json(await runAi(() => prioritizeCleanup(uid, buckets)));
  }),
);
