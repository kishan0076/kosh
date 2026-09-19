import { API_BASE, ApiError } from "./api";

/* ── typed client for /drive-v2/* (management CRUD is server-proxied) ── */

async function v2req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
    ...init,
  });
  if (!res.ok) {
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

export type DriveKind = "folder" | "doc" | "sheet" | "slide" | "image" | "video" | "audio" | "pdf" | "archive" | "other";
export type FilterKind = "folder" | "doc" | "image" | "video" | "pdf" | "audio" | "archive";

/** Classify a node into a display/filter bucket by its mime type. */
export function kindOf(node: DriveNode): DriveKind {
  const m = node.mimeType || "";
  if (node.isFolder || m === FOLDER_MIME) return "folder";
  if (m === "application/pdf") return "pdf";
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("audio/")) return "audio";
  if (m.includes("spreadsheet") || m === "text/csv") return "sheet";
  if (m.includes("presentation")) return "slide";
  if (m.includes("document") || m.startsWith("text/") || m.includes("word")) return "doc";
  if (/zip|tar|gzip|compressed|rar|7z/.test(m)) return "archive";
  return "other";
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

export const driveV2Api = {
  list: (accountId: string, parent = "root", opts: { pageToken?: string; orderBy?: string } = {}) => {
    const q = new URLSearchParams({ parent });
    if (opts.pageToken) q.set("pageToken", opts.pageToken);
    if (opts.orderBy) q.set("orderBy", opts.orderBy);
    return v2req<ListResult>(`${base(accountId)}/list?${q}`);
  },
  search: (accountId: string, params: { text?: string; starred?: boolean; pageToken?: string }) => {
    const q = new URLSearchParams();
    if (params.text) q.set("text", params.text);
    if (params.starred) q.set("starred", "true");
    if (params.pageToken) q.set("pageToken", params.pageToken);
    return v2req<ListResult>(`${base(accountId)}/search?${q}`);
  },
  recent: (accountId: string, pageToken?: string) => v2req<ListResult>(`${base(accountId)}/recent${pageToken ? `?pageToken=${encodeURIComponent(pageToken)}` : ""}`),
  starred: (accountId: string, pageToken?: string) => v2req<ListResult>(`${base(accountId)}/starred${pageToken ? `?pageToken=${encodeURIComponent(pageToken)}` : ""}`),
  trash: (accountId: string, pageToken?: string) => v2req<ListResult>(`${base(accountId)}/trash${pageToken ? `?pageToken=${encodeURIComponent(pageToken)}` : ""}`),
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
  emptyTrash: (accountId: string) => v2req<{ ok: boolean }>(`${base(accountId)}/empty-trash`, { method: "POST" }),

  listPermissions: (accountId: string, fileId: string) => v2req<{ permissions: DrivePermission[] }>(`${base(accountId)}/files/${fileId}/permissions`),
  addPermission: (accountId: string, fileId: string, input: { role: string; type: string; emailAddress?: string; sendNotificationEmail?: boolean; message?: string }) =>
    v2req<{ permission: DrivePermission }>(`${base(accountId)}/files/${fileId}/permissions`, { method: "POST", body: JSON.stringify(input) }),
  updatePermission: (accountId: string, fileId: string, permId: string, role: string) =>
    v2req<{ permission: DrivePermission }>(`${base(accountId)}/files/${fileId}/permissions/${permId}`, { method: "PATCH", body: JSON.stringify({ role }) }),
  removePermission: (accountId: string, fileId: string, permId: string) =>
    v2req<{ ok: boolean }>(`${base(accountId)}/files/${fileId}/permissions/${permId}`, { method: "DELETE" }),
};
