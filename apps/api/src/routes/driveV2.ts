import { Router, type Request } from "express";
import { z } from "zod";
import { getStore, type DriveAccountDoc } from "../db/index.js";
import { AppError, ah, badRequest, forbidden, notFound } from "../errors.js";
import { requireWrite } from "../auth/middleware.js";
import { decryptSecret } from "../auth/crypto.js";
import { GoogleAuthError, GoogleTransientError, refreshAccessToken } from "../integrations/googleDrive.js";
import {
  copyNode,
  createFolderV2,
  createPermission,
  deleteNode,
  deletePermission,
  deleteRevision,
  emptyTrash,
  folderPath,
  getFile,
  getStartPageToken,
  GoogleBadRequestError,
  GoogleForbiddenError,
  listChanges,
  listChildren,
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
  if (err instanceof GoogleTransientError) throw new AppError("UPSTREAM", err.message, 502);
  throw err;
}

async function driveCall<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (err) {
    mapGoogleError(err);
  }
}

async function tokenFor(acc: DriveAccountDoc): Promise<string> {
  const refresh = decryptSecret(acc.refreshToken);
  if (!refresh) throw badRequest("NEEDS_RECONNECT", "This Google account needs to be reconnected.");
  try {
    const { accessToken } = await refreshAccessToken(refresh);
    await getStore().driveAccounts.updateById(acc.id, { lastUsedAt: nowIso() });
    return accessToken;
  } catch (err) {
    mapGoogleError(err);
  }
}

/** Resolve (owned account, access token) for a request in one step. */
async function auth(req: Request, uid: string): Promise<string> {
  const acc = await ownedAccount(uid, String(req.params.id));
  return tokenFor(acc);
}

const fileId = (v: string): string => {
  if (v !== "root" && !FILE_ID.test(v)) throw badRequest("BAD_ID", "Invalid file id.");
  return v;
};

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
    const token = await auth(req, uid);
    const parent = typeof req.query.parent === "string" && req.query.parent ? fileId(req.query.parent) : "root";
    const pageToken = typeof req.query.pageToken === "string" ? req.query.pageToken : undefined;
    const orderBy = typeof req.query.orderBy === "string" ? req.query.orderBy : undefined;
    res.json(await driveCall(listChildren(token, parent, { pageToken, orderBy, driveId: driveIdOf(req) })));
  }),
);

driveV2Router.get(
  "/drive-v2/accounts/:id/search",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const token = await auth(req, uid);
    const str = (v: unknown, n: number) => (typeof v === "string" && v ? v.slice(0, n) : undefined);
    res.json(
      await driveCall(
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
    const token = await auth(req, uid);
    const orderBy = typeof req.query.orderBy === "string" ? req.query.orderBy.slice(0, 60) : undefined;
    const pageCap = Math.min(Math.max(Number(req.query.cap) || 10, 1), 20);
    res.json(await driveCall(scanFiles(token, { orderBy, pageCap })));
  }),
);

const viewRoute = (path: string, fn: (t: string, opts: ViewOpts) => Promise<unknown>) =>
  driveV2Router.get(
    path,
    ah(async (req, res) => {
      const uid = requireWrite(req);
      const token = await auth(req, uid);
      const pageToken = typeof req.query.pageToken === "string" ? req.query.pageToken : undefined;
      res.json(await driveCall(fn(token, { pageToken, driveId: driveIdOf(req) })));
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
    const token = await auth(req, uid);
    const pageToken = typeof req.query.pageToken === "string" ? req.query.pageToken : undefined;
    res.json(await driveCall(listDrives(token, pageToken)));
  }),
);

/* ── change tracking (real-time two-way sync) ── */
driveV2Router.get(
  "/drive-v2/accounts/:id/changes/start",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const token = await auth(req, uid);
    res.json({ startPageToken: await driveCall(getStartPageToken(token, driveIdOf(req))) });
  }),
);
driveV2Router.get(
  "/drive-v2/accounts/:id/changes",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const token = await auth(req, uid);
    const pageToken = typeof req.query.pageToken === "string" ? req.query.pageToken.slice(0, 4096) : "";
    if (!pageToken) throw badRequest("BAD_TOKEN", "A pageToken is required to list changes.");
    res.json(await driveCall(listChanges(token, pageToken, driveIdOf(req))));
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
    await ensureWatch(acc.id, uid).catch(() => {}); // best-effort; polling still covers gaps
    const heartbeat = setInterval(() => {
      try {
        res.write(": ping\n\n"); // comment frame keeps the connection alive through proxies
      } catch {
        /* closed */
      }
    }, 25_000);
    heartbeat.unref?.();
    req.on("close", () => {
      clearInterval(heartbeat);
      removeSubscriber(acc.id, res);
    });
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
    const token = await auth(req, uid);
    res.json({ file: await driveCall(getFile(token, fileId(String(req.params.fileId)))) });
  }),
);

driveV2Router.get(
  "/drive-v2/accounts/:id/path",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const token = await auth(req, uid);
    const folder = typeof req.query.folder === "string" && req.query.folder ? fileId(req.query.folder) : "root";
    res.json({ path: await driveCall(folderPath(token, folder)) });
  }),
);

/* ── write: create / rename / star / trash / restore / meta / move / copy / delete ── */

driveV2Router.post(
  "/drive-v2/accounts/:id/folders",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const token = await auth(req, uid);
    const body = z
      .object({
        name: z.string().min(1).max(255),
        parentId: z.string().min(1).max(256).default("root"),
        folderColorRgb: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
        description: z.string().max(1000).optional(),
      })
      .parse(req.body);
    res.status(201).json({ file: await driveCall(createFolderV2(token, body)) });
  }),
);

driveV2Router.patch(
  "/drive-v2/accounts/:id/files/:fileId/rename",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const token = await auth(req, uid);
    const { name } = z.object({ name: z.string().min(1).max(255) }).parse(req.body);
    res.json({ file: await driveCall(renameNode(token, fileId(String(req.params.fileId)), name)) });
  }),
);

driveV2Router.patch(
  "/drive-v2/accounts/:id/files/:fileId/star",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const token = await auth(req, uid);
    const { starred } = z.object({ starred: z.boolean() }).parse(req.body);
    res.json({ file: await driveCall(setStarred(token, fileId(String(req.params.fileId)), starred)) });
  }),
);

driveV2Router.patch(
  "/drive-v2/accounts/:id/files/:fileId/trash",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const token = await auth(req, uid);
    const { trashed } = z.object({ trashed: z.boolean() }).parse(req.body);
    res.json({ file: await driveCall(setTrashed(token, fileId(String(req.params.fileId)), trashed)) });
  }),
);

driveV2Router.patch(
  "/drive-v2/accounts/:id/files/:fileId/meta",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const token = await auth(req, uid);
    const patch = z
      .object({ description: z.string().max(1000).optional(), folderColorRgb: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional() })
      .parse(req.body);
    res.json({ file: await driveCall(updateMeta(token, fileId(String(req.params.fileId)), patch)) });
  }),
);

driveV2Router.post(
  "/drive-v2/accounts/:id/files/:fileId/move",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const token = await auth(req, uid);
    const { addParents, removeParents } = z
      .object({ addParents: z.array(z.string().min(1).max(256)).max(20).default([]), removeParents: z.array(z.string().min(1).max(256)).max(20).default([]) })
      .parse(req.body);
    res.json({ file: await driveCall(moveNode(token, fileId(String(req.params.fileId)), addParents, removeParents)) });
  }),
);

driveV2Router.post(
  "/drive-v2/accounts/:id/files/:fileId/copy",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const token = await auth(req, uid);
    const opts = z.object({ name: z.string().min(1).max(255).optional(), parents: z.array(z.string().min(1).max(256)).max(20).optional() }).parse(req.body);
    res.status(201).json({ file: await driveCall(copyNode(token, fileId(String(req.params.fileId)), opts)) });
  }),
);

driveV2Router.delete(
  "/drive-v2/accounts/:id/files/:fileId",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const token = await auth(req, uid);
    await driveCall(deleteNode(token, fileId(String(req.params.fileId))));
    res.json({ ok: true });
  }),
);

driveV2Router.post(
  "/drive-v2/accounts/:id/empty-trash",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const token = await auth(req, uid);
    await driveCall(emptyTrash(token));
    res.json({ ok: true });
  }),
);

/* ── revisions (version history) ── */

driveV2Router.get(
  "/drive-v2/accounts/:id/files/:fileId/revisions",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const token = await auth(req, uid);
    res.json({ revisions: await driveCall(listRevisions(token, fileId(String(req.params.fileId)))) });
  }),
);

driveV2Router.patch(
  "/drive-v2/accounts/:id/files/:fileId/revisions/:revId",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const token = await auth(req, uid);
    const { keepForever } = z.object({ keepForever: z.boolean() }).parse(req.body);
    res.json({ revision: await driveCall(updateRevision(token, fileId(String(req.params.fileId)), String(req.params.revId), keepForever)) });
  }),
);

driveV2Router.delete(
  "/drive-v2/accounts/:id/files/:fileId/revisions/:revId",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const token = await auth(req, uid);
    await driveCall(deleteRevision(token, fileId(String(req.params.fileId)), String(req.params.revId)));
    res.json({ ok: true });
  }),
);

/* ── sharing / permissions ── */

const ROLE = z.enum(["reader", "commenter", "writer", "fileOrganizer", "organizer", "owner"]);

driveV2Router.get(
  "/drive-v2/accounts/:id/files/:fileId/permissions",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const token = await auth(req, uid);
    res.json({ permissions: await driveCall(listPermissions(token, fileId(String(req.params.fileId)))) });
  }),
);

driveV2Router.post(
  "/drive-v2/accounts/:id/files/:fileId/permissions",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const token = await auth(req, uid);
    const body = z
      .object({
        role: ROLE,
        type: z.enum(["user", "group", "domain", "anyone"]),
        emailAddress: z.string().email().max(320).optional(),
        domain: z.string().max(255).optional(),
        allowFileDiscovery: z.boolean().optional(),
        sendNotificationEmail: z.boolean().optional(),
        message: z.string().max(2000).optional(),
      })
      .parse(req.body);
    if ((body.type === "user" || body.type === "group") && !body.emailAddress) throw badRequest("BAD_TARGET", "An email address is required to share with a person or group.");
    res.status(201).json({ permission: await driveCall(createPermission(token, fileId(String(req.params.fileId)), body)) });
  }),
);

driveV2Router.patch(
  "/drive-v2/accounts/:id/files/:fileId/permissions/:permId",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const token = await auth(req, uid);
    const { role } = z.object({ role: ROLE }).parse(req.body);
    res.json({ permission: await driveCall(updatePermission(token, fileId(String(req.params.fileId)), String(req.params.permId), role)) });
  }),
);

driveV2Router.delete(
  "/drive-v2/accounts/:id/files/:fileId/permissions/:permId",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const token = await auth(req, uid);
    await driveCall(deletePermission(token, fileId(String(req.params.fileId)), String(req.params.permId)));
    res.json({ ok: true });
  }),
);
