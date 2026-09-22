/**
 * Thin wrapper over the File System Access API (Chromium-only) for scanning and fixing a LOCAL folder
 * on the user's machine — checking for a `.git` folder and `.gitignore`, and writing a `.gitignore`
 * back to disk. Everything is feature-detected; callers must handle the unsupported/cancelled cases.
 *
 * The browser cannot run `git init` (no shell access), so a missing `.git` is surfaced with guidance
 * (a copyable command / "Publish to GitHub"), while a missing `.gitignore` CAN be created here.
 */

/* Minimal structural types — the FS Access API isn't in every TS lib.dom version. */
interface FSFileHandle {
  kind: "file";
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(data: string | BufferSource | Blob): Promise<void>; close(): Promise<void> }>;
}
interface FSDirHandle {
  kind: "directory";
  name: string;
  entries(): AsyncIterableIterator<[string, FSFileHandle | FSDirHandle]>;
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<FSFileHandle>;
  queryPermission?(desc: { mode: "read" | "readwrite" }): Promise<PermissionState>;
  requestPermission?(desc: { mode: "read" | "readwrite" }): Promise<PermissionState>;
}
type PickerWindow = Window & { showDirectoryPicker?: (opts?: { mode?: "read" | "readwrite" }) => Promise<FSDirHandle> };

/** Opaque handle to a picked local directory (pass it back to writeGitignore). */
export type DirHandle = FSDirHandle;

/** True when this browser supports picking a local directory (Chromium/Edge; not Firefox/Safari). */
export function fsAccessSupported(): boolean {
  return typeof window !== "undefined" && typeof (window as PickerWindow).showDirectoryPicker === "function";
}

/** Prompt the user to pick a local folder (read+write). Returns null if they cancel. */
export async function pickDirectory(): Promise<FSDirHandle | null> {
  const picker = (window as PickerWindow).showDirectoryPicker;
  if (!picker) return null;
  try {
    return await picker({ mode: "readwrite" });
  } catch (err) {
    // AbortError = user cancelled the picker; anything else we also treat as "no selection".
    if ((err as { name?: string })?.name === "AbortError") return null;
    throw err;
  }
}

export interface GitScan {
  folderName: string;
  hasGit: boolean;
  hasGitignore: boolean;
  gitignore?: string; // contents, if present
  /** Top-level entry paths (names) — enough for stack detection (manifests live at the root). */
  entries: string[];
}

/** Scan a directory handle's top level for `.git` / `.gitignore` and collect entry names. */
export async function scanGitState(dir: FSDirHandle): Promise<GitScan> {
  let hasGit = false;
  let hasGitignore = false;
  let gitignore: string | undefined;
  const entries: string[] = [];
  for await (const [name, handle] of dir.entries()) {
    entries.push(name);
    if (name === ".git" && handle.kind === "directory") hasGit = true;
    if (name === ".gitignore" && handle.kind === "file") {
      hasGitignore = true;
      try {
        gitignore = await (handle as FSFileHandle).getFile().then((f) => f.text());
      } catch {
        /* unreadable — treat as present-but-empty */
      }
    }
  }
  return { folderName: dir.name, hasGit, hasGitignore, gitignore, entries };
}

/** Ensure we have read+write permission on the handle (may prompt). Returns true if granted. */
async function ensureWritable(dir: FSDirHandle): Promise<boolean> {
  if (!dir.queryPermission || !dir.requestPermission) return true; // older impls grant on pick
  const desc = { mode: "readwrite" as const };
  if ((await dir.queryPermission(desc)) === "granted") return true;
  return (await dir.requestPermission(desc)) === "granted";
}

/** Write (creating or overwriting) `.gitignore` in the folder. Throws if permission is denied. */
export async function writeGitignore(dir: FSDirHandle, content: string): Promise<void> {
  if (!(await ensureWritable(dir))) throw new Error("Write permission was denied for this folder.");
  const handle = await dir.getFileHandle(".gitignore", { create: true });
  const writable = await handle.createWritable();
  await writable.write(content);
  await writable.close();
}
