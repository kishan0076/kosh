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

/* ── downloads / exports ── */

export interface DriveExportFormat {
  label: string;
  mimeType: string; // the target export mime for files.export
  ext: string; // extension appended to the file name
}

/** files.export targets per native Google-app mime type. (CSV/TXT export only the first sheet/plain text — a Google limitation.) */
export const DRIVE_EXPORT_FORMATS: Record<string, DriveExportFormat[]> = {
  "application/vnd.google-apps.document": [
    { label: "PDF", mimeType: "application/pdf", ext: "pdf" },
    { label: "Word (.docx)", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ext: "docx" },
    { label: "Markdown (.md)", mimeType: "text/markdown", ext: "md" },
    { label: "Plain text (.txt)", mimeType: "text/plain", ext: "txt" },
  ],
  "application/vnd.google-apps.spreadsheet": [
    { label: "PDF", mimeType: "application/pdf", ext: "pdf" },
    { label: "Excel (.xlsx)", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ext: "xlsx" },
    { label: "CSV (.csv)", mimeType: "text/csv", ext: "csv" },
  ],
  "application/vnd.google-apps.presentation": [
    { label: "PDF", mimeType: "application/pdf", ext: "pdf" },
    { label: "PowerPoint (.pptx)", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", ext: "pptx" },
    { label: "Plain text (.txt)", mimeType: "text/plain", ext: "txt" },
  ],
  "application/vnd.google-apps.drawing": [
    { label: "PNG", mimeType: "image/png", ext: "png" },
    { label: "PDF", mimeType: "application/pdf", ext: "pdf" },
    { label: "SVG", mimeType: "image/svg+xml", ext: "svg" },
  ],
};

/** A native Google-app file (Doc/Sheet/Slide/Drawing/…) — has no binary bytes, must be EXPORTED, not
 *  downloaded via alt=media. Folders and shortcuts are excluded. */
export function isNativeGoogleDoc(mimeType?: string): boolean {
  return !!mimeType && mimeType.startsWith("application/vnd.google-apps.") && mimeType !== DRIVE_FOLDER_MIME && mimeType !== "application/vnd.google-apps.shortcut";
}

/** Available export targets for a native Google-app mime (empty for binary files / unknown native types). */
export function driveExportFormats(mimeType?: string): DriveExportFormat[] {
  return (mimeType && DRIVE_EXPORT_FORMATS[mimeType]) || [];
}

/** How to obtain plain text from a Drive file for AI (summaries / auto-tagging):
 *  - `export` a native Google doc to a text mime (Doc/Slides -> text/plain, Sheet -> text/csv),
 *  - read a text-y binary directly via alt=media,
 *  - or `null` for a type with no cheap text form (PDF/image/office/zip/drawing/folder). */
export function driveTextSource(mimeType?: string): { mode: "export"; exportMime: string } | { mode: "media" } | null {
  if (!mimeType) return null;
  if (isNativeGoogleDoc(mimeType)) {
    if (mimeType === "application/vnd.google-apps.spreadsheet") return { mode: "export", exportMime: "text/csv" };
    if (mimeType === "application/vnd.google-apps.document" || mimeType === "application/vnd.google-apps.presentation") return { mode: "export", exportMime: "text/plain" };
    return null; // drawing / form / etc. — no meaningful text export
  }
  if (mimeType.startsWith("text/") || mimeType === "application/json" || mimeType === "application/xml" || mimeType === "application/xhtml+xml") return { mode: "media" };
  return null; // binary (pdf/image/office/archive) — feeding bytes to the model is pointless
}

/** Whether a Drive file can yield plain text for the AI features (summarize / auto-tag). */
export function driveHasTextSource(mimeType?: string): boolean {
  return driveTextSource(mimeType) !== null;
}

/* ── cleanup wizard: deterministic reclaimable-space buckets ── */

/** The subset of a scanned Drive file the cleanup analysis needs. */
export interface CleanupFile {
  id: string;
  name: string;
  mimeType?: string;
  size?: number;
  quotaBytesUsed?: number;
  md5Checksum?: string;
  viewedByMeTime?: string;
  modifiedTime?: string;
}

export type CleanupBucketKey = "duplicates" | "stale" | "large";

export interface CleanupBucket {
  key: CleanupBucketKey;
  label: string;
  count: number; // files this bucket would move to trash
  bytes: number; // reclaimable bytes
  fileIds: string[]; // the files to trash (capped)
  sampleNames: string[]; // a few example names, for the digest / UI
  capped: boolean; // fileIds was truncated at the cap
}

export interface CleanupOptions {
  now?: number; // ms epoch (defaults to Date.now())
  staleDays?: number; // "not opened in N days" cutoff (default 365)
  largeBytes?: number; // "large file" threshold (default 100 MB)
  maxIdsPerBucket?: number; // safety cap on how many ids one apply can trash (default 500)
}

const cleanupSize = (f: CleanupFile) => f.size ?? f.quotaBytesUsed ?? 0;

/**
 * Deterministically bucket scanned files into reclaimable-space groups the cleanup wizard can act on:
 *  - duplicates: same md5 (keep the newest, trash the rest),
 *  - stale: not opened since the cutoff,
 *  - large: over the size threshold.
 * A file is claimed by at most one bucket (duplicates > stale > large) so counts/bytes never double-count.
 * File ids never go to the model — the client keeps them and maps a recommendation back by bucket key.
 */
export function computeCleanupBuckets(files: CleanupFile[], opts: CleanupOptions = {}): CleanupBucket[] {
  const now = opts.now ?? Date.now();
  const staleMs = (opts.staleDays ?? 365) * 24 * 60 * 60 * 1000;
  const largeBytes = opts.largeBytes ?? 100 * 1024 * 1024;
  const cap = opts.maxIdsPerBucket ?? 500;
  const claimed = new Set<string>();

  const finalize = (key: CleanupBucketKey, label: string, picked: CleanupFile[]): CleanupBucket | null => {
    if (!picked.length) return null;
    const ids = picked.map((f) => f.id).slice(0, cap);
    return {
      key,
      label,
      count: picked.length,
      bytes: picked.reduce((a, f) => a + cleanupSize(f), 0),
      fileIds: ids,
      sampleNames: picked.slice(0, 6).map((f) => f.name),
      capped: picked.length > cap,
    };
  };

  // Duplicates: group by checksum, keep the newest per group, trash the rest.
  const byHash = new Map<string, CleanupFile[]>();
  for (const f of files) {
    if (!f.md5Checksum) continue;
    let arr = byHash.get(f.md5Checksum);
    if (!arr) byHash.set(f.md5Checksum, (arr = []));
    arr.push(f);
  }
  const dups: CleanupFile[] = [];
  for (const group of byHash.values()) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => (b.modifiedTime ?? "").localeCompare(a.modifiedTime ?? ""));
    for (const f of sorted.slice(1)) { dups.push(f); claimed.add(f.id); } // keep sorted[0] (newest)
  }

  // Stale: explicitly not opened since the cutoff (never-opened files are left alone — too risky to auto-flag).
  const stale = files.filter((f) => {
    if (claimed.has(f.id) || !f.viewedByMeTime) return false;
    const t = Date.parse(f.viewedByMeTime);
    return Number.isFinite(t) && now - t > staleMs;
  });
  for (const f of stale) claimed.add(f.id);

  // Large: over the threshold, biggest first (review candidates, not necessarily junk).
  const large = files
    .filter((f) => !claimed.has(f.id) && cleanupSize(f) > largeBytes)
    .sort((a, b) => cleanupSize(b) - cleanupSize(a));
  for (const f of large) claimed.add(f.id);

  return [
    finalize("duplicates", "Duplicate files", dups),
    finalize("stale", "Not opened in a while", stale),
    finalize("large", "Large files", large),
  ].filter((b): b is CleanupBucket => b !== null);
}

/* ── sharing: access expiry eligibility ── */

/** The only roles Drive will attach an access-expiry to (never owner/organizer/fileOrganizer). */
export const EXPIRY_ROLES: ReadonlySet<string> = new Set(["reader", "commenter", "writer"]);

/**
 * Whether Drive permits an access expiry on a grant. Google only honours `expirationTime` for a
 * specific person/group (never `anyone`/`domain` link grants) holding a viewer/commenter/editor role.
 * The single source of truth for the client's expiry affordance and the server's validation guards.
 */
export function canGrantExpiry(type: string, role: string): boolean {
  return (type === "user" || type === "group") && EXPIRY_ROLES.has(role);
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
