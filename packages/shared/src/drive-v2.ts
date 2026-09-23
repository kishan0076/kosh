/**
 * Pure domain logic for the Drive V2 file manager — extracted here (dependency-free, unit-tested) per
 * the repo golden rule. The web store/UI wrap these under their existing names (kindOf, sortNodes,
 * parseSearch, dedupeActivity) so callers are unchanged; this file is the single source of truth.
 */

export const DRIVE_FOLDER_MIME = "application/vnd.google-apps.folder";

export type DriveKind = "folder" | "doc" | "sheet" | "slide" | "image" | "video" | "audio" | "pdf" | "archive" | "other";
export type DriveSortKey = "name" | "modified" | "size" | "kind";
export type DriveSortDir = "asc" | "desc";

/** Classify a node into a coarse kind from its mime type (folders first). */
export function driveKindOf(node: { mimeType?: string; isFolder?: boolean }): DriveKind {
  const m = node.mimeType || "";
  if (node.isFolder || m === DRIVE_FOLDER_MIME) return "folder";
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

export interface SortableNode {
  name: string;
  isFolder: boolean;
  mimeType?: string;
  modifiedTime?: string;
  size?: number;
}

// Reused across every comparison instead of constructing an implicit collator per `localeCompare` call
// — this is the hot path for large folders (re-sorted on each nodes/prefs change).
const nameCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "variant" });

/**
 * Order nodes for display — folders always first, then by the chosen key. Returns a new array; the
 * single source of truth for visible order (grid/list AND bulk-rename sequential numbering).
 */
export function sortDriveNodes<T extends SortableNode>(nodes: T[], key: DriveSortKey, dir: DriveSortDir): T[] {
  return [...nodes].sort((a, b) => {
    if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1; // folders always first
    let c = 0;
    if (key === "name") c = nameCollator.compare(a.name, b.name);
    else if (key === "modified") c = (a.modifiedTime ?? "").localeCompare(b.modifiedTime ?? "");
    else if (key === "size") c = (a.size ?? 0) - (b.size ?? 0);
    // Kind sort tiebreaks by name using the SAME natural/numeric collator as the name sort, so within a
    // kind "file2" precedes "file10" (consistent with every other name ordering in the app).
    else c = driveKindOf(a).localeCompare(driveKindOf(b)) || nameCollator.compare(a.name, b.name);
    return dir === "asc" ? c : -c;
  });
}

export interface DriveSearchParams {
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

/** Map a `type:` operator value to a Drive mime filter. */
const TYPE_MAP: Record<string, { exact?: string; contains?: string }> = {
  pdf: { exact: "application/pdf" },
  image: { contains: "image/" },
  video: { contains: "video/" },
  audio: { contains: "audio/" },
  doc: { contains: "document" },
  sheet: { contains: "spreadsheet" },
  slide: { contains: "presentation" },
  zip: { contains: "zip" },
  folder: { exact: DRIVE_FOLDER_MIME },
};

/** Parse a search box query with operators (type: owner: before: after: is:starred) into API params. */
export function parseDriveSearch(query: string, ownerMe?: string): DriveSearchParams {
  const params: DriveSearchParams = {};
  const free: string[] = [];
  const toDate = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00` : v);
  for (const tok of query.trim().split(/\s+/).filter(Boolean)) {
    const m = tok.match(/^(\w+):(.+)$/);
    if (!m) {
      free.push(tok);
      continue;
    }
    const key = m[1]!.toLowerCase();
    const val = m[2]!;
    if (key === "type") {
      const mt = TYPE_MAP[val.toLowerCase()];
      if (mt?.exact) params.mimeType = mt.exact;
      else if (mt?.contains) params.mimeContains = mt.contains;
      else free.push(tok);
    } else if (key === "owner") params.owner = val.toLowerCase() === "me" ? ownerMe ?? "me" : val;
    else if (key === "before") params.before = toDate(val);
    else if (key === "after") params.after = toDate(val);
    else if (key === "is" && val.toLowerCase() === "starred") params.starred = true;
    else if (key === "starred") params.starred = val === "true";
    else free.push(tok);
  }
  if (free.length) params.text = free.join(" ");
  return params;
}

/* ── tags / labels (stored as a CSV in the app-private Drive `appProperties`) ── */

/** The single app-private property key holding a file's comma-separated tags. */
export const TAG_PROP_KEY = "koshTags";
/** Drive caps a property (key + value) at ~124 bytes; keep the CSV comfortably under that. */
export const MAX_TAG_LEN = 32;
export const MAX_TAGS_LEN = 110; // budget for the serialized CSV value

/** Normalize one tag: lowercase, trim, collapse inner whitespace, drop commas (the separator), cap length. */
export function normalizeTag(raw: string): string {
  return raw.toLowerCase().replace(/,/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_TAG_LEN);
}

/** Read a file's tags from its appProperties (deduped, order-preserving, empties dropped). */
export function parseTags(node: { appProperties?: Record<string, string> }): string[] {
  const raw = node.appProperties?.[TAG_PROP_KEY];
  if (!raw) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of raw.split(",")) {
    const t = normalizeTag(part);
    if (t && !seen.has(t)) { seen.add(t); out.push(t); }
  }
  return out;
}

/** Serialize tags back to the CSV value, deduped and length-bounded. Empty string ⇒ clear the property. */
export function serializeTags(tags: string[]): string {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of tags) {
    const t = normalizeTag(raw);
    if (!t || seen.has(t)) continue;
    if ([...out, t].join(",").length > MAX_TAGS_LEN) break; // stay within the property size budget
    seen.add(t);
    out.push(t);
  }
  return out.join(",");
}

/** Stable colour bucket [0, buckets) for a tag, so the same label always gets the same chip colour. */
export function tagColorIndex(tag: string, buckets: number): number {
  let h = 0;
  for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) | 0;
  return Math.abs(h) % Math.max(1, buckets);
}

export interface ActivityLike {
  fileId: string;
  time?: string;
  action: string;
}

/** Drop duplicate activity rows keyed by (fileId, time, action), keeping the first (newest) seen. */
export function dedupeDriveActivity<T extends ActivityLike>(list: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const e of list) {
    const key = `${e.fileId}|${e.time}|${e.action}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}
