import { GoogleAuthError, GoogleTransientError } from "./googleDrive.js";

/** The caller lacks permission on this specific item (reconnecting won't help). */
export class GoogleForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleForbiddenError";
  }
}
/** Google rejected the request as invalid (bad params) — a client error, not retriable. */
export class GoogleBadRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleBadRequestError";
  }
}
/** The resource is gone (HTTP 410) — for `changes.list` this means the page token has expired and the
 *  caller must RE-ANCHOR (fetch a fresh startPageToken) rather than retry the dead token forever. */
export class GoogleGoneError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleGoneError";
  }
}

/**
 * Google Drive V2 — full-CRUD Drive API v3 helpers for the V2 "control center" module.
 *
 * SEPARATE from integrations/googleDrive.ts (V1) so the existing module is untouched. These calls
 * operate on ALL of the user's Drive (not just app-created files) and therefore need the full `drive`
 * scope (GOOGLE_DRIVE_FULL_ACCESS=1 + a reconnected account). Management calls are proxied through
 * the API with a short-lived access token; file BYTES still upload browser→Google directly (V1 engine).
 */

const DRIVE_API = "https://www.googleapis.com/drive/v3";
export const FOLDER_MIME = "application/vnd.google-apps.folder";

/** Fields requested for every file/folder resource — enough to power the grid, list and details panel. */
const FILE_FIELDS =
  "id,name,mimeType,size,modifiedTime,createdTime,iconLink,thumbnailLink,webViewLink,webContentLink,starred,trashed,parents,shortcutDetails(targetId,targetMimeType),capabilities(canEdit,canRename,canDelete,canTrash,canCopy,canShare,canAddChildren,canMoveItemWithinDrive),owners(displayName,emailAddress,photoLink),shared,ownedByMe,md5Checksum,folderColorRgb,description,fileExtension,appProperties";

/** Escape a value for a single-quoted Drive `q` literal — backslash FIRST, then quote. */
function qval(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/** Google 403 `reason`s that mean "you lack permission on THIS item" — reconnecting won't help. */
const PERMISSION_REASONS = new Set([
  "insufficientFilePermissions",
  "insufficientPermissions",
  "cannotModifyInheritedPermission",
  "cannotShareOutsideDomain",
  "domainPolicy",
  "abuseIsBlockingDownload",
]);

/** Google 403 `reason`s that are transient throttling (retriable), NOT auth/scope problems. */
const THROTTLE_REASONS = new Set([
  "userRateLimitExceeded",
  "rateLimitExceeded",
  "dailyLimitExceeded",
  "sharingRateLimitExceeded",
]);

/**
 * Classify a non-ok Drive response using the HTTP status AND Google's error `reason`/`domain`/`message`:
 * - 401, or a 403 that's genuinely an auth/scope problem → GoogleAuthError (prompt reconnect).
 * - 403 rate-limit/usage-limit → GoogleTransientError (retriable, NOT a reconnect).
 * - 403 with a per-item permission reason → GoogleForbiddenError (reconnecting won't help).
 * - 400 → GoogleBadRequestError (bad params — a client error, not retriable).
 * - 429 / anything else → GoogleTransientError (retry).
 */
function driveHttpError(status: number, ctx: string, reason?: string, message?: string, domain?: string): Error {
  if (status === 401) return new GoogleAuthError(`${ctx} — reconnect the Google account (V2 needs full Drive access).`);
  if (status === 429) return new GoogleTransientError(`${ctx} — Drive is rate-limiting; retry shortly.`);
  if (status === 403) {
    // Throttling (per-user QPS / daily quota) is transient — surface as retriable, never "reconnect".
    if ((reason && THROTTLE_REASONS.has(reason)) || domain === "usageLimits") {
      return new GoogleTransientError(`${ctx} — Drive is rate-limiting; retry shortly.`);
    }
    if (reason && PERMISSION_REASONS.has(reason)) {
      return new GoogleForbiddenError(`${ctx} — you don't have permission to do that${message ? `: ${message}` : "."}`);
    }
    return new GoogleAuthError(`${ctx} — reconnect the Google account (V2 needs full Drive access).`);
  }
  if (status === 400) return new GoogleBadRequestError(`${ctx}${message ? `: ${message}` : "."}`);
  return new GoogleTransientError(`${ctx} (${status}).`);
}

export interface DriveNode {
  id: string;
  name: string;
  mimeType: string;
  size?: number;
  modifiedTime?: string;
  createdTime?: string;
  iconLink?: string;
  thumbnailLink?: string;
  webViewLink?: string;
  webContentLink?: string;
  starred?: boolean;
  trashed?: boolean;
  parents?: string[];
  shortcutDetails?: { targetId?: string; targetMimeType?: string };
  capabilities?: Record<string, boolean>;
  owners?: { displayName?: string; emailAddress?: string; photoLink?: string }[];
  shared?: boolean;
  ownedByMe?: boolean;
  md5Checksum?: string;
  folderColorRgb?: string;
  description?: string;
  fileExtension?: string;
  appProperties?: Record<string, string>; // app-private metadata (Kosh tags live here)
  isFolder: boolean;
}

interface RawFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  [k: string]: unknown;
}

function toNode(f: RawFile): DriveNode {
  const { size, ...rest } = f;
  return { ...(rest as unknown as DriveNode), size: size != null ? Number(size) : undefined, isFolder: f.mimeType === FOLDER_MIME };
}

/** `pageTokenSensitive`: for `changes.list`, an expired/invalid page token can come back as 400, 404 OR
 *  410 — all mean "re-anchor, don't retry the dead token" — so those map to GoogleGoneError. */
async function driveFetch(accessToken: string, url: string | URL, init: RequestInit, ctx: string, pageTokenSensitive = false): Promise<Response> {
  const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${accessToken}`, ...(init.headers ?? {}) } });
  if (!res.ok) {
    let reason: string | undefined;
    let message: string | undefined;
    let domain: string | undefined;
    try {
      const body = (await res.clone().json()) as { error?: { message?: string; errors?: { reason?: string; domain?: string }[] } };
      reason = body?.error?.errors?.[0]?.reason;
      domain = body?.error?.errors?.[0]?.domain;
      message = body?.error?.message;
    } catch {
      /* non-JSON error body — fall back to status-only classification */
    }
    if (pageTokenSensitive && (res.status === 400 || res.status === 404 || res.status === 410)) {
      throw new GoogleGoneError(`${ctx} — the sync page token expired; re-anchoring.`);
    }
    throw driveHttpError(res.status, ctx, reason, message, domain);
  }
  return res;
}

export interface ListResult {
  files: DriveNode[];
  nextPageToken?: string;
}

/** Options shared by every list/view helper. `driveId` scopes the query to a Shared Drive. */
export interface ViewOpts {
  pageToken?: string;
  orderBy?: string;
  pageSize?: number;
  driveId?: string;
}

/** Low-level list by an arbitrary `q`. Powers folder browse, search, recent, starred and trash. */
export async function listByQuery(accessToken: string, q: string, opts: ViewOpts = {}): Promise<ListResult> {
  const u = new URL(`${DRIVE_API}/files`);
  u.searchParams.set("q", q);
  u.searchParams.set("fields", `nextPageToken,files(${FILE_FIELDS})`);
  u.searchParams.set("orderBy", opts.orderBy ?? "folder,name_natural");
  u.searchParams.set("pageSize", String(opts.pageSize ?? 100));
  u.searchParams.set("spaces", "drive");
  u.searchParams.set("supportsAllDrives", "true");
  // Scope to a Shared Drive when asked (otherwise the default: the user's own corpus).
  if (opts.driveId) {
    u.searchParams.set("corpora", "drive");
    u.searchParams.set("driveId", opts.driveId);
    u.searchParams.set("includeItemsFromAllDrives", "true");
  }
  if (opts.pageToken) u.searchParams.set("pageToken", opts.pageToken);
  const res = await driveFetch(accessToken, u, {}, "Couldn't list Drive items");
  const json = (await res.json()) as { files?: RawFile[]; nextPageToken?: string };
  return { files: (json.files ?? []).map(toNode), nextPageToken: json.nextPageToken };
}

/** List the direct children of a folder ("root" for My Drive top level, or a Shared Drive id). */
export function listChildren(accessToken: string, parentId = "root", opts: ViewOpts = {}): Promise<ListResult> {
  return listByQuery(accessToken, `'${qval(parentId)}' in parents and trashed = false`, opts);
}

/** Search by free text and/or advanced filters (type/owner/date/starred), optionally within a Shared Drive. */
export function searchFiles(
  accessToken: string,
  params: { text?: string; mimeType?: string; mimeContains?: string; owner?: string; before?: string; after?: string; starred?: boolean; pageToken?: string; driveId?: string },
): Promise<ListResult> {
  const clauses = ["trashed = false"];
  if (params.text) {
    const t = qval(params.text);
    clauses.push(`(name contains '${t}' or fullText contains '${t}')`);
  }
  if (params.mimeType) clauses.push(`mimeType = '${qval(params.mimeType)}'`);
  if (params.mimeContains) clauses.push(`mimeType contains '${qval(params.mimeContains)}'`);
  if (params.owner) clauses.push(`'${qval(params.owner)}' in owners`);
  if (params.before) clauses.push(`modifiedTime < '${qval(params.before)}'`);
  if (params.after) clauses.push(`modifiedTime > '${qval(params.after)}'`);
  if (params.starred) clauses.push("starred = true");
  return listByQuery(accessToken, clauses.join(" and "), { pageToken: params.pageToken, driveId: params.driveId });
}

/* ── Shared Drives (team drives) ── */

export interface SharedDrive {
  id: string;
  name: string;
  colorRgb?: string;
  capabilities?: Record<string, boolean>;
}

/** List the Shared Drives the account can see (for the space picker). */
export async function listDrives(accessToken: string, pageToken?: string): Promise<{ drives: SharedDrive[]; nextPageToken?: string }> {
  const u = new URL(`${DRIVE_API}/drives`);
  u.searchParams.set("fields", "nextPageToken,drives(id,name,colorRgb,capabilities(canRename,canDeleteChildren,canAddChildren))");
  u.searchParams.set("pageSize", "100");
  if (pageToken) u.searchParams.set("pageToken", pageToken);
  const res = await driveFetch(accessToken, u, {}, "Couldn't list Shared Drives");
  const json = (await res.json()) as { drives?: SharedDrive[]; nextPageToken?: string };
  return { drives: json.drives ?? [], nextPageToken: json.nextPageToken };
}

/* ── change tracking (real-time two-way sync) ── */

export interface DriveChange {
  fileId: string;
  removed: boolean;
  time?: string;
  changeType?: string;
  file?: DriveNode; // absent when the item was removed/trashed away
}

/** Get a page token marking "now" — the client polls changes.list from here forward. */
export async function getStartPageToken(accessToken: string, driveId?: string): Promise<string> {
  const u = new URL(`${DRIVE_API}/changes/startPageToken`);
  u.searchParams.set("supportsAllDrives", "true");
  if (driveId) u.searchParams.set("driveId", driveId);
  const res = await driveFetch(accessToken, u, {}, "Couldn't start sync");
  const json = (await res.json()) as { startPageToken?: string };
  return json.startPageToken ?? "";
}

/** List changes since `pageToken`. Returns applied changes plus the token to poll from next. */
export async function listChanges(
  accessToken: string,
  pageToken: string,
  driveId?: string,
): Promise<{ changes: DriveChange[]; newStartPageToken?: string; nextPageToken?: string }> {
  const u = new URL(`${DRIVE_API}/changes`);
  u.searchParams.set("pageToken", pageToken);
  u.searchParams.set("fields", `newStartPageToken,nextPageToken,changes(changeType,removed,fileId,time,file(${FILE_FIELDS}))`);
  u.searchParams.set("supportsAllDrives", "true");
  u.searchParams.set("includeItemsFromAllDrives", "true");
  u.searchParams.set("includeRemoved", "true");
  u.searchParams.set("pageSize", "100");
  u.searchParams.set("spaces", "drive");
  if (driveId) u.searchParams.set("driveId", driveId);
  const res = await driveFetch(accessToken, u, {}, "Couldn't sync changes", true); // page-token-sensitive: 400/404/410 → re-anchor
  const json = (await res.json()) as {
    newStartPageToken?: string;
    nextPageToken?: string;
    changes?: { changeType?: string; removed?: boolean; fileId?: string; time?: string; file?: RawFile }[];
  };
  const changes: DriveChange[] = (json.changes ?? [])
    .filter((c) => c.fileId)
    .map((c) => ({ fileId: String(c.fileId), removed: !!c.removed, time: c.time, changeType: c.changeType, file: c.file ? toNode(c.file) : undefined }));
  return { changes, newStartPageToken: json.newStartPageToken, nextPageToken: json.nextPageToken };
}

/* ── push notifications (changes.watch) — near-instant sync ── */

export interface WatchResult {
  resourceId: string;
  expiration?: number; // ms epoch when the channel stops delivering (Drive caps ≈24h)
}

/**
 * Open a `changes.watch` channel so Google POSTs a (headers-only) ping to `address` on every change.
 * `token` is echoed back in the `X-Goog-Channel-Token` header and MUST be validated on each ping.
 * The user-corpus watch (no driveId) also surfaces Shared-Drive changes via includeItemsFromAllDrives.
 */
export async function watchChanges(
  accessToken: string,
  pageToken: string,
  opts: { channelId: string; address: string; token: string; ttlMs?: number },
): Promise<WatchResult> {
  const u = new URL(`${DRIVE_API}/changes/watch`);
  u.searchParams.set("pageToken", pageToken);
  u.searchParams.set("supportsAllDrives", "true");
  u.searchParams.set("includeItemsFromAllDrives", "true");
  const body: Record<string, unknown> = { id: opts.channelId, type: "web_hook", address: opts.address, token: opts.token };
  if (opts.ttlMs) body.expiration = String(Date.now() + opts.ttlMs);
  const res = await driveFetch(accessToken, u, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, "Couldn't start push sync");
  const json = (await res.json()) as { resourceId?: string; expiration?: string };
  // A channel with no resourceId can never be stopped (channels.stop needs it) — treat as a failure
  // rather than registering a bogus "undefined" resourceId that would leak the channel until it expires.
  if (!json.resourceId) throw new GoogleTransientError("Couldn't start push sync — Drive returned no channel resource id.");
  return { resourceId: json.resourceId, expiration: json.expiration ? Number(json.expiration) : undefined };
}

/** Close a previously-opened watch channel (best-effort; expired channels 404 harmlessly). */
export async function stopChannel(accessToken: string, channelId: string, resourceId: string): Promise<void> {
  const u = new URL(`${DRIVE_API}/channels/stop`);
  await driveFetch(accessToken, u, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: channelId, resourceId }) }, "Couldn't stop push sync");
}

/* ── analytics scan (duplicates / largest / stale / storage breakdown) ── */

export interface DriveScanFile {
  id: string;
  name: string;
  mimeType: string;
  size?: number;
  md5Checksum?: string;
  quotaBytesUsed?: number;
  viewedByMeTime?: string;
  modifiedTime?: string;
  iconLink?: string;
  thumbnailLink?: string;
  webViewLink?: string;
  parents?: string[];
}

/** Scan up to `pageCap` pages of non-folder files with the fields analytics panels need. */
export async function scanFiles(accessToken: string, opts: { orderBy?: string; pageCap?: number; driveId?: string } = {}): Promise<{ files: DriveScanFile[]; truncated: boolean }> {
  const q = `trashed = false and mimeType != '${FOLDER_MIME}'`;
  const cap = Math.min(opts.pageCap ?? 10, 20); // 20 pages × 1000 = 20k files hard ceiling
  const out: DriveScanFile[] = [];
  let pageToken: string | undefined;
  let pages = 0;
  for (;;) {
    const u = new URL(`${DRIVE_API}/files`);
    u.searchParams.set("q", q);
    u.searchParams.set("fields", "nextPageToken,files(id,name,mimeType,size,md5Checksum,quotaBytesUsed,viewedByMeTime,modifiedTime,iconLink,thumbnailLink,webViewLink,parents)");
    if (opts.orderBy) u.searchParams.set("orderBy", opts.orderBy);
    u.searchParams.set("pageSize", "1000");
    u.searchParams.set("spaces", "drive");
    u.searchParams.set("supportsAllDrives", "true");
    // Scope the analytics scan to a Shared Drive when one is selected (else the user's own corpus).
    if (opts.driveId) {
      u.searchParams.set("corpora", "drive");
      u.searchParams.set("driveId", opts.driveId);
      u.searchParams.set("includeItemsFromAllDrives", "true");
    }
    if (pageToken) u.searchParams.set("pageToken", pageToken);
    const res = await driveFetch(accessToken, u, {}, "Couldn't scan Drive");
    const json = (await res.json()) as { files?: Record<string, unknown>[]; nextPageToken?: string };
    for (const f of json.files ?? []) {
      out.push({
        id: String(f.id),
        name: String(f.name),
        mimeType: String(f.mimeType),
        size: f.size != null ? Number(f.size) : undefined,
        md5Checksum: f.md5Checksum as string | undefined,
        quotaBytesUsed: f.quotaBytesUsed != null ? Number(f.quotaBytesUsed) : undefined,
        viewedByMeTime: f.viewedByMeTime as string | undefined,
        modifiedTime: f.modifiedTime as string | undefined,
        iconLink: f.iconLink as string | undefined,
        thumbnailLink: f.thumbnailLink as string | undefined,
        webViewLink: f.webViewLink as string | undefined,
        parents: f.parents as string[] | undefined,
      });
    }
    pageToken = json.nextPageToken;
    pages++;
    if (!pageToken) return { files: out, truncated: false };
    if (pages >= cap) return { files: out, truncated: true };
  }
}

export function listRecent(accessToken: string, opts: ViewOpts = {}): Promise<ListResult> {
  return listByQuery(accessToken, "trashed = false and mimeType != '" + FOLDER_MIME + "'", { ...opts, orderBy: "modifiedTime desc", pageSize: 50 });
}
export function listStarred(accessToken: string, opts: ViewOpts = {}): Promise<ListResult> {
  return listByQuery(accessToken, "starred = true and trashed = false", opts);
}
export function listTrash(accessToken: string, opts: ViewOpts = {}): Promise<ListResult> {
  return listByQuery(accessToken, "trashed = true", { ...opts, orderBy: "modifiedTime desc" });
}
export function listSharedWithMe(accessToken: string, opts: ViewOpts = {}): Promise<ListResult> {
  // "Shared with me" is a My-Drive concept — always the user's corpus, never a Shared Drive.
  return listByQuery(accessToken, "sharedWithMe = true and trashed = false", { pageToken: opts.pageToken, orderBy: "modifiedTime desc" });
}

/* ── revisions (version history for binary files) ── */

export interface DriveRevision {
  id: string;
  modifiedTime?: string;
  size?: number;
  keepForever?: boolean;
  lastModifyingUser?: { displayName?: string };
  originalFilename?: string;
}

export async function listRevisions(accessToken: string, fileId: string): Promise<DriveRevision[]> {
  const out: DriveRevision[] = [];
  let pageToken: string | undefined;
  do {
    const u = new URL(`${DRIVE_API}/files/${encodeURIComponent(fileId)}/revisions`);
    u.searchParams.set("fields", "nextPageToken,revisions(id,modifiedTime,size,keepForever,originalFilename,lastModifyingUser(displayName))");
    u.searchParams.set("pageSize", "200");
    u.searchParams.set("supportsAllDrives", "true");
    if (pageToken) u.searchParams.set("pageToken", pageToken);
    const res = await driveFetch(accessToken, u, {}, "Couldn't load version history");
    const json = (await res.json()) as { revisions?: (Omit<DriveRevision, "size"> & { size?: string })[]; nextPageToken?: string };
    for (const r of json.revisions ?? []) out.push({ ...r, size: r.size != null ? Number(r.size) : undefined });
    pageToken = json.nextPageToken; // a long-lived doc can have >200 revisions — page through them all
  } while (pageToken);
  return out;
}

export async function deleteRevision(accessToken: string, fileId: string, revId: string): Promise<void> {
  const u = new URL(`${DRIVE_API}/files/${encodeURIComponent(fileId)}/revisions/${encodeURIComponent(revId)}`);
  u.searchParams.set("supportsAllDrives", "true");
  await driveFetch(accessToken, u, { method: "DELETE" }, "Couldn't delete that version");
}

/** Pin/unpin a revision so Drive never auto-prunes it ("keep forever"). */
export async function updateRevision(accessToken: string, fileId: string, revId: string, keepForever: boolean): Promise<DriveRevision> {
  const u = new URL(`${DRIVE_API}/files/${encodeURIComponent(fileId)}/revisions/${encodeURIComponent(revId)}`);
  u.searchParams.set("fields", "id,modifiedTime,size,keepForever,originalFilename,lastModifyingUser(displayName)");
  u.searchParams.set("supportsAllDrives", "true");
  const res = await driveFetch(accessToken, u, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ keepForever }) }, "Couldn't update that version");
  const r = (await res.json()) as Omit<DriveRevision, "size"> & { size?: string };
  return { ...r, size: r.size != null ? Number(r.size) : undefined };
}

/** One file's full metadata (details panel). */
export async function getFile(accessToken: string, id: string): Promise<DriveNode> {
  const u = new URL(`${DRIVE_API}/files/${encodeURIComponent(id)}`);
  u.searchParams.set("fields", FILE_FIELDS);
  u.searchParams.set("supportsAllDrives", "true");
  const res = await driveFetch(accessToken, u, {}, "Couldn't load file details");
  return toNode((await res.json()) as RawFile);
}

/** PATCH arbitrary metadata (name, starred, trashed, description, folderColorRgb). */
async function patchFile(accessToken: string, id: string, body: Record<string, unknown>, ctx: string): Promise<DriveNode> {
  const u = new URL(`${DRIVE_API}/files/${encodeURIComponent(id)}`);
  u.searchParams.set("fields", FILE_FIELDS);
  u.searchParams.set("supportsAllDrives", "true");
  const res = await driveFetch(accessToken, u, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, ctx);
  return toNode((await res.json()) as RawFile);
}

export function renameNode(accessToken: string, id: string, name: string): Promise<DriveNode> {
  return patchFile(accessToken, id, { name }, "Couldn't rename");
}
export function setStarred(accessToken: string, id: string, starred: boolean): Promise<DriveNode> {
  return patchFile(accessToken, id, { starred }, "Couldn't update star");
}
export function setTrashed(accessToken: string, id: string, trashed: boolean): Promise<DriveNode> {
  return patchFile(accessToken, id, { trashed }, trashed ? "Couldn't move to trash" : "Couldn't restore");
}
export function updateMeta(
  accessToken: string,
  id: string,
  // appProperties is a partial patch: a string sets a key, `null` removes it (Drive merges the map).
  patch: { description?: string; folderColorRgb?: string; appProperties?: Record<string, string | null> },
): Promise<DriveNode> {
  return patchFile(accessToken, id, patch, "Couldn't update");
}

/** Move a node between folders. */
export async function moveNode(accessToken: string, id: string, addParents: string[], removeParents: string[]): Promise<DriveNode> {
  const u = new URL(`${DRIVE_API}/files/${encodeURIComponent(id)}`);
  u.searchParams.set("fields", FILE_FIELDS);
  u.searchParams.set("supportsAllDrives", "true");
  if (addParents.length) u.searchParams.set("addParents", addParents.join(","));
  if (removeParents.length) u.searchParams.set("removeParents", removeParents.join(","));
  const res = await driveFetch(accessToken, u, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: "{}" }, "Couldn't move");
  return toNode((await res.json()) as RawFile);
}

/** Copy a file (folders can't be copied by the Drive API). */
export async function copyNode(accessToken: string, id: string, opts: { name?: string; parents?: string[] } = {}): Promise<DriveNode> {
  const u = new URL(`${DRIVE_API}/files/${encodeURIComponent(id)}/copy`);
  u.searchParams.set("fields", FILE_FIELDS);
  u.searchParams.set("supportsAllDrives", "true");
  const body: Record<string, unknown> = {};
  if (opts.name) body.name = opts.name;
  if (opts.parents?.length) body.parents = opts.parents;
  const res = await driveFetch(accessToken, u, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, "Couldn't copy");
  return toNode((await res.json()) as RawFile);
}

/** Permanently delete a node (bypasses trash). */
export async function deleteNode(accessToken: string, id: string): Promise<void> {
  const u = new URL(`${DRIVE_API}/files/${encodeURIComponent(id)}`);
  u.searchParams.set("supportsAllDrives", "true");
  await driveFetch(accessToken, u, { method: "DELETE" }, "Couldn't delete");
}

export async function emptyTrash(accessToken: string, driveId?: string): Promise<void> {
  const u = new URL(`${DRIVE_API}/files/trash`);
  // Scope to a Shared Drive when one is active, else this empties the user's own My-Drive trash.
  if (driveId) { u.searchParams.set("driveId", driveId); u.searchParams.set("supportsAllDrives", "true"); }
  await driveFetch(accessToken, u, { method: "DELETE" }, "Couldn't empty trash");
}

/** Create a folder (optional Drive folder color + description). */
export async function createFolderV2(
  accessToken: string,
  input: { name: string; parentId?: string; folderColorRgb?: string; description?: string },
): Promise<DriveNode> {
  const u = new URL(`${DRIVE_API}/files`);
  u.searchParams.set("fields", FILE_FIELDS);
  u.searchParams.set("supportsAllDrives", "true");
  const body: Record<string, unknown> = { name: input.name, mimeType: FOLDER_MIME, parents: [input.parentId || "root"] };
  if (input.folderColorRgb) body.folderColorRgb = input.folderColorRgb;
  if (input.description) body.description = input.description;
  const res = await driveFetch(accessToken, u, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, "Couldn't create the folder");
  return toNode((await res.json()) as RawFile);
}

/* ── permissions / sharing ── */

export interface DrivePermission {
  id: string;
  type: string; // user | group | domain | anyone
  role: string; // owner | organizer | fileOrganizer | writer | commenter | reader
  emailAddress?: string;
  displayName?: string;
  photoLink?: string;
  domain?: string;
  allowFileDiscovery?: boolean;
  pendingOwner?: boolean;
  deleted?: boolean;
}

const PERM_FIELDS = "id,type,role,emailAddress,displayName,photoLink,domain,allowFileDiscovery,pendingOwner,deleted";

export async function listPermissions(accessToken: string, fileId: string): Promise<DrivePermission[]> {
  const out: DrivePermission[] = [];
  let pageToken: string | undefined;
  do {
    const u = new URL(`${DRIVE_API}/files/${encodeURIComponent(fileId)}/permissions`);
    u.searchParams.set("fields", `nextPageToken,permissions(${PERM_FIELDS})`);
    u.searchParams.set("supportsAllDrives", "true");
    u.searchParams.set("pageSize", "100");
    if (pageToken) u.searchParams.set("pageToken", pageToken);
    const res = await driveFetch(accessToken, u, {}, "Couldn't load sharing");
    const json = (await res.json()) as { permissions?: DrivePermission[]; nextPageToken?: string };
    out.push(...(json.permissions ?? []));
    pageToken = json.nextPageToken; // a heavily-shared file can have >100 principals — page through them all
  } while (pageToken);
  return out;
}

export async function createPermission(
  accessToken: string,
  fileId: string,
  input: { role: string; type: string; emailAddress?: string; domain?: string; allowFileDiscovery?: boolean; sendNotificationEmail?: boolean; message?: string },
): Promise<DrivePermission> {
  const u = new URL(`${DRIVE_API}/files/${encodeURIComponent(fileId)}/permissions`);
  u.searchParams.set("fields", PERM_FIELDS);
  u.searchParams.set("supportsAllDrives", "true");
  // Notifications only make sense for user/group grants; default off for link (anyone/domain) shares.
  u.searchParams.set("sendNotificationEmail", String(input.sendNotificationEmail ?? (input.type === "user" || input.type === "group")));
  const body: Record<string, unknown> = { role: input.role, type: input.type };
  if (input.emailAddress) body.emailAddress = input.emailAddress;
  if (input.domain) body.domain = input.domain;
  if (input.type === "anyone" || input.type === "domain") body.allowFileDiscovery = input.allowFileDiscovery ?? false;
  if (input.message) u.searchParams.set("emailMessage", input.message);
  const res = await driveFetch(accessToken, u, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, "Couldn't share");
  return (await res.json()) as DrivePermission;
}

export async function updatePermission(accessToken: string, fileId: string, permId: string, role: string): Promise<DrivePermission> {
  const u = new URL(`${DRIVE_API}/files/${encodeURIComponent(fileId)}/permissions/${encodeURIComponent(permId)}`);
  u.searchParams.set("fields", PERM_FIELDS);
  u.searchParams.set("supportsAllDrives", "true");
  const res = await driveFetch(accessToken, u, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role }) }, "Couldn't update access");
  return (await res.json()) as DrivePermission;
}

export async function deletePermission(accessToken: string, fileId: string, permId: string): Promise<void> {
  const u = new URL(`${DRIVE_API}/files/${encodeURIComponent(fileId)}/permissions/${encodeURIComponent(permId)}`);
  u.searchParams.set("supportsAllDrives", "true");
  await driveFetch(accessToken, u, { method: "DELETE" }, "Couldn't remove access");
}

/** Resolve the ancestor chain (breadcrumb) for a folder id, walking `parents` up to root. */
export async function folderPath(accessToken: string, folderId: string): Promise<{ id: string; name: string }[]> {
  if (!folderId || folderId === "root") return [];
  const chain: { id: string; name: string }[] = [];
  let current: string | undefined = folderId;
  let guard = 0;
  while (current && current !== "root" && guard < 50) {
    guard++;
    const u = new URL(`${DRIVE_API}/files/${encodeURIComponent(current)}`);
    u.searchParams.set("fields", "id,name,parents");
    u.searchParams.set("supportsAllDrives", "true");
    const res = await driveFetch(accessToken, u, {}, "Couldn't resolve folder path");
    const node = (await res.json()) as { id: string; name: string; parents?: string[] };
    chain.unshift({ id: node.id, name: node.name });
    current = node.parents?.[0];
  }
  return chain;
}
