import { describe, expect, it } from "vitest";
import { findSecrets, securityPosture, type PostureInput } from "./security.js";
import type { Collection, ContextPack, Item, Skill } from "./types.js";

const NOW = Date.parse("2026-01-01T00:00:00Z");

const item = (over: Partial<Item> = {}): Item => ({
  id: "i1", kind: "link", url: "https://example.com", title: "Item", tags: [], collections: [],
  stage: "to-try", source: "web", status: "ready", createdAt: "", updatedAt: "", ...over,
});

const skill = (over: Partial<Skill> = {}): Skill => ({
  id: "s1", itemId: "si1", name: "skill", displayName: "Skill", tools: ["claude"], origin: "upload",
  trust: "mine", latest: 1, usageCount: 0, createdAt: "", updatedAt: "",
  versions: [{ n: 1, createdAt: "", entry: "SKILL.md", files: [], totalSize: 0, lint: { ok: true, errors: [], warnings: [] }, scan: { risky: false, findings: [] } }],
  ...over,
});

const base = (over: Partial<PostureInput> = {}): PostureInput => ({
  items: [], skills: [], collections: [], packs: [], apiKeys: [], now: NOW, ...over,
});

describe("findSecrets", () => {
  it("detects well-known credential shapes", () => {
    expect(findSecrets("AKIAIOSFODNN7EXAMPLE").map((h) => h.id)).toContain("aws-access-key");
    expect(findSecrets("token: ghp_" + "a".repeat(36)).map((h) => h.id)).toContain("github-token");
    expect(findSecrets("-----BEGIN OPENSSH PRIVATE KEY-----").map((h) => h.id)).toContain("private-key");
    expect(findSecrets('api_key = "abcdef0123456789ABCDEF"').map((h) => h.id)).toContain("generic-secret");
  });

  it("does not flag ordinary prose", () => {
    expect(findSecrets("This is a normal note about my API key management strategy.")).toEqual([]);
    expect(findSecrets("password protection is important")).toEqual([]); // no assignment → no hit
    expect(findSecrets("")).toEqual([]);
  });
});

describe("securityPosture", () => {
  it("a clean vault scores A with no findings", () => {
    const p = securityPosture(base({ items: [item()], skills: [skill()] }));
    expect(p.findings).toEqual([]);
    expect(p.score).toBe(100);
    expect(p.grade).toBe("A");
    expect(p.counts).toEqual({ critical: 0, warning: 0, info: 0 });
  });

  it("flags an unreviewed skill as a warning", () => {
    const p = securityPosture(base({ skills: [skill({ trust: "unreviewed" })] }));
    const f = p.findings.find((x) => x.id === "skill-unreviewed-s1");
    expect(f?.severity).toBe("warning");
    expect(p.categories.find((c) => c.id === "skills")!.score).toBeLessThan(100);
  });

  it("an unreviewed AND risky skill is critical", () => {
    const risky = skill({
      trust: "unreviewed",
      versions: [{ n: 1, createdAt: "", entry: "SKILL.md", files: [], totalSize: 0, lint: { ok: true, errors: [], warnings: [] }, scan: { risky: true, findings: [{ path: "run.sh", line: 1, rule: "pipe-to-shell", text: "pipes a download into a shell" }] } }],
    });
    const p = securityPosture(base({ skills: [risky] }));
    expect(p.findings.find((x) => x.id === "skill-risky-s1")?.severity).toBe("critical");
    expect(p.counts.critical).toBe(1);
  });

  it("index-only skills are not an execution surface", () => {
    const p = securityPosture(base({ skills: [skill({ trust: "unreviewed", indexOnly: true })] }));
    expect(p.findings).toEqual([]);
  });

  it("detects a secret pasted into an item note (critical)", () => {
    const p = securityPosture(base({ items: [item({ note: "AKIAIOSFODNN7EXAMPLE" })] }));
    const f = p.findings.find((x) => x.category === "secrets");
    expect(f?.severity).toBe("critical");
    expect(p.categories.find((c) => c.id === "secrets")!.score).toBeLessThan(100);
  });

  it("scans skill file previews for secrets", () => {
    const s = skill({ versions: [{ n: 1, createdAt: "", entry: "SKILL.md", files: [{ path: "config.py", size: 10, mime: "text/x-python", content: "GOOGLE=AIza" + "b".repeat(35) }], totalSize: 10, lint: { ok: true, errors: [], warnings: [] }, scan: { risky: false, findings: [] } }] });
    const p = securityPosture(base({ skills: [s] }));
    expect(p.findings.some((x) => x.id.startsWith("secret-skill-"))).toBe(true);
  });

  it("flags public collections / packs / skills as info", () => {
    const collections: Collection[] = [{ id: "c1", name: "Public", slug: "public", order: 0, public: true, publicSlug: "abc" }];
    const packs: ContextPack[] = [{ id: "p1", name: "Pack", itemIds: ["i1", "i2"], version: 1, public: true, publicSlug: "def", createdAt: "", updatedAt: "" }];
    const p = securityPosture(base({ collections, packs, skills: [skill({ public: true })] }));
    const share = p.findings.filter((f) => f.category === "sharing");
    expect(share).toHaveLength(3);
    expect(share.every((f) => f.severity === "info")).toBe(true);
  });

  it("flags a stale write-scoped API key as a warning", () => {
    const old = new Date(NOW - 200 * 86_400_000).toISOString();
    const p = securityPosture(base({ apiKeys: [{ id: "k1", name: "CLI", scopes: ["read", "write"], lastUsedAt: old, createdAt: old }] }));
    const f = p.findings.find((x) => x.category === "keys");
    expect(f?.severity).toBe("warning");
  });

  it("ignores revoked keys and recently-used keys", () => {
    const recent = new Date(NOW - 5 * 86_400_000).toISOString();
    const old = new Date(NOW - 200 * 86_400_000).toISOString();
    const p = securityPosture(base({ apiKeys: [
      { id: "k1", name: "fresh", scopes: ["read"], lastUsedAt: recent, createdAt: recent },
      { id: "k2", name: "revoked", scopes: ["write"], lastUsedAt: old, createdAt: old, revokedAt: old },
    ] }));
    expect(p.findings.filter((f) => f.category === "keys")).toEqual([]);
  });

  it("deleted items are excluded from scanning", () => {
    const p = securityPosture(base({ items: [item({ note: "AKIAIOSFODNN7EXAMPLE", deletedAt: "2025-01-01" })] }));
    expect(p.findings.filter((f) => f.category === "secrets")).toEqual([]);
  });

  it("ranks findings critical → warning → info and computes a lower grade", () => {
    const collections: Collection[] = [{ id: "c1", name: "Public", slug: "public", order: 0, public: true }];
    const p = securityPosture(base({
      items: [item({ note: "-----BEGIN RSA PRIVATE KEY-----" })],
      skills: [skill({ trust: "unreviewed" })],
      collections,
    }));
    expect(p.findings[0]!.severity).toBe("critical");
    expect(p.findings.at(-1)!.severity).toBe("info");
    expect(p.grade).not.toBe("A");
  });
});
