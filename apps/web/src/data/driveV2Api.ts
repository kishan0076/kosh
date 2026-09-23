import { driveKindOf } from "@kosh/shared";
import { API_BASE, ApiError } from "./api";

/* ── typed client for /drive-v2/* (management CRUD is server-proxied) ── */

const REQ_TIMEOUT_MS = 30_000; // abort a stalled request so a hung socket never strands a caller forever
const RETRY_STATUSES = new Set([429, 502, 503, 504]); // Drive throttling / transient upstream — safe to retry a read
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function v2req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  const idempotent = method === "GET" || method === "HEAD"; // never auto-retry a write (avoid duplicates)
  const maxAttempts = idempotent ? 3 : 1;
  for (let attempt = 1; ; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), REQ_TIMEOUT_MS);
    try {
      const res = await fetch(`${API_BASE}${path}`, {
        credentials: "include",
        ...init,
        // Only send Content-Type when there's a body — a JSON content-type on a bodyless GET makes it a
        // non-simple request and forces a CORS preflight before every read.
        headers: { ...(idempotent ? {} : { "Content-Type": "application/json" }), ...(init.headers ?? {}) },
        signal: ctrl.signal,
      });
      if (!res.ok) {
        if (idempotent && RETRY_STATUSES.has(res.status) && attempt < maxAttempts) {
          const ra = Number(res.headers.get("retry-after"));
          await sleep(Number.isFinite(ra) && ra > 0 ? ra * 1000 : Math.min(400 * 2 ** attempt, 4000));
          continue;
        }
        let message = `Request failed (${res.status})`;
        let code: string | undefined;
        let details: unknown;
        try {
          const body = await res.json();
          message = body?.error?.message ?? message;
          code = body?.error?.code;
          details = body?.error?.details;
        } catch {
          /* ignore */
        }
        throw new ApiError(message, code, details, res.status);
      }
      if (res.status === 204) return undefined as T;
      return (await res.json()) as T;
    } catch (err) {
      // A timeout surfaces as an AbortError — turn it into a typed error rather than a raw DOMException.
      if (err instanceof DOMException && err.name === "AbortError") {
        throw new ApiError("The request timed out — check your connection and retry.", "TIMEOUT", undefined, 0);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}

export const FOLDER_MIME = "application/vnd.google-apps.folder";
export const FULL_DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";

/** Exact-token scope check — NEVER substring (`auth/drive.file` contains `auth/drive`). */
export function hasFullDrive(scope: string | undefined): boolean {
  return !!scope && scope.split(" ").includes(FULL_DRIVE_SCOPE);
}

/** The one sanctioned raw-hex spot: Google Drive's own folder-color palette (maps to folderColorRgb). */
export const FOLDER_COLORS: { name: string; hex: string }[] = [
  { name: "Slate", hex: "#5f6368" },
  { name: "Red", hex: "#e34e3b" },
  { name: "Orange", hex: "#f2a73b" },
  { name: "Yellow", hex: "#f7cb4d" },
  { name: "Green", hex: "#41b375" },
  { name: "Teal", hex: "#26a69a" },
  { name: "Blue", hex: "#4a86e8" },
  { name: "Purple", hex: "#a479e0" },
  { name: "Pink", hex: "#e079b4" },
];

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
  isFolder: boolean;
}

export interface ListResult {
  files: DriveNode[];
  nextPageToken?: string;
}

export interface SearchParams {
  text?: string;
  mimeType?: string;
  mimeContains?: string;
  owner?: string;
  before?: string;
  after?: string;
  starred?: boolean;
  pageToken?: string;
  driveId?: string;
}

export interface SharedDrive {
  id: string;
  name: string;
  colorRgb?: string;
  capabilities?: Record<string, boolean>;
}

export interface DriveChange {
  fileId: string;
  removed: boolean;
  time?: string;
  changeType?: string;
  file?: DriveNode;
}

export interface ChangesResult {
  changes: DriveChange[];
  newStartPageToken?: string;
  nextPageToken?: string;
}

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

export type DriveKind = "folder" | "doc" | "sheet" | "slide" | "image" | "video" | "audio" | "pdf" | "archive" | "other";
export type FilterKind = "folder" | "doc" | "image" | "video" | "pdf" | "audio" | "archive";

/** Classify a node into a display/filter bucket by its mime type. */
export function kindOf(node: DriveNode): DriveKind {
  return driveKindOf(node); // shared, unit-tested classifier
}

/** Map a node to a top-level filter bucket (doc-family folds into "doc"). */
export function filterBucket(node: DriveNode): FilterKind | "other" {
  const k = kindOf(node);
  if (k === "sheet" || k === "slide") return "doc";
  if (k === "other") return "other";
  return k;
}

export interface DrivePermission {
  id: string;
  type: string;
  role: string;
  emailAddress?: string;
  displayName?: string;
  photoLink?: string;
  domain?: string;
  allowFileDiscovery?: boolean;
  pendingOwner?: boolean;
}

const base = (accountId: string) => `/drive-v2/accounts/${accountId}`;

interface ViewQuery {
  pageToken?: string;
  driveId?: string;
}
function viewQuery(opts: ViewQuery): string {
  const q = new URLSearchParams();
  if (opts.pageToken) q.set("pageToken", opts.pageToken);
  if (opts.driveId) q.set("driveId", opts.driveId);
  const s = q.toString();
  return s ? `?${s}` : "";
}

export const driveV2Api = {
  list: (accountId: string, parent = "root", opts: { pageToken?: string; orderBy?: string; driveId?: string } = {}) => {
    const q = new URLSearchParams({ parent });
    if (opts.pageToken) q.set("pageToken", opts.pageToken);
    if (opts.orderBy) q.set("orderBy", opts.orderBy);
    if (opts.driveId) q.set("driveId", opts.driveId);
    return v2req<ListResult>(`${base(accountId)}/list?${q}`);
  },
  search: (accountId: string, params: SearchParams) => {
    const q = new URLSearchParams();
    if (params.text) q.set("text", params.text);
    if (params.mimeType) q.set("mimeType", params.mimeType);
    if (params.mimeContains) q.set("mimeContains", params.mimeContains);
    if (params.owner) q.set("owner", params.owner);
    if (params.before) q.set("before", params.before);
    if (params.after) q.set("after", params.after);
    if (params.starred) q.set("starred", "true");
    if (params.pageToken) q.set("pageToken", params.pageToken);
    if (params.driveId) q.set("driveId", params.driveId);
    return v2req<ListResult>(`${base(accountId)}/search?${q}`);
  },
  scan: (accountId: string, opts: { orderBy?: string; cap?: number; driveId?: string } = {}) => {
    const q = new URLSearchParams();
    if (opts.orderBy) q.set("orderBy", opts.orderBy);
    if (opts.cap) q.set("cap", String(opts.cap));
    if (opts.driveId) q.set("driveId", opts.driveId);
    return v2req<{ files: DriveScanFile[]; truncated: boolean }>(`${base(accountId)}/scan?${q}`);
  },
  recent: (accountId: string, opts: ViewQuery = {}) => v2req<ListResult>(`${base(accountId)}/recent${viewQuery(opts)}`),
  starred: (accountId: string, opts: ViewQuery = {}) => v2req<ListResult>(`${base(accountId)}/starred${viewQuery(opts)}`),
  trash: (accountId: string, opts: ViewQuery = {}) => v2req<ListResult>(`${base(accountId)}/trash${viewQuery(opts)}`),
  sharedWithMe: (accountId: string, opts: ViewQuery = {}) => v2req<ListResult>(`${base(accountId)}/shared${viewQuery(opts)}`),

  drives: (accountId: string, pageToken?: string) =>
    v2req<{ drives: SharedDrive[]; nextPageToken?: string }>(`${base(accountId)}/drives${pageToken ? `?pageToken=${encodeURIComponent(pageToken)}` : ""}`),
  changesStart: (accountId: string, driveId?: string) =>
    v2req<{ startPageToken: string }>(`${base(accountId)}/changes/start${driveId ? `?driveId=${encodeURIComponent(driveId)}` : ""}`),
  changes: (accountId: string, pageToken: string, driveId?: string) => {
    const q = new URLSearchParams({ pageToken });
    if (driveId) q.set("driveId", driveId);
    return v2req<ChangesResult>(`${base(accountId)}/changes?${q}`);
  },
  getFile: (accountId: string, fileId: string) => v2req<{ file: DriveNode }>(`${base(accountId)}/files/${fileId}`),
  path: (accountId: string, folder: string) => v2req<{ path: { id: string; name: string }[] }>(`${base(accountId)}/path?folder=${encodeURIComponent(folder)}`),

  createFolder: (accountId: string, input: { name: string; parentId?: string; folderColorRgb?: string; description?: string }) =>
    v2req<{ file: DriveNode }>(`${base(accountId)}/folders`, { method: "POST", body: JSON.stringify(input) }),
  rename: (accountId: string, fileId: string, name: string) =>
    v2req<{ file: DriveNode }>(`${base(accountId)}/files/${fileId}/rename`, { method: "PATCH", body: JSON.stringify({ name }) }),
  setStar: (accountId: string, fileId: string, starred: boolean) =>
    v2req<{ file: DriveNode }>(`${base(accountId)}/files/${fileId}/star`, { method: "PATCH", body: JSON.stringify({ starred }) }),
  setTrash: (accountId: string, fileId: string, trashed: boolean) =>
    v2req<{ file: DriveNode }>(`${base(accountId)}/files/${fileId}/trash`, { method: "PATCH", body: JSON.stringify({ trashed }) }),
  updateMeta: (accountId: string, fileId: string, patch: { description?: string; folderColorRgb?: string }) =>
    v2req<{ file: DriveNode }>(`${base(accountId)}/files/${fileId}/meta`, { method: "PATCH", body: JSON.stringify(patch) }),
  move: (accountId: string, fileId: string, addParents: string[], removeParents: string[]) =>
    v2req<{ file: DriveNode }>(`${base(accountId)}/files/${fileId}/move`, { method: "POST", body: JSON.stringify({ addParents, removeParents }) }),
  copy: (accountId: string, fileId: string, opts: { name?: string; parents?: string[] } = {}) =>
    v2req<{ file: DriveNode }>(`${base(accountId)}/files/${fileId}/copy`, { method: "POST", body: JSON.stringify(opts) }),
  deletePermanent: (accountId: string, fileId: string) => v2req<{ ok: boolean }>(`${base(accountId)}/files/${fileId}`, { method: "DELETE" }),
  emptyTrash: (accountId: string, driveId?: string) => v2req<{ ok: boolean }>(`${base(accountId)}/empty-trash${driveId ? `?driveId=${encodeURIComponent(driveId)}` : ""}`, { method: "POST" }),

  listPermissions: (accountId: string, fileId: string) => v2req<{ permissions: DrivePermission[] }>(`${base(accountId)}/files/${fileId}/permissions`),
  addPermission: (accountId: string, fileId: string, input: { role: string; type: string; emailAddress?: string; sendNotificationEmail?: boolean; message?: string }) =>
    v2req<{ permission: DrivePermission }>(`${base(accountId)}/files/${fileId}/permissions`, { method: "POST", body: JSON.stringify(input) }),
  updatePermission: (accountId: string, fileId: string, permId: string, role: string) =>
    v2req<{ permission: DrivePermission }>(`${base(accountId)}/files/${fileId}/permissions/${permId}`, { method: "PATCH", body: JSON.stringify({ role }) }),
  removePermission: (accountId: string, fileId: string, permId: string) =>
    v2req<{ ok: boolean }>(`${base(accountId)}/files/${fileId}/permissions/${permId}`, { method: "DELETE" }),

  listRevisions: (accountId: string, fileId: string) => v2req<{ revisions: DriveRevision[] }>(`${base(accountId)}/files/${fileId}/revisions`),
  deleteRevision: (accountId: string, fileId: string, revId: string) => v2req<{ ok: boolean }>(`${base(accountId)}/files/${fileId}/revisions/${revId}`, { method: "DELETE" }),
  updateRevision: (accountId: string, fileId: string, revId: string, keepForever: boolean) =>
    v2req<{ revision: DriveRevision }>(`${base(accountId)}/files/${fileId}/revisions/${revId}`, { method: "PATCH", body: JSON.stringify({ keepForever }) }),
};

export interface DriveRevision {
  id: string;
  modifiedTime?: string;
  size?: number;
  keepForever?: boolean;
  originalFilename?: string;
  lastModifyingUser?: { displayName?: string };
}
