import {
  lintSkill,
  parseFrontmatter,
  scanSkill,
  type FoundVia,
  type Item,
  type ItemSource,
  type Skill,
  type SkillFile,
  type SkillVersion,
  type Tool,
} from "@kosh/shared";
import { getStore, type ServerItem, type ServerSkill } from "../db/index.js";
import { publish } from "../events.js";
import { getObject, putIfMissing, sha256 } from "../storage/objects.js";

const nowIso = () => new Date().toISOString();
const TEXT_MAX = 64 * 1024;
const VERIFY_MAX = 2_000_000; // re-hash objects up to 2 MB server-side (§6.3)

export interface IncomingFile {
  path: string;
  mime: string;
  content?: string; // utf8 text (inline)
  bytesBase64?: string; // binary (inline)
  sha256?: string; // reference to an object already uploaded via /uploads/init (§6.2)
  size?: number;
}

export interface CreateSkillOpts {
  origin: Skill["origin"];
  itemSource: ItemSource;
  name?: string;
  tools?: Tool[];
  note?: string;
  trust?: Skill["trust"];
  license?: string;
  foundVia?: FoundVia;
  source?: Skill["source"];
}

function stripCommonRoot(files: IncomingFile[]): IncomingFile[] {
  const withSlash = files.filter((f) => f.path.includes("/"));
  if (withSlash.length !== files.length || files.length === 0) return files;
  const first = files[0]!.path.split("/")[0]!;
  if (files.every((f) => f.path.startsWith(`${first}/`))) return files.map((f) => ({ ...f, path: f.path.slice(first.length + 1) }));
  return files;
}

function bufOf(f: IncomingFile): Buffer {
  if (f.content != null) return Buffer.from(f.content, "utf8");
  if (f.bytesBase64 != null) return Buffer.from(f.bytesBase64, "base64");
  return Buffer.alloc(0);
}

function sameFiles(a: SkillFile[], b: SkillFile[]): boolean {
  if (a.length !== b.length) return false;
  const as = a.map((f) => `${f.path}:${f.sha256}`).sort();
  const bs = b.map((f) => `${f.path}:${f.sha256}`).sort();
  return as.every((x, i) => x === bs[i]);
}

const inferTools = (files: IncomingFile[]): Tool[] => (files.some((f) => /\.mdx?$/i.test(f.path)) ? ["claude"] : ["generic"]);

/** Turn incoming files (inline bytes OR pre-uploaded sha256 refs) into stored SkillFiles +
 *  a map of small text contents for lint/scan. Shared by create and version paths. (§6.3) */
async function materializeFiles(userId: string, files: IncomingFile[]): Promise<{ skillFiles: SkillFile[]; texts: Map<string, string> }> {
  const texts = new Map<string, string>();
  const skillFiles: SkillFile[] = [];
  for (const f of files) {
    let buf: Buffer;
    let hash: string;
    let verified = true;
    if (f.content != null || f.bytesBase64 != null) {
      buf = bufOf(f);
      hash = sha256(buf);
      await putIfMissing(userId, hash, buf, f.mime);
    } else if (f.sha256) {
      const stored = await getObject(userId, f.sha256);
      if (!stored) throw new Error("OBJECT_MISSING");
      buf = stored;
      hash = f.sha256;
      if (buf.length <= VERIFY_MAX && sha256(buf) !== hash) throw new Error("HASH_MISMATCH");
      verified = buf.length <= VERIFY_MAX;
    } else {
      buf = Buffer.alloc(0);
      hash = sha256(buf);
      await putIfMissing(userId, hash, buf, f.mime);
    }
    const isText = /\.(md|mdx|txt|json|ya?ml|toml|csv|py|js|ts|tsx|jsx|sh|ps1|rb|go|rs|sql|html|css|svg)$/i.test(f.path);
    const content = isText && buf.length <= TEXT_MAX ? buf.toString("utf8") : undefined;
    if (content) texts.set(f.path, content);
    skillFiles.push({ path: f.path, objectId: hash, size: buf.length, mime: f.mime, sha256: hash, verified, content });
  }
  return { skillFiles, texts };
}

/** The single finalize path for every skill source (upload, bot, snapshot, editor, CLI, MCP). (§6.3) */
export async function createSkillVersion(
  userId: string,
  incoming: IncomingFile[],
  opts: CreateSkillOpts,
): Promise<{ skill: ServerSkill; item: ServerItem | null; changed: boolean }> {
  const store = getStore();
  const files = stripCommonRoot(incoming).filter((f) => !/(^|\/)(__MACOSX|\.DS_Store|node_modules)(\/|$)/.test(f.path));
  const entry = files.find((f) => /^SKILL\.md$/i.test(f.path));
  if (!entry) throw new Error("NO_SKILL_MD");

  const { skillFiles, texts } = await materializeFiles(userId, files);

  const { data: fm, content: body } = parseFrontmatter(texts.get(entry.path) ?? "");
  const name = (opts.name ?? (fm.name as string) ?? "").toString();
  const lint = lintSkill({ frontmatter: fm, body, files: skillFiles.map((f) => f.path), folderName: name });
  const scan = scanSkill(texts);
  const searchText = [...texts.values()].join("\n").slice(0, 200_000);
  const version: SkillVersion = {
    n: 1,
    createdAt: nowIso(),
    note: opts.note,
    entry: entry.path,
    files: skillFiles,
    frontmatter: fm,
    totalSize: skillFiles.reduce((a, f) => a + f.size, 0),
    lint,
    scan,
  };

  const existing = await store.skills.findOne({ userId, name, deletedAt: null });
  if (existing) {
    const last = existing.versions.at(-1);
    if (last && sameFiles(last.files, version.files)) {
      const item = await store.items.findById(existing.itemId);
      return { skill: existing, item, changed: false };
    }
    version.n = existing.latest + 1;
    const versions = [...existing.versions, version];
    let trust = existing.trust;
    if (scan.risky && trust === "reviewed") trust = "unreviewed";
    let origin = existing.origin;
    if (existing.origin === "repo" && opts.origin !== "repo") {
      origin = opts.origin;
      trust = "mine";
    }
    const updated = await store.skills.updateById(existing.id, {
      versions,
      latest: version.n,
      description: (fm.description as string) ?? existing.description,
      searchText,
      trust,
      origin,
      indexOnly: false,
      updatedAt: nowIso(),
    });
    const item = await store.items.findById(existing.itemId);
    if (item) publish(userId, { kind: "item.updated", item });
    return { skill: updated!, item, changed: true };
  }

  const now = nowIso();
  const itemId = crypto.randomUUID();
  const skill = await store.skills.create({
    userId,
    itemId,
    name,
    displayName: (fm.name as string) ?? name,
    description: (fm.description as string) ?? undefined,
    tools: opts.tools ?? inferTools(files),
    origin: opts.origin,
    source: opts.source,
    trust: opts.trust ?? (opts.origin === "repo" ? "unreviewed" : "mine"),
    license: opts.license ?? (fm.license as string) ?? undefined,
    latest: 1,
    versions: [version],
    usageCount: 0,
    searchText,
    createdAt: now,
    updatedAt: now,
  } as Omit<ServerSkill, "id">);

  const item = await store.items.create({
    id: itemId,
    userId,
    kind: "skill",
    skillId: skill.id,
    title: skill.displayName,
    description: skill.description,
    tags: (opts.tools ?? skill.tools) as string[],
    collections: [],
    stage: "to-try",
    source: opts.itemSource,
    status: "ready",
    foundVia: opts.foundVia,
    createdAt: now,
    updatedAt: now,
  } as ServerItem);

  publish(userId, { kind: "item.created", item });
  return { skill, item, changed: true };
}

/** Add a version to an EXISTING skill resolved by id (the in-app editor path, §6.8).
 *  Unlike createSkillVersion (resolve-by-name), this survives a frontmatter rename and
 *  persists tool/name/changelog-only edits as real versions instead of deduping them away. */
export async function addSkillVersion(
  userId: string,
  skillId: string,
  incoming: IncomingFile[],
  opts: { name?: string; tools?: Tool[]; note?: string },
): Promise<{ skill: ServerSkill; item: ServerItem | null; changed: boolean }> {
  const store = getStore();
  const existing = await store.skills.findById(skillId);
  if (!existing || existing.userId !== userId) throw new Error("SKILL_NOT_FOUND");
  const files = stripCommonRoot(incoming).filter((f) => !/(^|\/)(__MACOSX|\.DS_Store|node_modules)(\/|$)/.test(f.path));
  const entry = files.find((f) => /^SKILL\.md$/i.test(f.path));
  if (!entry) throw new Error("NO_SKILL_MD");

  const { skillFiles, texts } = await materializeFiles(userId, files);
  const { data: fm, content: body } = parseFrontmatter(texts.get(entry.path) ?? "");
  const newName = (opts.name || (fm.name as string) || existing.name).toString();
  if (newName !== existing.name) {
    const clash = await store.skills.findOne({ userId, name: newName, deletedAt: null });
    if (clash && clash.id !== existing.id) throw new Error("NAME_TAKEN");
  }
  const lint = lintSkill({ frontmatter: fm, body, files: skillFiles.map((f) => f.path), folderName: newName });
  const scan = scanSkill(texts);

  const last = existing.versions.at(-1);
  const filesUnchanged = !!last && sameFiles(last.files, skillFiles);
  const toolsChanged = !!opts.tools && (opts.tools.length !== existing.tools.length || opts.tools.some((t) => !existing.tools.includes(t)));
  const nameChanged = newName !== existing.name;
  if (filesUnchanged && !toolsChanged && !nameChanged && !opts.note) {
    const item = await store.items.findById(existing.itemId);
    return { skill: existing, item, changed: false };
  }

  const version: SkillVersion = {
    n: existing.latest + 1,
    createdAt: nowIso(),
    note: opts.note,
    entry: entry.path,
    files: skillFiles,
    frontmatter: fm,
    totalSize: skillFiles.reduce((a, f) => a + f.size, 0),
    lint,
    scan,
  };
  let trust = existing.trust;
  let origin = existing.origin;
  if (existing.origin === "repo") {
    origin = opts.name || fm.name ? "authored" : existing.origin;
    trust = "mine"; // editing a copy makes it yours (§6.3)
  } else if (scan.risky && trust === "reviewed") {
    trust = "unreviewed";
  }
  const updated = await store.skills.updateById(existing.id, {
    name: newName,
    displayName: (fm.name as string) ?? existing.displayName,
    versions: [...existing.versions, version],
    latest: version.n,
    description: (fm.description as string) ?? existing.description,
    searchText: [...texts.values()].join("\n").slice(0, 200_000),
    tools: opts.tools ?? existing.tools,
    trust,
    origin,
    updatedAt: nowIso(),
  });
  const item = await store.items.findById(existing.itemId);
  if (item) {
    await store.items.updateById(item.id, { title: updated!.displayName, description: updated!.description, updatedAt: nowIso() });
    publish(userId, { kind: "item.updated", item: (await store.items.findById(item.id))! });
  }
  return { skill: updated!, item, changed: true };
}

export function toClientSkill(s: ServerSkill): Skill {
  const { userId: _u, searchText: _s, ...rest } = s;
  return rest;
}
export function skillItem(item: ServerItem): Item {
  const { userId: _u, urlHash: _h, ...rest } = item;
  return rest;
}
