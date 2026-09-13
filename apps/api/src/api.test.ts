import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { safeFetch } from "./integrations/safe-fetch.js";
import { parsePackageUrl } from "./integrations/registries.js";
import { createMemoryStore } from "./db/memory.js";

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
});
