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

export class GoogleAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleAuthError";
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
    // 400 invalid_grant → the user revoked access or the token expired; the caller should reconnect.
    throw new GoogleAuthError(res.status === 400 ? "This Google account needs to be reconnected." : `Token refresh failed (${res.status}).`);
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
  if (!res.ok) throw new GoogleAuthError(`Couldn't read storage usage (${res.status}).`);
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

/** List child folders under a parent ("root" for the top level). */
export async function listFolders(accessToken: string, parentId = "root"): Promise<DriveFolder[]> {
  const q = `mimeType = '${FOLDER_MIME}' and '${parentId.replace(/'/g, "\\'")}' in parents and trashed = false`;
  const u = new URL(`${DRIVE_API}/files`);
  u.searchParams.set("q", q);
  u.searchParams.set("fields", "files(id,name,modifiedTime)");
  u.searchParams.set("orderBy", "name");
  u.searchParams.set("pageSize", "200");
  u.searchParams.set("spaces", "drive");
  const res = await fetch(u, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new GoogleAuthError(`Couldn't list folders (${res.status}).`);
  const json = (await res.json()) as { files: DriveFolder[] };
  return json.files ?? [];
}

/** Create a folder under a parent and return it. */
export async function createFolder(accessToken: string, name: string, parentId = "root"): Promise<DriveFolder> {
  const res = await fetch(`${DRIVE_API}/files?fields=id,name,modifiedTime`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
  });
  if (!res.ok) throw new GoogleAuthError(`Couldn't create the folder (${res.status}).`);
  return (await res.json()) as DriveFolder;
}

export interface DriveDuplicate {
  name: string;
  matches: { id: string; name: string; size?: number; modifiedTime?: string; md5Checksum?: string }[];
}

/** For each candidate name, find existing non-trashed files with that name in the target folder. */
export async function findDuplicates(accessToken: string, folderId: string, names: string[]): Promise<DriveDuplicate[]> {
  const parent = (folderId || "root").replace(/'/g, "\\'");
  const out: DriveDuplicate[] = [];
  // One query per distinct name keeps the `q` simple and avoids over-long OR chains.
  for (const name of [...new Set(names)]) {
    const q = `name = '${name.replace(/'/g, "\\'")}' and '${parent}' in parents and trashed = false`;
    const u = new URL(`${DRIVE_API}/files`);
    u.searchParams.set("q", q);
    u.searchParams.set("fields", "files(id,name,size,modifiedTime,md5Checksum)");
    u.searchParams.set("pageSize", "10");
    u.searchParams.set("spaces", "drive");
    const res = await fetch(u, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) continue; // a single failed name-check shouldn't abort the whole batch
    const json = (await res.json()) as { files: { id: string; name: string; size?: string; modifiedTime?: string; md5Checksum?: string }[] };
    const matches = (json.files ?? []).map((f) => ({ id: f.id, name: f.name, size: f.size != null ? Number(f.size) : undefined, modifiedTime: f.modifiedTime, md5Checksum: f.md5Checksum }));
    if (matches.length) out.push({ name, matches });
  }
  return out;
}
