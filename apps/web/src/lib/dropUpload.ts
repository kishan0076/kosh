/**
 * Recursive folder drag-and-drop / folder-picker upload.
 *
 * A folder drop (or a `<input webkitdirectory>` pick) has to preserve structure: the folder and every
 * nested subfolder must be recreated in Drive and each file uploaded into the right one. The browser only
 * exposes that tree through the (non-standard but universal) `DataTransferItem.webkitGetAsEntry()` API —
 * plain `dataTransfer.files` flattens a folder to nothing useful. This module turns either source into a
 * flat list of items, each tagged with the chain of folder names it belongs under, so the store can walk
 * it once, create folders on demand, and upload every file into its correct parent.
 */

export interface UploadItem {
  /** The file to upload, or null to mark a directory that must be created even though it holds no files. */
  file: File | null;
  /** Folder names (relative to the drop target) this item lives under; [] means the current folder. */
  dirs: string[];
}

/**
 * Synchronously capture the dropped entries. MUST be called inside the drop event handler BEFORE any
 * `await` — the browser clears `dataTransfer.items` once the handler returns, though the captured
 * `FileSystemEntry` objects stay readable asynchronously afterwards. Returns null when the entry API
 * isn't available (older browsers) so the caller can fall back to a flat `dataTransfer.files` upload.
 */
export function captureDropEntries(dt: DataTransfer): FileSystemEntry[] | null {
  const items = dt.items;
  if (!items || !items.length) return null;
  const entries: FileSystemEntry[] = [];
  let sawApi = false;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!it || it.kind !== "file") continue;
    const getAsEntry = it.webkitGetAsEntry?.bind(it);
    if (!getAsEntry) continue;
    sawApi = true;
    const entry = getAsEntry();
    if (entry) entries.push(entry);
  }
  return sawApi ? entries : null; // API absent entirely → let the caller use dataTransfer.files
}

/** Read a directory to completion — `readEntries` returns at most ~100 children per call, so loop. */
function readAllChildren(dir: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    const reader = dir.createReader();
    const acc: FileSystemEntry[] = [];
    const pump = () =>
      reader.readEntries((batch) => {
        if (!batch.length) { resolve(acc); return; }
        acc.push(...batch);
        pump();
      }, reject);
    pump();
  });
}

function fileOf(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

async function walk(entry: FileSystemEntry, dirs: string[], out: UploadItem[]): Promise<void> {
  if (entry.isFile) {
    try {
      out.push({ file: await fileOf(entry as FileSystemFileEntry), dirs });
    } catch {
      /* unreadable file (permission / gone) — skip it rather than aborting the whole drop */
    }
    return;
  }
  if (entry.isDirectory) {
    const here = [...dirs, entry.name];
    let children: FileSystemEntry[] = [];
    try {
      children = await readAllChildren(entry as FileSystemDirectoryEntry);
    } catch {
      /* unreadable dir — still record it below so an empty placeholder is created */
    }
    // Preserve an empty folder as a file-less marker; non-empty folders are created lazily from their
    // files' `dirs`, so no marker is needed for them.
    if (!children.length) { out.push({ file: null, dirs: here }); return; }
    for (const child of children) await walk(child, here, out);
  }
}

/** Walk the captured entries into the flat upload list (files with their folder chain + empty-dir markers). */
export async function walkDropEntries(entries: FileSystemEntry[]): Promise<UploadItem[]> {
  const out: UploadItem[] = [];
  for (const entry of entries) await walk(entry, [], out);
  return out;
}

/**
 * Convert a `<input webkitdirectory>` FileList into upload items. Each picked file carries a
 * `webkitRelativePath` like "top/sub/file.ext"; we split off the file name to get its folder chain.
 * A plain (non-directory) selection has empty relative paths, so everything lands in the current folder.
 */
export function fileListToUploadItems(files: FileList | File[]): UploadItem[] {
  const out: UploadItem[] = [];
  for (const file of Array.from(files)) {
    const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath || "";
    const parts = rel ? rel.split("/").filter(Boolean) : [file.name];
    out.push({ file, dirs: parts.slice(0, -1) });
  }
  return out;
}
