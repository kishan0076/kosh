import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { safeFetch } from "./integrations/safe-fetch.js";
import { parsePackageUrl } from "./integrations/registries.js";
import { createMemoryStore } from "./db/memory.js";
import { encryptSecret, decryptSecret, hashPassword, verifyPassword } from "./auth/crypto.js";
import { listVersions, makeSnapshot, pickComposition, upsertSnapshot } from "./modules/packs.js";
import type { ContextPack, ContextPackSnapshot } from "@kosh/shared";

describe("safeFetch SSRF guard", () => {
  it("blocks localhost", async () => {
    await expect(safeFetch("http://localhost/")).rejects.toThrow(/not reachable/i);
  });
  it("blocks cloud metadata (link-local)", async () => {
    await expect(safeFetch("http://169.254.169.254/latest/meta-data/")).rejects.toThrow(/not reachable/i);
  });
  it("blocks non-http protocols", async () => {
    await expect(safeFetch("file:///etc/passwd")).rejects.toThrow(/http/i);
  });
});

describe("secret encryption", () => {
  it("round-trips and is not plaintext", () => {
    const token = "gho_secretToken1234567890";
    const enc = encryptSecret(token);
    expect(enc).not.toContain(token);
    expect(enc.startsWith("enc:v1:")).toBe(true);
    expect(decryptSecret(enc)).toBe(token);
  });
  it("tolerates legacy plaintext and undefined", () => {
    expect(decryptSecret("plain")).toBe("plain");
    expect(decryptSecret(undefined)).toBeUndefined();
  });
});

describe("admin password verification", () => {
  it("verifies a scrypt hash and rejects a wrong password", () => {
    const hash = hashPassword("s3cret-pass");
    expect(hash.startsWith("scrypt:")).toBe(true);
    expect(verifyPassword("s3cret-pass", hash)).toBe(true);
    expect(verifyPassword("wrong", hash)).toBe(false);
    expect(verifyPassword("s3cret-pas", hash)).toBe(false); // one char short
  });
  it("supports a plaintext stored password (constant-time compare)", () => {
    expect(verifyPassword("hunter2", "hunter2")).toBe(true);
    expect(verifyPassword("hunter3", "hunter2")).toBe(false);
    expect(verifyPassword("hunter2 ", "hunter2")).toBe(false); // length-sensitive
  });
  it("distinct passwords produce distinct hashes (random salt)", () => {
    expect(hashPassword("same")).not.toBe(hashPassword("same"));
  });
});

describe("parsePackageUrl", () => {
  it("parses npm / pypi / crates", () => {
    expect(parsePackageUrl("https://www.npmjs.com/package/zod")).toEqual({ registry: "npm", name: "zod" });
    expect(parsePackageUrl("https://npmjs.com/package/@scope/pkg")).toEqual({ registry: "npm", name: "@scope/pkg" });
    expect(parsePackageUrl("https://pypi.org/project/requests/")).toEqual({ registry: "pypi", name: "requests" });
    expect(parsePackageUrl("https://crates.io/crates/serde")).toEqual({ registry: "crates", name: "serde" });
  });
  it("returns null for non-package urls", () => {
    expect(parsePackageUrl("https://github.com/o/r")).toBeNull();
  });
});

describe("memory store", () => {
  it("does CRUD with filters and sorting", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kosh-"));
    const store = createMemoryStore(dir);
    const a = await store.items.create({ userId: "u1", kind: "link", title: "A", createdAt: "2026-01-01" } as never);
    await store.items.create({ userId: "u1", kind: "skill", title: "B", createdAt: "2026-02-01" } as never);
    await store.items.create({ userId: "u2", kind: "link", title: "C", createdAt: "2026-03-01" } as never);

    expect(await store.items.count({ userId: "u1" })).toBe(2);
    const links = await store.items.find({ userId: "u1", kind: "link" });
    expect(links.map((i) => (i as { title: string }).title)).toEqual(["A"]);

    const sorted = await store.items.find({}, { sort: { createdAt: -1 } });
    expect(sorted.map((i) => (i as { title: string }).title)).toEqual(["C", "B", "A"]);

    const updated = await store.items.updateById(a.id, { title: "A2" } as never);
    expect((updated as unknown as { title: string }).title).toBe("A2");

    expect(await store.items.deleteById(a.id)).toBe(true);
    expect(await store.items.findById(a.id)).toBeNull();
    await store.close();
  });

  it("supports $in and null matchers", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kosh-"));
    const store = createMemoryStore(dir);
    await store.items.create({ userId: "u1", kind: "link", deletedAt: undefined } as never);
    await store.items.create({ userId: "u1", kind: "prompt", deletedAt: "2026-01-01" } as never);
    expect((await store.items.find({ userId: "u1", deletedAt: null })).length).toBe(1);
    expect((await store.items.find({ kind: { $in: ["link", "prompt"] } })).length).toBe(2);
    await store.close();
  });

  it("wires the contextPacks collection (create, per-user sort, persistence)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kosh-"));
    const store = createMemoryStore(dir);
    await store.contextPacks.create({ userId: "u1", name: "Old", itemIds: ["i1"], version: 1, createdAt: "2026-01-01", updatedAt: "2026-01-01" } as never);
    const newer = await store.contextPacks.create({ userId: "u1", name: "New", itemIds: [], version: 1, createdAt: "2026-02-01", updatedAt: "2026-02-01" } as never);
    await store.contextPacks.create({ userId: "u2", name: "Other", itemIds: [], version: 1, createdAt: "2026-03-01", updatedAt: "2026-03-01" } as never);

    // Scoped to the user, newest-first (the route's list contract).
    const mine = await store.contextPacks.find({ userId: "u1" }, { sort: { updatedAt: -1 } });
    expect(mine.map((p) => (p as { name: string }).name)).toEqual(["New", "Old"]);

    await store.contextPacks.updateById(newer.id, { itemIds: ["a", "b"], version: 2 } as never);
    await store.close();

    // Survives a reload from disk (COLLECTIONS wiring persists it).
    const reopened = createMemoryStore(dir);
    const again = await reopened.contextPacks.findById(newer.id);
    expect((again as unknown as { version: number }).version).toBe(2);
    expect((again as unknown as { itemIds: string[] }).itemIds).toEqual(["a", "b"]);
    await reopened.close();
  });
});

describe("context pack version pinning", () => {
  const comp = (version: number, itemIds: string[]) => ({ name: `P${version}`, itemIds, version });
  const pack = (over: Partial<ContextPack>): ContextPack => ({
    id: "p1", name: "Pack", itemIds: [], version: 1, createdAt: "2026-01-01", updatedAt: "2026-01-01", ...over,
  });

  it("upsertSnapshot adds versions, upserts in place preserving the cut time, and sorts", () => {
    let snaps: ContextPackSnapshot[] | undefined;
    snaps = upsertSnapshot(snaps, makeSnapshot(comp(1, ["a"]), "2026-01-01"));
    snaps = upsertSnapshot(snaps, makeSnapshot(comp(2, ["a", "b"]), "2026-01-02"));
    expect(snaps.map((s) => s.version)).toEqual([1, 2]);
    // Re-saving v2 (e.g. a later touch) keeps its ORIGINAL createdAt but adopts new content.
    snaps = upsertSnapshot(snaps, makeSnapshot(comp(2, ["a", "b", "c"]), "2026-06-06"));
    expect(snaps).toHaveLength(2);
    const v2 = snaps.find((s) => s.version === 2)!;
    expect(v2.createdAt).toBe("2026-01-02");
    expect(v2.itemIds).toEqual(["a", "b", "c"]);
  });

  it("upsertSnapshot retains only the most recent 30 versions", () => {
    let snaps: ContextPackSnapshot[] | undefined;
    for (let v = 1; v <= 35; v++) snaps = upsertSnapshot(snaps, makeSnapshot(comp(v, []), `2026-01-${v}`));
    expect(snaps).toHaveLength(30);
    expect(snaps![0]!.version).toBe(6); // 1–5 dropped
    expect(snaps!.at(-1)!.version).toBe(35);
  });

  it("pickComposition returns the live pack for the current version and null for a dropped one", () => {
    const p = pack({
      version: 3,
      name: "Live",
      itemIds: ["x", "y"],
      snapshots: [makeSnapshot(comp(1, ["old"]), "2026-01-01"), { version: 2, name: "V2", itemIds: ["a"], createdAt: "2026-01-02" }],
    });
    // Latest (no version) and the current version both resolve from the live pack.
    expect(pickComposition(p)!.itemIds).toEqual(["x", "y"]);
    expect(pickComposition(p, 3)!.name).toBe("Live");
    // A retained past version resolves from its frozen snapshot.
    expect(pickComposition(p, 2)!.itemIds).toEqual(["a"]);
    // A version that was never cut / no longer retained → null (caller 404s).
    expect(pickComposition(p, 99)).toBeNull();
  });

  it("listVersions is newest-first, flags the current version, and falls back when unsnapshotted", () => {
    const p = pack({
      version: 2,
      itemIds: ["x"],
      snapshots: [makeSnapshot(comp(1, ["a", "b"]), "2026-01-01"), { version: 2, name: "P2", itemIds: ["x"], createdAt: "2026-01-02" }],
    });
    const vs = listVersions(p);
    expect(vs.map((v) => v.version)).toEqual([2, 1]);
    expect(vs[0]).toMatchObject({ version: 2, itemCount: 1, current: true });
    expect(vs[1]).toMatchObject({ version: 1, itemCount: 2, current: false });
    // Legacy pack with no snapshots → a single synthesized current-version row.
    const legacy = listVersions(pack({ version: 5, itemIds: ["a", "b", "c"], snapshots: undefined }));
    expect(legacy).toEqual([{ version: 5, itemCount: 3, createdAt: "2026-01-01", current: true }]);
  });
});
