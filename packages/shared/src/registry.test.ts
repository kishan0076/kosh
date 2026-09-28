import { describe, expect, it } from "vitest";
import { rankRegistry, skillRisk, toRegistryEntry, type RegistryEntry } from "./registry.js";
import type { ScanResult, Skill, SkillVersion } from "./types.js";

const version = (over: Partial<SkillVersion> = {}): SkillVersion => ({
  n: 1, createdAt: "", entry: "SKILL.md", files: [{ path: "SKILL.md", size: 10, mime: "text/markdown" }],
  totalSize: 10, lint: { ok: true, errors: [], warnings: [] }, scan: { risky: false, findings: [] }, ...over,
});
const skill = (over: Partial<Skill> = {}): Skill => ({
  id: "s1", itemId: "i1", name: "pdf-tools", displayName: "PDF Tools", description: "Work with PDFs",
  tools: ["claude"], origin: "authored", trust: "mine", latest: 1, versions: [version()], usageCount: 0,
  createdAt: "2026-01-01", updatedAt: "2026-01-02", ...over,
});
const risky: ScanResult = { risky: true, findings: [{ path: "run.sh", line: 1, rule: "pipe-to-shell", text: "pipes a download into a shell" }] };

describe("skillRisk", () => {
  it("reads the latest version's scan", () => {
    expect(skillRisk(skill())).toEqual({ risky: false, findingCount: 0 });
    const s = skill({ latest: 2, versions: [version({ n: 1 }), version({ n: 2, scan: risky })] });
    expect(skillRisk(s)).toEqual({ risky: true, findingCount: 1 });
  });
});

describe("toRegistryEntry", () => {
  it("projects safe public fields + author + installs", () => {
    const e = toRegistryEntry(skill({ source: { owner: "acme", repo: "skills", path: "pdf" }, installCount: 7 }), { author: { login: "acme", name: "Acme" } });
    expect(e).toMatchObject({ id: "s1", name: "pdf-tools", displayName: "PDF Tools", source: "acme/skills", installs: 7, fileCount: 1, versions: 1, risky: false });
    expect(e.author).toEqual({ login: "acme", name: "Acme" });
    // never leaks a userId / searchText — the shared Skill type has no such fields, and the entry is a fixed shape
    expect(Object.keys(e)).not.toContain("userId");
  });
  it("falls back to installCount on the skill when installs not given", () => {
    expect(toRegistryEntry(skill({ installCount: 3 })).installs).toBe(3);
    expect(toRegistryEntry(skill()).installs).toBe(0);
  });
});

describe("rankRegistry", () => {
  const entries: RegistryEntry[] = [
    { id: "a", name: "aaa", displayName: "Alpha", tools: ["claude"], trust: "mine", risky: false, findingCount: 0, installs: 2, versions: 1, fileCount: 1, updatedAt: "2026-01-01", createdAt: "" },
    { id: "b", name: "bbb", displayName: "Bravo", tools: ["codex"], trust: "unreviewed", risky: true, findingCount: 3, installs: 9, versions: 1, fileCount: 1, updatedAt: "2026-02-01", createdAt: "", description: "shell helper" },
    { id: "c", name: "ccc", displayName: "Charlie", tools: ["claude"], trust: "reviewed", risky: false, findingCount: 0, installs: 5, versions: 1, fileCount: 1, updatedAt: "2026-03-01", createdAt: "" },
  ];
  it("popular sorts by installs desc", () => {
    expect(rankRegistry(entries, {}, "popular").map((e) => e.id)).toEqual(["b", "c", "a"]);
  });
  it("recent sorts by updatedAt desc", () => {
    expect(rankRegistry(entries, {}, "recent").map((e) => e.id)).toEqual(["c", "b", "a"]);
  });
  it("name sorts alphabetically", () => {
    expect(rankRegistry(entries, {}, "name").map((e) => e.id)).toEqual(["a", "b", "c"]);
  });
  it("filters by tool", () => {
    expect(rankRegistry(entries, { tool: "claude" }).map((e) => e.id).sort()).toEqual(["a", "c"]);
  });
  it("filters by risk", () => {
    expect(rankRegistry(entries, { risk: "risky" }).map((e) => e.id)).toEqual(["b"]);
    expect(rankRegistry(entries, { risk: "safe" }).map((e) => e.id).sort()).toEqual(["a", "c"]);
  });
  it("searches name/description", () => {
    expect(rankRegistry(entries, { q: "shell" }).map((e) => e.id)).toEqual(["b"]);
    expect(rankRegistry(entries, { q: "charlie" }).map((e) => e.id)).toEqual(["c"]);
  });
});
