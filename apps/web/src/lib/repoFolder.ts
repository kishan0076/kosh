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

/** Detect binary by content (a NUL byte). Reading a binary file as UTF-8 would corrupt it. */
export async function readContent(file: File): Promise<{ content: string; encoding: "utf-8" | "base64" }> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!bytes.includes(0)) return { content: new TextDecoder().decode(bytes), encoding: "utf-8" };
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return { content: btoa(bin), encoding: "base64" };
}

/** Strip the top-level folder the user picked so files sit at the repo root. */
export function repoPath(file: File): string {
  const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
  const parts = rel.split("/");
  return parts.length > 1 ? parts.slice(1).join("/") : rel;
}

/**
 * Read a picked directory into an upload plan: honors .gitignore + build/dependency filters
 * (planRepoUpload), reads only the included files, and scans text files for secrets. All in-browser.
 */
export async function readFolderPlan(fileList: FileList): Promise<FolderPlan> {
  const all = Array.from(fileList);
  const first = all[0];
  const topFolder = ((first as File & { webkitRelativePath?: string })?.webkitRelativePath || "").split("/")[0] || "project";

  const byPath = new Map<string, File>();
  const meta: RepoFileMeta[] = [];
  for (const f of all) {
    const path = repoPath(f);
    if (!path) continue;
    byPath.set(path, f);
    meta.push({ path, size: f.size });
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

  return {
    topFolder,
    files,
    skipped: plan.skipped,
    findings: scanSecrets(texts).findings,
    hasGitignore: byPath.has(".gitignore"),
  };
}
