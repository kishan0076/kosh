/**
 * Skill registry — a discovery layer over the existing scan + trust model (roadmap moonshot).
 *
 * Any skill a user marks `public` becomes discoverable in a cross-user marketplace. Installing one copies it
 * into your vault and — per the golden rule — it lands as `trust: "unreviewed"`; its scan is re-run, so a
 * risky skill stays unreviewed and the UI gates install behind a confirm that shows the findings. This module
 * is the pure, tested core: derive a skill's risk from its latest scan, project it to a safe public entry
 * (no private fields), and rank/filter a catalog.
 */
import type { ScanResult, Skill, Tool, Trust } from "./types.js";

export interface RegistryAuthor {
  login?: string;
  name?: string;
}

/** A safe, public projection of a shared skill for the marketplace list (never exposes private fields). */
export interface RegistryEntry {
  /** The globally-unique, opaque handle used to fetch detail / install (the source skill id). */
  id: string;
  name: string;
  displayName: string;
  description?: string;
  tools: Tool[];
  /** The author's own trust label (informational — an install always lands unreviewed for the installer). */
  trust: Trust;
  risky: boolean;
  findingCount: number;
  license?: string;
  /** "owner/repo" attribution when the skill originated from a GitHub repo. */
  source?: string;
  author?: RegistryAuthor;
  installs: number;
  versions: number;
  fileCount: number;
  updatedAt: string;
  createdAt: string;
}

export type RegistrySort = "popular" | "recent" | "name";
export interface RegistryFilters {
  q?: string;
  tool?: Tool;
  risk?: "safe" | "risky";
}

/** Risk of a skill's LATEST version, straight from the static scan (`scanSkill`). */
export function skillRisk(skill: Pick<Skill, "latest" | "versions">): { risky: boolean; findingCount: number } {
  const v = skill.versions.find((x) => x.n === skill.latest) ?? skill.versions.at(-1);
  const scan: ScanResult | undefined = v?.scan;
  return { risky: !!scan?.risky, findingCount: scan?.findings.length ?? 0 };
}

/** Project a skill (+ resolved author + install count) to a public registry entry. Pure. */
export function toRegistryEntry(skill: Skill, opts: { author?: RegistryAuthor; installs?: number } = {}): RegistryEntry {
  const { risky, findingCount } = skillRisk(skill);
  const v = skill.versions.find((x) => x.n === skill.latest) ?? skill.versions.at(-1);
  const source = skill.source?.owner && skill.source?.repo ? `${skill.source.owner}/${skill.source.repo}` : undefined;
  return {
    id: skill.id,
    name: skill.name,
    displayName: skill.displayName || skill.name,
    description: skill.description,
    tools: skill.tools,
    trust: skill.trust,
    risky,
    findingCount,
    license: skill.license,
    source,
    author: opts.author,
    installs: opts.installs ?? skill.installCount ?? 0,
    versions: skill.versions.length,
    fileCount: v?.files.length ?? 0,
    updatedAt: skill.updatedAt,
    createdAt: skill.createdAt,
  };
}

/** Filter + sort a catalog of entries for the discovery UI. Pure. */
export function rankRegistry(entries: RegistryEntry[], filters: RegistryFilters = {}, sort: RegistrySort = "popular"): RegistryEntry[] {
  const q = filters.q?.trim().toLowerCase();
  let out = entries.filter((e) => {
    if (filters.tool && !e.tools.includes(filters.tool)) return false;
    if (filters.risk === "safe" && e.risky) return false;
    if (filters.risk === "risky" && !e.risky) return false;
    if (q && !(e.name.toLowerCase().includes(q) || e.displayName.toLowerCase().includes(q) || e.description?.toLowerCase().includes(q) || e.source?.toLowerCase().includes(q) || e.author?.login?.toLowerCase().includes(q))) return false;
    return true;
  });
  out = out.sort((a, b) => {
    if (sort === "name") return a.displayName.localeCompare(b.displayName);
    if (sort === "recent") return (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "");
    return b.installs - a.installs || (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""); // popular
  });
  return out;
}
