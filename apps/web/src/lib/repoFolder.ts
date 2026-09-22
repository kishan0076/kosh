import { planRepoUpload, scanSecrets, type RepoFileMeta, type ScanFinding, type SkippedFile } from "@kosh/shared";

/** A file read from a picked folder, ready to send to the publish/push API. */
export interface LoadedRepoFile extends RepoFileMeta {
  content: string;
  encoding: "utf-8" | "base64";
}

export interface FolderPlan {
  topFolder: string;
  files: LoadedRepoFile[];
  skipped: SkippedFile[];
  findings: ScanFinding[];
  hasGitignore: boolean;
}

function toBase64(bytes: Uint8Array): { content: string; encoding: "base64" } {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return { content: btoa(bin), encoding: "base64" };
}

/**
 * Read a file as UTF-8 text, or fall back to base64 for anything that isn't valid UTF-8. A NUL byte
 * (binary) or a strict-decode failure (e.g. latin-1 / UTF-16 source) both route to base64 so the file
 * is pushed byte-exact instead of being silently corrupted by a lossy decode.
 */
export async function readContent(file: File): Promise<{ content: string; encoding: "utf-8" | "base64" }> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.includes(0)) return toBase64(bytes);
  try {
    return { content: new TextDecoder("utf-8", { fatal: true }).decode(bytes), encoding: "utf-8" };
  } catch {
    return toBase64(bytes);
  }
}

/** Drop the top path segment so files sit at the repo root. */
function stripTop(relPath: string): string {
  const parts = relPath.split("/");
  return parts.length > 1 ? parts.slice(1).join("/") : relPath;
}

/** One picked file plus its folder-relative path (e.g. "myproj/src/index.ts"). */
interface Picked {
  file: File;
  relPath: string;
}

/** Shared core: turn picked files into a filtered, read, secret-scanned upload plan. */
async function planFromPicked(picked: Picked[]): Promise<FolderPlan> {
  const topFolder = picked[0]?.relPath.split("/")[0] || "project";

  const byPath = new Map<string, File>();
  const meta: RepoFileMeta[] = [];
  for (const p of picked) {
    const path = stripTop(p.relPath);
    if (!path) continue;
    byPath.set(path, p.file);
    meta.push({ path, size: p.file.size });
  }
  const gi = byPath.get(".gitignore");
  const gitignore = gi && gi.size < 100_000 ? await gi.text() : undefined;

  const plan = planRepoUpload(meta, { gitignore });

  const files: LoadedRepoFile[] = [];
  const texts = new Map<string, string>();
  for (const m of plan.include) {
    const file = byPath.get(m.path);
    if (!file) continue;
    try {
      const { content, encoding } = await readContent(file);
      files.push({ path: m.path, size: m.size, content, encoding });
      if (encoding === "utf-8") texts.set(m.path, content);
    } catch {
      plan.skipped.push({ path: m.path, reason: "could not be read" });
    }
  }

  return { topFolder, files, skipped: plan.skipped, findings: scanSecrets(texts).findings, hasGitignore: byPath.has(".gitignore") };
}

/**
 * Read a picked directory (via a webkitdirectory <input>) into an upload plan: honors .gitignore +
 * build/dependency filters (planRepoUpload), reads only the included files, and scans text files for
 * secrets. All in-browser.
 */
export async function readFolderPlan(fileList: FileList): Promise<FolderPlan> {
  const picked = Array.from(fileList).map((f) => ({ file: f, relPath: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name }));
  return planFromPicked(picked);
}

/* ── drag-and-drop folder support (webkitGetAsEntry recursion) ── */

interface FsEntry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file?: (cb: (f: File) => void, err: (e: unknown) => void) => void;
  createReader?: () => { readEntries: (cb: (e: FsEntry[]) => void, err: (e: unknown) => void) => void };
}

function readAllEntries(reader: { readEntries: (cb: (e: FsEntry[]) => void, err: (e: unknown) => void) => void }): Promise<FsEntry[]> {
  return new Promise((resolve, reject) => {
    const all: FsEntry[] = [];
    const read = () => reader.readEntries((batch) => (batch.length ? (all.push(...batch), read()) : resolve(all)), reject);
    read();
  });
}

async function walkEntry(entry: FsEntry, prefix: string, out: Picked[]): Promise<void> {
  if (entry.isFile && entry.file) {
    const file = await new Promise<File>((res, rej) => entry.file!(res, rej));
    out.push({ file, relPath: prefix + entry.name });
  } else if (entry.isDirectory && entry.createReader) {
    const entries = await readAllEntries(entry.createReader());
    await Promise.all(entries.map((e) => walkEntry(e, `${prefix}${entry.name}/`, out)));
  }
}

/** Read a dropped folder (DataTransfer) into the same upload plan as the picker. */
export async function readDropPlan(dt: DataTransfer): Promise<FolderPlan> {
  const roots: FsEntry[] = [];
  for (const it of Array.from(dt.items)) {
    const entry = (it as unknown as { webkitGetAsEntry?: () => unknown }).webkitGetAsEntry?.();
    if (entry) roots.push(entry as FsEntry);
  }
  const picked: Picked[] = [];
  await Promise.all(roots.map((entry) => walkEntry(entry, "", picked)));
  return planFromPicked(picked);
}

/* ── git blob sha (for the upload dry-run: Added / Overwrites / Unchanged) ── */

function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Compute the git blob SHA-1 of a loaded file, matching how GitHub stores it, to compare against a tree. */
export async function gitBlobSha(file: { content: string; encoding: "utf-8" | "base64" }): Promise<string> {
  const body = file.encoding === "base64" ? decodeBase64(file.content) : new TextEncoder().encode(file.content);
  const header = new TextEncoder().encode(`blob ${body.length}\0`);
  const buf = new Uint8Array(header.length + body.length);
  buf.set(header, 0);
  buf.set(body, header.length);
  const digest = await crypto.subtle.digest("SHA-1", buf);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
