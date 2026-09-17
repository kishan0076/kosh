import { config } from "../config.js";

/**
 * Server-side Google Drive / OAuth helpers.
 *
 * Design: the browser uploads file BYTES directly to Google via the resumable protocol using a
 * SHORT-LIVED access token minted here (mirrors Kosh's presigned-R2 direct-upload path — bytes never
 * flow through the API). The API owns OAuth: it holds the encrypted REFRESH token and exchanges it
 * for access tokens on demand, and it proxies the small management calls (folders, quota, duplicate
 * check) so the browser only ever gets a token scoped to the upload it's about to perform.
 *
 * Least privilege: default scope is `drive.file` (only files this app creates), which needs no
 * Google app verification. GOOGLE_DRIVE_FULL_ACCESS=1 upgrades to the restricted `drive` scope.
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const DRIVE_API = "https://www.googleapis.com/drive/v3";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";

/** The OAuth scopes Kosh requests. openid/email/profile identify the account for multi-account UX. */
export function driveScopes(): string {
  const drive = config.google.fullAccess
    ? "https://www.googleapis.com/auth/drive"
    : "https://www.googleapis.com/auth/drive.file";
  return [drive, "openid", "email", "profile"].join(" ");
}

export function googleConfigured(): boolean {
  return !!(config.google.clientId && config.google.clientSecret);
}

/** Build the consent-screen URL. `access_type=offline` + `prompt=consent` guarantee a refresh token. */
export function driveAuthUrl(state: string): string {
  const u = new URL(AUTH_URL);
  u.searchParams.set("client_id", config.google.clientId!);
  u.searchParams.set("redirect_uri", config.google.redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", driveScopes());
  u.searchParams.set("access_type", "offline");
  u.searchParams.set("prompt", "consent");
  u.searchParams.set("include_granted_scopes", "true");
  u.searchParams.set("state", state);
  return u.toString();
}

/** The refresh token is genuinely dead (revoked/expired) — the user must reconnect. */
export class GoogleAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleAuthError";
  }
}

/** A transient upstream failure (5xx/429/network) — retriable, NOT a reason to force reconnect. */
export class GoogleTransientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleTransientError";
  }
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
  token_type: string;
  id_token?: string;
}

/** Exchange an authorization code for tokens (includes a refresh token on first consent). */
export async function exchangeCode(code: string): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: config.google.clientId!,
      client_secret: config.google.clientSecret!,
      redirect_uri: config.google.redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new GoogleAuthError(`Google token exchange failed (${res.status}).`);
  return (await res.json()) as TokenResponse;
}

/** Mint a fresh short-lived access token from a stored refresh token. */
export async function refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; expiresIn: number }> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: config.google.clientId!,
      client_secret: config.google.clientSecret!,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    let body: { error?: string } | undefined;
    try {
      body = (await res.json()) as { error?: string };
    } catch {
      /* ignore */
    }
    // Only invalid_grant means the token is truly dead → reconnect. Everything else is transient.
    if (res.status === 400 && body?.error === "invalid_grant") throw new GoogleAuthError("This Google account needs to be reconnected.");
    throw new GoogleTransientError(`Google token refresh failed (${res.status}). Please try again.`);
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  return { accessToken: json.access_token, expiresIn: json.expires_in };
}

/** Best-effort token revocation on disconnect. Never throws. */
export async function revokeToken(token: string): Promise<void> {
  try {
    await fetch(REVOKE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
    });
  } catch {
    /* best effort */
  }
}

/** Classify a non-ok Drive API response: 401/403 → reconnect; anything else → transient. */
function driveHttpError(status: number, ctx: string): Error {
  if (status === 401 || status === 403) return new GoogleAuthError(`${ctx} — the Google account needs to be reconnected.`);
  return new GoogleTransientError(`${ctx} (${status}).`);
}

export interface GoogleUserInfo {
  sub: string;
  email: string;
  name?: string;
  picture?: string;
}

export async function getUserInfo(accessToken: string): Promise<GoogleUserInfo> {
  const res = await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new GoogleAuthError(`Couldn't read Google profile (${res.status}).`);
  return (await res.json()) as GoogleUserInfo;
}

export interface DriveStorageQuota {
  limit?: number; // bytes; absent for unlimited (some Workspace accounts)
  usage: number;
  usageInDrive: number;
  usageInDriveTrash: number;
}

/** Storage usage for the account (works with the drive.file scope). */
export async function getStorageQuota(accessToken: string): Promise<DriveStorageQuota> {
  const res = await fetch(`${DRIVE_API}/about?fields=storageQuota`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw driveHttpError(res.status, "Couldn't read storage usage");
  const json = (await res.json()) as { storageQuota: Record<string, string> };
  const q = json.storageQuota ?? {};
  return {
    limit: q.limit != null ? Number(q.limit) : undefined,
    usage: Number(q.usage ?? 0),
    usageInDrive: Number(q.usageInDrive ?? 0),
    usageInDriveTrash: Number(q.usageInDriveTrash ?? 0),
  };
}

export interface DriveFolder {
  id: string;
  name: string;
  modifiedTime?: string;
}

const FOLDER_MIME = "application/vnd.google-apps.folder";

/** Escape a value for embedding in a single-quoted Drive `q` literal — backslash FIRST, then quote. */
function qval(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/** List ALL child folders under a parent ("root" for the top level), following pagination. */
export async function listFolders(accessToken: string, parentId = "root"): Promise<DriveFolder[]> {
  const q = `mimeType = '${FOLDER_MIME}' and '${qval(parentId)}' in parents and trashed = false`;
  const out: DriveFolder[] = [];
  let pageToken: string | undefined;
  do {
    const u = new URL(`${DRIVE_API}/files`);
    u.searchParams.set("q", q);
    u.searchParams.set("fields", "nextPageToken,files(id,name,modifiedTime)");
    u.searchParams.set("orderBy", "name");
    u.searchParams.set("pageSize", "1000");
    u.searchParams.set("spaces", "drive");
    if (pageToken) u.searchParams.set("pageToken", pageToken);
    const res = await fetch(u, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) throw driveHttpError(res.status, "Couldn't list folders");
    const json = (await res.json()) as { files?: DriveFolder[]; nextPageToken?: string };
    if (json.files) out.push(...json.files);
    pageToken = json.nextPageToken;
  } while (pageToken && out.length < 5000); // hard cap so a pathological tree can't loop forever
  return out;
}

/** Create a folder under a parent and return it. */
export async function createFolder(accessToken: string, name: string, parentId = "root"): Promise<DriveFolder> {
  const res = await fetch(`${DRIVE_API}/files?fields=id,name,modifiedTime`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
  });
  if (!res.ok) throw driveHttpError(res.status, "Couldn't create the folder");
  return (await res.json()) as DriveFolder;
}

export interface DriveDuplicate {
  name: string;
  matches: { id: string; name: string; size?: number; modifiedTime?: string; md5Checksum?: string }[];
}

/** Find existing non-trashed files matching the candidate names in the target folder. Names are
 *  batched into OR-chained queries to bound the number of Drive round-trips. */
export async function findDuplicates(accessToken: string, folderId: string, names: string[]): Promise<DriveDuplicate[]> {
  const parent = qval(folderId || "root");
  const unique = [...new Set(names)];
  const byName = new Map<string, DriveDuplicate["matches"]>();
  const BATCH = 40; // OR-chain up to 40 names per query to stay well under Drive's q length limit
  for (let i = 0; i < unique.length; i += BATCH) {
    const batch = unique.slice(i, i + BATCH);
    const nameClause = batch.map((n) => `name = '${qval(n)}'`).join(" or ");
    const q = `(${nameClause}) and '${parent}' in parents and trashed = false`;
    const u = new URL(`${DRIVE_API}/files`);
    u.searchParams.set("q", q);
    u.searchParams.set("fields", "files(id,name,size,modifiedTime,md5Checksum)");
    u.searchParams.set("pageSize", "1000");
    u.searchParams.set("spaces", "drive");
    const res = await fetch(u, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) continue; // a single failed batch shouldn't abort duplicate detection entirely
    const json = (await res.json()) as { files?: { id: string; name: string; size?: string; modifiedTime?: string; md5Checksum?: string }[] };
    for (const f of json.files ?? []) {
      const arr = byName.get(f.name) ?? [];
      arr.push({ id: f.id, name: f.name, size: f.size != null ? Number(f.size) : undefined, modifiedTime: f.modifiedTime, md5Checksum: f.md5Checksum });
      byName.set(f.name, arr);
    }
  }
  return [...byName.entries()].map(([name, matches]) => ({ name, matches }));
}
