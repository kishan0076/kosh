import { lintSkill, parseFrontmatter, scanSkill, type SkillFile } from "@kosh/shared";
import type { DropDraft } from "@/data/store";

export interface CollectedFile {
  path: string;
  size: number;
  mime: string;
  text?: string;
  blob: Blob; // raw bytes, for direct upload to storage (§6.2)
}

const TEXT_RE = /\.(md|mdx|txt|json|yaml|yml|toml|csv|py|js|ts|tsx|jsx|sh|ps1|rb|go|rs|sql|html|css|svg)$/i;

function mimeFor(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    md: "text/markdown",
    mdx: "text/markdown",
    txt: "text/plain",
    json: "application/json",
    py: "text/x-python",
    js: "text/javascript",
    ts: "text/typescript",
    sh: "text/x-shellscript",
    yml: "text/yaml",
    yaml: "text/yaml",
    png: "image/png",
    jpg: "image/jpeg",
    pdf: "application/pdf",
  };
  return map[ext] ?? "application/octet-stream";
}

async function readEntry(entry: FileSystemEntry, prefix: string, out: CollectedFile[]): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
    const path = `${prefix}${entry.name}`;
    const text = TEXT_RE.test(path) ? await file.text().catch(() => undefined) : undefined;
    out.push({ path, size: file.size, mime: mimeFor(path), text, blob: file });
  } else if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    const readBatch = () =>
      new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
    let batch = await readBatch();
    while (batch.length) {
      for (const e of batch) await readEntry(e, `${prefix}${entry.name}/`, out);
      batch = await readBatch();
    }
  }
}

/** Collect dropped files (with directory recursion when the browser supports it). */
export async function collectDrop(dt: DataTransfer): Promise<CollectedFile[]> {
  const out: CollectedFile[] = [];
  const entries: FileSystemEntry[] = [];
  for (const item of Array.from(dt.items)) {
    const entry = item.webkitGetAsEntry?.();
    if (entry) entries.push(entry);
  }
  if (entries.length) {
    for (const e of entries) await readEntry(e, "", out);
  } else {
    for (const file of Array.from(dt.files)) {
      const text = TEXT_RE.test(file.name) ? await file.text().catch(() => undefined) : undefined;
      out.push({ path: file.name, size: file.size, mime: mimeFor(file.name), text, blob: file });
    }
  }
  return out;
}

/** Read a FileList (from an <input type=file>). */
export async function collectFiles(files: FileList): Promise<CollectedFile[]> {
  const out: CollectedFile[] = [];
  for (const file of Array.from(files)) {
    const path = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    const text = TEXT_RE.test(path) ? await file.text().catch(() => undefined) : undefined;
    out.push({ path, size: file.size, mime: mimeFor(path), text, blob: file });
  }
  return out;
}

const SKILL_MD = /(^|\/)SKILL\.md$/i;

/** One skill draft from a folder's files (paths already relative to that folder). */
function skillDraft(files: CollectedFile[]): DropDraft {
  const entry = files.find((f) => /^SKILL\.md$/i.test(f.path)) ?? files[0]!;
  const fm = entry.text ? parseFrontmatter(entry.text).data : {};
  const name = (fm.name as string) ?? "new-skill";
  const skillFiles: SkillFile[] = files.map((f) => ({ path: f.path, size: f.size, mime: f.mime, content: f.text }));
  const blobs = files.map((f) => ({ path: f.path, mime: f.mime, blob: f.blob }));
  const texts = new Map<string, string>();
  for (const f of files) if (f.text) texts.set(f.path, f.text);
  const lint = lintSkill({ frontmatter: fm, body: entry.text ? parseFrontmatter(entry.text).content : "", files: files.map((f) => f.path), folderName: name });
  const scan = scanSkill(texts);
  return { kind: "skill", name, files: skillFiles, blobs, lint, scan };
}

/** Group collected files into skill / file drafts. Every folder holding a SKILL.md — at any depth, since
 *  both the folder picker (webkitRelativePath) and a dropped folder prefix paths with the folder's name —
 *  becomes one skill draft rooted at that folder; whatever sits outside a skill folder is a loose file. */
export function groupIntoDrafts(collected: CollectedFile[]): DropDraft[] {
  const files = collected.filter((f) => !/(^|\/)(__MACOSX|\.DS_Store|node_modules)(\/|$)/.test(f.path));
  // Skill roots ("" or "dir/"), shallowest first; a SKILL.md nested inside another skill's folder is
  // part of that skill, not a second one.
  const roots: string[] = [];
  const dirs = files
    .filter((f) => SKILL_MD.test(f.path))
    .map((f) => f.path.slice(0, f.path.length - "SKILL.md".length))
    .sort((a, b) => a.length - b.length);
  for (const dir of dirs) if (!roots.some((r) => dir.startsWith(r))) roots.push(dir);

  const drafts: DropDraft[] = roots.map((root) =>
    skillDraft(files.filter((f) => f.path.startsWith(root)).map((f) => ({ ...f, path: f.path.slice(root.length) }))),
  );
  for (const f of files) {
    if (roots.some((r) => f.path.startsWith(r))) continue;
    drafts.push({ kind: "file", path: f.path, size: f.size, mime: f.mime, blob: f.blob });
  }
  return drafts;
}
