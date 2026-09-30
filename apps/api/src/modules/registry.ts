import {
  rankRegistry,
  skillRisk,
  toRegistryEntry,
  type RegistryEntry,
  type RegistryFilters,
  type RegistrySort,
  type ScanResult,
  type SkillVersion,
} from "@kosh/shared";
import { getStore, type ServerSkill } from "../db/index.js";
import { getObject } from "../storage/objects.js";
import { withKeyLock } from "../lib/keylock.js";
import { createSkillVersion, toClientSkill, type IncomingFile } from "./skills.js";

/**
 * Skill registry — the cross-user discovery + install layer over the scan/trust model. Any skill a user
 * marks `public` is listed here; installing one copies it into the caller's vault as `trust: "unreviewed"`
 * (a stranger's code), re-running the static scan so a risky skill stays unreviewed and the UI can gate the
 * install behind a findings confirm. Only safe, public fields are ever exposed — never a userId, searchText,
 * or another user's private skills.
 */

/** Resolve author display info, cached across a listing so N public skills → few user reads. */
async function authorResolver() {
  const cache = new Map<string, { login?: string; name?: string } | undefined>();
  return async (userId: string) => {
    if (cache.has(userId)) return cache.get(userId);
    const u = await getStore().users.findById(userId).catch(() => null);
    const a = u ? { login: u.login, name: u.name } : undefined;
    cache.set(userId, a);
    return a;
  };
}

/** List the public catalog, ranked + filtered. */
export async function listRegistry(filters: RegistryFilters, sort: RegistrySort): Promise<RegistryEntry[]> {
  const skills = await getStore().skills.find({ public: true, deletedAt: null });
  const authorOf = await authorResolver();
  const entries: RegistryEntry[] = [];
  for (const s of skills) {
    if (!s.versions?.length) continue; // index-only / malformed → not installable, hide it
    entries.push(toRegistryEntry(toClientSkill(s), { author: await authorOf(s.userId), installs: s.installCount ?? 0 }));
  }
  return rankRegistry(entries, filters, sort);
}

export interface RegistryDetail {
  entry: RegistryEntry;
  /** The latest version's files (text content inline for review; binary bytes are omitted). */
  files: { path: string; mime: string; size: number; content?: string }[];
  scan: ScanResult;
  versions: { n: number; createdAt: string; note?: string; risky: boolean }[];
}

/** One public skill's detail — enough to review before installing (files + scan findings + version history). */
export async function getRegistryDetail(id: string): Promise<RegistryDetail | null> {
  const s = await getStore().skills.findById(id);
  if (!s || !s.public || s.deletedAt) return null;
  const authorOf = await authorResolver();
  const v: SkillVersion | undefined = s.versions.find((x) => x.n === s.latest) ?? s.versions.at(-1);
  if (!v) return null;
  return {
    entry: toRegistryEntry(toClientSkill(s), { author: await authorOf(s.userId), installs: s.installCount ?? 0 }),
    files: v.files.map((f) => ({ path: f.path, mime: f.mime, size: f.size, content: f.content })),
    scan: v.scan,
    versions: s.versions.map((x) => ({ n: x.n, createdAt: x.createdAt, note: x.note, risky: !!x.scan?.risky })),
  };
}

/** A name not already taken by one of the installer's live skills (append -2, -3, … as needed). */
async function uniqueName(userId: string, base: string): Promise<string> {
  const mine = await getStore().skills.find({ userId, deletedAt: null });
  const taken = new Set(mine.map((s) => s.name.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return `${base}-${Date.now()}`;
}

export interface InstallResult {
  skill: ReturnType<typeof toClientSkill>;
  duplicate: boolean;
  risky: boolean;
  findingCount: number;
}

/**
 * Install a public skill into the caller's vault: copy its latest version's files, land it `unreviewed`, and
 * record a synthetic `source` marker so a re-install is idempotent. Bumps the source skill's installCount.
 */
export async function installFromRegistry(installerId: string, id: string): Promise<InstallResult | "not_found"> {
  const store = getStore();
  const src = await store.skills.findById(id);
  if (!src || !src.public || src.deletedAt) return "not_found";

  const risk = skillRisk(src);

  // Installing your own listing is a no-op — it's already yours.
  if (src.userId === installerId) {
    return { skill: toClientSkill(src), duplicate: true, risky: risk.risky, findingCount: risk.findingCount };
  }
  // Serialize install per (installer, listing): the dedup check and the copy-create below are a check-then-act
  // with many awaits between them and no unique index on the (userId, source) dedup key, so two concurrent
  // installs of the same listing would otherwise both miss `already` and create duplicate copies.
  return withKeyLock(`install:${installerId}:${id}`, async () => {
    // Already installed from this exact listing → return the existing copy instead of duplicating it.
    const already = await store.skills.findOne({ userId: installerId, "source.repo": "registry", "source.path": id, deletedAt: null });
    if (already) return { skill: toClientSkill(already), duplicate: true, risky: risk.risky, findingCount: risk.findingCount };

    const v = src.versions.find((x) => x.n === src.latest) ?? src.versions.at(-1);
    if (!v) return "not_found" as const;

    // Build the copy's files: inline text as-is; binary bytes read from the AUTHOR's object store (per-user).
    const files: IncomingFile[] = [];
    for (const f of v.files) {
      if (f.content != null) {
        files.push({ path: f.path, mime: f.mime, content: f.content });
      } else if (f.sha256) {
        const buf = await getObject(src.userId, f.sha256);
        // Fail loudly rather than silently install a 0-byte file if the author's object is gone.
        if (!buf) throw new Error("SKILL_FILE_UNAVAILABLE");
        files.push({ path: f.path, mime: f.mime, bytesBase64: buf.toString("base64") });
      } else {
        files.push({ path: f.path, mime: f.mime, content: "" });
      }
    }

    const name = await uniqueName(installerId, src.name);
    const { skill } = await createSkillVersion(installerId, files, {
      origin: "repo", // a copy from elsewhere — not authored here
      itemSource: "web",
      name,
      tools: src.tools,
      trust: "unreviewed", // golden rule: a stranger's skill is never auto-trusted
      license: src.license,
      // Attribution + an idempotency marker so re-installs resolve to this same copy.
      source: { owner: src.source?.owner, repo: "registry", path: id },
    });

    await store.skills.updateById(src.id, { installCount: (src.installCount ?? 0) + 1 } as Partial<ServerSkill>).catch(() => undefined);

    const installedRisk = skillRisk(skill);
    return { skill: toClientSkill(skill), duplicate: false, risky: installedRisk.risky, findingCount: installedRisk.findingCount };
  });
}
