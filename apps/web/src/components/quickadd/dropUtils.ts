import { lintSkill, parseFrontmatter, scanSkill, type SkillFile } from "@kosh/shared";
import type { DropDraft } from "@/data/store";

export interface CollectedFile {
  path: string;
  size: number;
  mime: string;
  text?: string;
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
    out.push({ path, size: file.size, mime: mimeFor(path), text });
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
      out.push({ path: file.name, size: file.size, mime: mimeFor(file.name), text });
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
    out.push({ path, size: file.size, mime: mimeFor(path), text });
  }
  return out;
}

function stripCommonRoot(files: CollectedFile[]): CollectedFile[] {
  const withSlash = files.filter((f) => f.path.includes("/"));
  if (withSlash.length !== files.length || files.length === 0) return files;
  const first = files[0]!.path.split("/")[0];
  if (files.every((f) => f.path.startsWith(`${first}/`))) {
    return files.map((f) => ({ ...f, path: f.path.slice(first!.length + 1) }));
  }
  return files;
}

/** Group collected files into skill / file drafts (SKILL.md → skill). */
export function groupIntoDrafts(collected: CollectedFile[]): DropDraft[] {
  const files = collected.filter((f) => !/(^|\/)(__MACOSX|\.DS_Store|node_modules)(\/|$)/.test(f.path));
  const skillEntry = files.find((f) => /^SKILL\.md$/i.test(f.path));

  if (skillEntry) {
    const stripped = stripCommonRoot(files);
    const entry = stripped.find((f) => /^SKILL\.md$/i.test(f.path)) ?? stripped[0]!;
    const fm = entry.text ? parseFrontmatter(entry.text).data : {};
    const name = (fm.name as string) ?? "new-skill";
    const skillFiles: SkillFile[] = stripped.map((f) => ({ path: f.path, size: f.size, mime: f.mime, content: f.text }));
    const texts = new Map<string, string>();
    for (const f of stripped) if (f.text) texts.set(f.path, f.text);
    const lint = lintSkill({ frontmatter: fm, body: entry.text ? parseFrontmatter(entry.text).content : "", files: stripped.map((f) => f.path), folderName: name });
    const scan = scanSkill(texts);
    return [{ kind: "skill", name, files: skillFiles, lint, scan }];
  }

  return files.map((f) => ({ kind: "file", path: f.path, size: f.size, mime: f.mime }));
}
