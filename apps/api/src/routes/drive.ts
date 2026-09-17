import { Router, type Request } from "express";
import { z } from "zod";
import { getStore, type DriveAccountDoc } from "../db/index.js";
import { ah, badRequest, notFound } from "../errors.js";
import { requireUser, requireWrite } from "../auth/middleware.js";
import { decryptSecret, encryptSecret } from "../auth/crypto.js";
import { signState, verifyState } from "../auth/jwt.js";
import { config } from "../config.js";
import {
  GoogleAuthError,
  createFolder,
  driveAuthUrl,
  driveScopes,
  exchangeCode,
  findDuplicates,
  getStorageQuota,
  getUserInfo,
  googleConfigured,
  listFolders,
  refreshAccessToken,
  revokeToken,
} from "../integrations/googleDrive.js";

export const driveRouter: Router = Router();

const OAUTH_PURPOSE = "drive-connect";
const nowIso = () => new Date().toISOString();

/** Never leak the refresh token to the client. */
function publicAccount(a: DriveAccountDoc) {
  return { id: a.id, email: a.email, name: a.name, picture: a.picture, scope: a.scope, createdAt: a.createdAt, lastUsedAt: a.lastUsedAt };
}

async function ownedAccount(uid: string, id: string): Promise<DriveAccountDoc> {
  const acc = await getStore().driveAccounts.findById(id);
  if (!acc || acc.userId !== uid) throw notFound("Google account not found.");
  return acc;
}

/** Refresh a short-lived access token for direct browser uploads / server-side management calls. */
async function mintAccess(acc: DriveAccountDoc): Promise<{ accessToken: string; expiresIn: number }> {
  const refresh = decryptSecret(acc.refreshToken);
  if (!refresh) throw badRequest("NEEDS_RECONNECT", "This Google account needs to be reconnected.");
  try {
    const t = await refreshAccessToken(refresh);
    await getStore().driveAccounts.updateById(acc.id, { lastUsedAt: nowIso() });
    return t;
  } catch (err) {
    if (err instanceof GoogleAuthError) throw badRequest("NEEDS_RECONNECT", err.message);
    throw err;
  }
}

function requireConfigured(): void {
  if (!googleConfigured()) throw badRequest("NOT_CONFIGURED", "Google Drive isn't configured on the server. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.");
}

/* ── config + OAuth ───────────────────────────────────────────── */

driveRouter.get(
  "/drive/config",
  ah(async (req, res) => {
    requireUser(req);
    res.json({ configured: googleConfigured(), scope: driveScopes(), fullAccess: config.google.fullAccess });
  }),
);

/** Start the consent flow — redirects the browser to Google. State binds the flow to the user. */
driveRouter.get(
  "/drive/auth",
  ah(async (req, res) => {
    const uid = requireUser(req);
    requireConfigured();
    const state = await signState(uid, OAUTH_PURPOSE);
    res.redirect(driveAuthUrl(state));
  }),
);

/** OAuth redirect target. All error paths redirect back to the web app (this is a browser navigation). */
driveRouter.get(
  "/drive/auth/callback",
  ah(async (req: Request, res) => {
    const back = (params: Record<string, string>) => res.redirect(`${config.appUrl}/drive?${new URLSearchParams(params)}`);
    try {
      const { code, state, error } = req.query as { code?: string; state?: string; error?: string };
      if (error) return back({ error });
      if (!code || !state) return back({ error: "missing_code" });

      const uid = req.userId ?? null; // session cookie is sent on this top-level GET (sameSite=lax)
      const stateUid = await verifyState(state, OAUTH_PURPOSE);
      if (!uid || !stateUid || stateUid !== uid) return back({ error: "state_mismatch" });

      const tokens = await exchangeCode(code);
      const info = await getUserInfo(tokens.access_token);

      const store = getStore();
      const existing = await store.driveAccounts.findOne({ userId: uid, googleSub: info.sub });
      // A refresh token is only returned on first consent; keep the stored one if Google omits it.
      const refresh = tokens.refresh_token ? encryptSecret(tokens.refresh_token) : existing?.refreshToken;
      if (!refresh) return back({ error: "no_refresh_token" });

      if (existing) {
        await store.driveAccounts.updateById(existing.id, {
          email: info.email,
          name: info.name,
          picture: info.picture,
          refreshToken: refresh,
          scope: tokens.scope ?? existing.scope,
          lastUsedAt: nowIso(),
        });
      } else {
        await store.driveAccounts.create({
          userId: uid,
          googleSub: info.sub,
          email: info.email,
          name: info.name,
          picture: info.picture,
          refreshToken: refresh,
          scope: tokens.scope ?? driveScopes(),
          createdAt: nowIso(),
          lastUsedAt: nowIso(),
        });
      }
      return back({ connected: info.email });
    } catch {
      return res.redirect(`${config.appUrl}/drive?error=connect_failed`);
    }
  }),
);

/* ── accounts ─────────────────────────────────────────────────── */

driveRouter.get(
  "/drive/accounts",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const accounts = await getStore().driveAccounts.find({ userId: uid }, { sort: { createdAt: -1 } });
    res.json({ accounts: accounts.map(publicAccount), configured: googleConfigured() });
  }),
);

driveRouter.delete(
  "/drive/accounts/:id",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const acc = await ownedAccount(uid, String(req.params.id));
    const refresh = decryptSecret(acc.refreshToken);
    if (refresh) await revokeToken(refresh); // best-effort; never throws
    await getStore().driveAccounts.deleteById(acc.id);
    res.json({ ok: true });
  }),
);

/** Mint a short-lived access token for the browser's direct resumable upload. */
driveRouter.post(
  "/drive/accounts/:id/token",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const acc = await ownedAccount(uid, String(req.params.id));
    const { accessToken, expiresIn } = await mintAccess(acc);
    res.json({ accessToken, expiresIn });
  }),
);

driveRouter.get(
  "/drive/accounts/:id/about",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const acc = await ownedAccount(uid, String(req.params.id));
    const { accessToken } = await mintAccess(acc);
    res.json({ quota: await getStorageQuota(accessToken) });
  }),
);

/* ── folders ──────────────────────────────────────────────────── */

driveRouter.get(
  "/drive/accounts/:id/folders",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const acc = await ownedAccount(uid, String(req.params.id));
    const parent = typeof req.query.parent === "string" && req.query.parent ? req.query.parent : "root";
    const { accessToken } = await mintAccess(acc);
    res.json({ folders: await listFolders(accessToken, parent) });
  }),
);

driveRouter.post(
  "/drive/accounts/:id/folders",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const acc = await ownedAccount(uid, String(req.params.id));
    const { name, parentId } = z.object({ name: z.string().min(1).max(255), parentId: z.string().min(1).default("root") }).parse(req.body);
    const { accessToken } = await mintAccess(acc);
    res.status(201).json({ folder: await createFolder(accessToken, name, parentId) });
  }),
);

/* ── duplicate detection ──────────────────────────────────────── */

driveRouter.post(
  "/drive/accounts/:id/duplicates",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const acc = await ownedAccount(uid, String(req.params.id));
    const { folderId, names } = z
      .object({ folderId: z.string().min(1).default("root"), names: z.array(z.string().min(1).max(255)).max(1000) })
      .parse(req.body);
    const { accessToken } = await mintAccess(acc);
    res.json({ duplicates: await findDuplicates(accessToken, folderId, names) });
  }),
);

/* ── upload history (metadata only — bytes go straight to Google) ─ */

driveRouter.get(
  "/drive/uploads",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const uploads = await getStore().driveUploads.find({ userId: uid }, { sort: { createdAt: -1 }, limit: 100 });
    res.json({ uploads });
  }),
);

const uploadSchema = z.object({
  accountId: z.string().min(1),
  fileName: z.string().min(1).max(1024),
  mimeType: z.string().max(255).default("application/octet-stream"),
  size: z.number().int().nonnegative().default(0),
  driveFileId: z.string().max(255).optional(),
  folderId: z.string().max(255).optional(),
  folderPath: z.string().max(2048).optional(),
  webViewLink: z.string().max(2048).optional(),
  status: z.enum(["completed", "failed"]),
  error: z.string().max(500).optional(),
});

driveRouter.post(
  "/drive/uploads",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const body = uploadSchema.parse(req.body);
    const doc = await getStore().driveUploads.create({ userId: uid, createdAt: nowIso(), ...body });
    res.status(201).json({ upload: doc });
  }),
);
