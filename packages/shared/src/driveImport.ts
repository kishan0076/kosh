/**
 * Import-from-Drive-links — the pure, dependency-free, unit-tested core of the Drive V2 "Import" feature.
 *
 * The flow it powers:
 *
 *   pasted text ──parseDriveLinks()──▶ DriveLinkRef[]        (folder / file / bare ids, deduped)
 *   scanned source files + destination signatures ──detectDuplicates()──▶ DedupResult
 *   scanned tree + DedupResult + a collision strategy ──buildCopyPlan()──▶ CopyPlan
 *   CopyPlan ──(the web store executes it with the existing copy/createFolder endpoints)──▶ imported
 *
 * Everything here is deterministic and side-effect-free so it lives in @kosh/shared and is covered by
 * tests (per the repo golden rule "validate with shared logic"). The server does the recursive Drive
 * scan and the client orchestrates the copy — but the *decisions* (what's a duplicate, which folders to
 * recreate and in what order, which names to use) are made by these functions alone.
 */

/* ── 1. link / id parsing ─────────────────────────────────────────────────────────────────────── */

export type DriveLinkKind = "file" | "folder" | "unknown";

export interface DriveLinkRef {
  /** The Drive file/folder id extracted from the link. */
  id: string;
  /** What the link's shape tells us it is — `unknown` when only an id was recoverable (e.g. `open?id=`). */
  kind: DriveLinkKind;
  /** The original text the ref was parsed from (for surfacing back to the user). */
  raw: string;
}

const ID_CHARS = "[A-Za-z0-9_-]";
// A Drive id inside a URL path: `/d/{id}` (files & native docs) or `/folders/{id}` (folders).
const PATH_ID_RE = new RegExp(`/(?:d|folders)/(${ID_CHARS}{6,})`);
// A bare id pasted on its own — Drive ids are long, so require ≥10 chars to avoid matching plain words.
const BARE_ID_RE = new RegExp(`^${ID_CHARS}{10,}$`);
const QUERY_ID_RE = new RegExp(`[?&]id=(${ID_CHARS}{6,})`);

/** A bare token is only treated as a Drive id if it looks like one: id-charset, ≥10 chars, AND contains a
 *  digit. Real Drive ids are base64-ish and effectively always include digits, so this rejects pasted
 *  dictionary words ("my-notes-folder") while accepting genuine ids ("1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs"). */
function looksLikeBareId(raw: string): boolean {
  return BARE_ID_RE.test(raw) && /\d/.test(raw) && !raw.includes("/") && !raw.includes(":");
}

/** Google hosts that carry Drive ids (drive.google.com, docs.google.com, and their l10n/sub variants). */
function isGoogleHost(host: string): boolean {
  return /(^|\.)google\.com$/.test(host.toLowerCase());
}

/** Infer the kind (file/folder) from a Drive/Docs URL path. */
function kindFromPath(path: string): DriveLinkKind {
  if (/\/folders\//.test(path)) return "folder";
  // /file/d/…, /document/d/…, /spreadsheets/d/…, /presentation/d/…, /drawings/d/…, /forms/d/…
  if (/\/(file|document|spreadsheets|presentation|drawings|forms)\/d\//.test(path)) return "file";
  return "unknown";
}

/**
 * Parse a single Google Drive link (or bare id) into a `{ id, kind }` ref. Returns null when no Drive id
 * can be recovered. Handles every common share shape:
 *   • https://drive.google.com/drive/folders/ID   • …/drive/u/0/folders/ID
 *   • https://drive.google.com/file/d/ID/view      • https://drive.google.com/open?id=ID
 *   • https://drive.google.com/uc?id=ID&export=…   • https://docs.google.com/document/d/ID/edit
 *   • …/spreadsheets/d/ID • …/presentation/d/ID • …/drawings/d/ID • a bare ID
 */
export function parseDriveLink(input: string): DriveLinkRef | null {
  const raw = input.trim();
  if (!raw) return null;

  // A bare id pasted on its own — kind is unknown until the server resolves it.
  if (looksLikeBareId(raw)) {
    return { id: raw, kind: "unknown", raw };
  }

  let url: URL | null = null;
  try {
    url = new URL(raw);
  } catch {
    url = null;
  }

  if (url && isGoogleHost(url.hostname)) {
    // 1) explicit ?id= (open?id=…, uc?id=…) — kind stays unknown unless the path also says "folders".
    const qid = url.searchParams.get("id");
    if (qid && new RegExp(`^${ID_CHARS}{6,}$`).test(qid)) {
      return { id: qid, kind: /\/folders?\b/.test(url.pathname) ? "folder" : "unknown", raw };
    }
    // 2) an id embedded in the path (/d/… or /folders/…).
    const pm = url.pathname.match(PATH_ID_RE);
    if (pm) return { id: pm[1]!, kind: kindFromPath(url.pathname), raw };
    return null;
  }

  // Not a parseable URL (or a non-Google host) — still try to salvage an id from raw text, since users
  // paste half-URLs and query fragments. Prefer a path id (carries kind) over a bare `id=` param.
  const pm = raw.match(PATH_ID_RE);
  if (pm) return { id: pm[1]!, kind: kindFromPath(raw), raw };
  const qm = raw.match(QUERY_ID_RE);
  if (qm) return { id: qm[1]!, kind: "unknown", raw };
  return null;
}

/**
 * Parse many links from free-form pasted text (newlines, commas or spaces between them). De-duplicates by
 * id, preserving first-seen order, so pasting the same folder twice imports it once.
 */
export function parseDriveLinks(text: string): DriveLinkRef[] {
  const out: DriveLinkRef[] = [];
  const seen = new Set<string>();
  for (const tok of text.split(/[\s,]+/)) {
    const ref = parseDriveLink(tok);
    if (ref && !seen.has(ref.id)) {
      seen.add(ref.id);
      out.push(ref);
    }
  }
  return out;
}

/* ── 2. duplicate detection ───────────────────────────────────────────────────────────────────── */

/** The subset of a scanned file the dedupe/plan logic needs. */
export interface ScanFileLite {
  id: string;
  name: string;
  mimeType?: string;
  size?: number;
  md5Checksum?: string;
}

/**
 * A CONTENT signature for duplicate matching, or `null` when the file has no reliable content fingerprint.
 *
 * Only binary files carry an md5 checksum (Drive's own duplicate signal, name-independent). Native Google
 * docs (Docs/Sheets/Slides), shortcuts, etc. have NO md5 — and matching them on name+type alone is unsafe:
 * two genuinely different docs named "Meeting Notes" (or the ubiquitous "Untitled document") would collide
 * and, under the default skip strategy, the user's distinct file would be silently dropped. So a file with
 * no md5 gets NO signature and is never auto-classified as a duplicate — it always imports.
 */
export function fileSignature(f: ScanFileLite): string | null {
  return f.md5Checksum ? `md5:${f.md5Checksum}` : null;
}

/** `new` — not present anywhere yet · `dupInDest` — already in the destination Drive · `dupInSource` —
 *  a second (or later) copy of the same content within the pasted links themselves. */
export type DupStatus = "new" | "dupInDest" | "dupInSource";

export interface DedupResult {
  /** Per source-file classification. */
  statusById: Record<string, DupStatus>;
  counts: Record<DupStatus, number>;
  bytes: Record<DupStatus, number>;
}

/**
 * Classify every scanned source file against (a) the signatures already present in the destination Drive
 * and (b) the files earlier in the scan. Destination match wins over an intra-source match, and the FIRST
 * occurrence of a signature not in the destination is `new` while later ones are `dupInSource`.
 */
export function detectDuplicates(sourceFiles: ScanFileLite[], destSignatures: Iterable<string>): DedupResult {
  const dest = destSignatures instanceof Set ? (destSignatures as Set<string>) : new Set(destSignatures);
  const seen = new Set<string>();
  const statusById: Record<string, DupStatus> = {};
  const counts: Record<DupStatus, number> = { new: 0, dupInDest: 0, dupInSource: 0 };
  const bytes: Record<DupStatus, number> = { new: 0, dupInDest: 0, dupInSource: 0 };
  for (const f of sourceFiles) {
    const sig = fileSignature(f);
    let status: DupStatus;
    // No content signature (native docs, shortcuts) ⇒ never a duplicate — always import it.
    if (!sig) status = "new";
    else if (dest.has(sig)) status = "dupInDest";
    else if (seen.has(sig)) status = "dupInSource";
    else status = "new";
    if (sig) seen.add(sig);
    statusById[f.id] = status;
    counts[status]++;
    bytes[status] += f.size ?? 0;
  }
  return { statusById, counts, bytes };
}

/* ── 3. copy-plan builder ─────────────────────────────────────────────────────────────────────── */

/** A folder discovered in the source. `parentId` undefined ⇒ a root-level folder (attaches to the destination). */
export interface ScanFolderLite {
  id: string;
  name: string;
  parentId?: string;
}
/** A file discovered in the source. `parentId` undefined ⇒ a root-level file (goes directly into the destination). */
export interface ScanFileNode extends ScanFileLite {
  parentId?: string;
}
export interface ImportTree {
  folders: ScanFolderLite[];
  files: ScanFileNode[];
}

/** What to do with files that already exist (in the destination, or repeated within the source). */
export type CollisionStrategy = "skip" | "copy" | "rename";
/** A per-file override of the effective decision. */
export type FileDecision = "skip" | "copy" | "rename";

/** The placeholder parent-ref meaning "the destination folder the user picked" (resolved at execution). */
export const DEST_ROOT = "$dest";

/** A folder the executor must create (in array order — parents always precede their children). */
export interface PlanFolder {
  ref: string; // stable placeholder the executor maps to the real created id
  name: string;
  parentRef: string; // DEST_ROOT or another folder's ref
  sourceId: string;
}
/** A file the executor must copy (or skip). */
export interface PlanCopy {
  sourceId: string;
  name: string; // the target name — same as source, or suffixed when the decision is "rename"
  originalName: string;
  parentRef: string; // DEST_ROOT or a folder ref
  status: DupStatus;
  decision: FileDecision;
  skipped: boolean;
  size?: number;
}
export interface CopyPlan {
  folders: PlanFolder[];
  copies: PlanCopy[];
  stats: {
    foldersToCreate: number;
    filesToCopy: number;
    filesSkipped: number;
    bytesToCopy: number;
  };
}

export interface BuildPlanInput {
  tree: ImportTree;
  dedup: DedupResult;
  /** How to treat duplicates (dupInDest + dupInSource). New files are always copied. */
  strategy: CollisionStrategy;
  /** Per source-file-id override of the effective decision (from the UI's per-row control). */
  overrides?: Record<string, FileDecision>;
  /** Drop folders that would end up empty after skips (default true — don't recreate folders of skipped dups). */
  pruneEmptyFolders?: boolean;
  /** The suffix appended to a name when the decision is "rename" (keep both). */
  renameSuffix?: string;
}

const folderRef = (id: string): string => `f:${id}`;

/** Insert a suffix before the file extension: "report.pdf" → "report (copy).pdf"; "notes" → "notes (copy)". */
export function suffixName(name: string, suffix = " (copy)"): string {
  const dot = name.lastIndexOf(".");
  if (dot > 0 && dot < name.length - 1) return name.slice(0, dot) + suffix + name.slice(dot);
  return name + suffix;
}

/**
 * Turn a scanned tree + dedupe result + strategy into an ordered, executable plan: which folders to
 * recreate (topologically, parents first) and which files to copy, honoring per-file overrides and
 * pruning folders left empty by skipped duplicates. Never mutates its inputs.
 */
export function buildCopyPlan(input: BuildPlanInput): CopyPlan {
  const { tree, dedup, strategy } = input;
  const overrides = input.overrides ?? {};
  const prune = input.pruneEmptyFolders ?? true;
  const suffix = input.renameSuffix ?? " (copy)";

  const folderById = new Map(tree.folders.map((f) => [f.id, f]));
  const folderIds = new Set(folderById.keys());
  const parentRefOf = (parentId?: string): string => (parentId && folderIds.has(parentId) ? folderRef(parentId) : DEST_ROOT);

  // Depth within the scanned folder set — for a stable parents-before-children ordering (guards cycles).
  const depthCache = new Map<string, number>();
  const depthOf = (id: string): number => {
    const cached = depthCache.get(id);
    if (cached != null) return cached;
    let depth = 0;
    let cur = folderById.get(id);
    const guard = new Set<string>();
    while (cur?.parentId && folderIds.has(cur.parentId) && !guard.has(cur.id)) {
      guard.add(cur.id);
      depth++;
      cur = folderById.get(cur.parentId);
    }
    depthCache.set(id, depth);
    return depth;
  };

  // Decide every file first — folder pruning depends on which copies survive.
  const copies: PlanCopy[] = tree.files.map((file) => {
    const status = dedup.statusById[file.id] ?? "new";
    const decision: FileDecision = overrides[file.id] ?? (status === "new" ? "copy" : strategy);
    const skipped = decision === "skip";
    return {
      sourceId: file.id,
      name: decision === "rename" ? suffixName(file.name, suffix) : file.name,
      originalName: file.name,
      parentRef: parentRefOf(file.parentId),
      status,
      decision,
      skipped,
      size: file.size,
    };
  });

  // Pruning drops only folders left EMPTY BY SKIPS — never a genuinely-empty source folder (those are
  // preserved so the imported tree mirrors the source). `needed` = folders that still receive a surviving
  // copy; `hadFile` = folders that directly held any source file. A folder is KEPT when it still receives a
  // copy, or it never held a file at all (genuinely empty). Then close over ancestors so every kept folder's
  // parent chain also exists — otherwise a preserved empty child of a skip-emptied parent would be orphaned.
  let plannedFolders = tree.folders;
  if (prune) {
    const needed = new Set<string>();
    const hadFile = new Set<string>();
    for (const c of copies) {
      if (!c.parentRef.startsWith("f:")) continue;
      const folderId = c.parentRef.slice(2);
      hadFile.add(folderId);
      if (!c.skipped) needed.add(folderId);
    }
    const keep = new Set<string>();
    const addWithAncestors = (id: string) => {
      let cur: string | undefined = id;
      const guard = new Set<string>();
      while (cur && folderIds.has(cur) && !keep.has(cur) && !guard.has(cur)) {
        guard.add(cur);
        keep.add(cur);
        cur = folderById.get(cur)?.parentId;
      }
    };
    for (const f of tree.folders) {
      if (needed.has(f.id) || !hadFile.has(f.id)) addWithAncestors(f.id);
    }
    plannedFolders = tree.folders.filter((f) => keep.has(f.id));
  }

  const folders: PlanFolder[] = [...plannedFolders]
    .sort((a, b) => depthOf(a.id) - depthOf(b.id) || a.name.localeCompare(b.name))
    .map((f) => ({ ref: folderRef(f.id), name: f.name, sourceId: f.id, parentRef: parentRefOf(f.parentId) }));

  let filesToCopy = 0;
  let filesSkipped = 0;
  let bytesToCopy = 0;
  for (const c of copies) {
    if (c.skipped) filesSkipped++;
    else {
      filesToCopy++;
      bytesToCopy += c.size ?? 0;
    }
  }

  return { folders, copies, stats: { foldersToCreate: folders.length, filesToCopy, filesSkipped, bytesToCopy } };
}

/* ── 4. small display helpers ─────────────────────────────────────────────────────────────────── */

export interface ImportTreeSummary {
  folderCount: number;
  fileCount: number;
  totalBytes: number;
}

/** Roll up a scanned tree for the header stats (folders, files, total bytes). */
export function summarizeImportTree(tree: ImportTree): ImportTreeSummary {
  return {
    folderCount: tree.folders.length,
    fileCount: tree.files.length,
    totalBytes: tree.files.reduce((a, f) => a + (f.size ?? 0), 0),
  };
}
