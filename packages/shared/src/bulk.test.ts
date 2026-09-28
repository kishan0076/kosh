import { describe, expect, it } from "vitest";
import { describeItemEffects, parseBulkCommand, previewBulkPlan, sanitizeBulkPlan, selectBulkItems, type BulkPlan } from "./bulk.js";
import type { Item } from "./types.js";

const item = (over: Partial<Item> = {}): Item => ({
  id: "i1", kind: "link", url: "https://github.com/o/r", title: "Cool Repo", tags: ["ai"], collections: [],
  stage: "to-try", source: "web", status: "ready", createdAt: "", updatedAt: "", linkType: "repo", ...over,
});

const plan = (over: Partial<BulkPlan> = {}): BulkPlan => ({
  summary: "test", select: { mode: "all", conditions: [] }, actions: [], ...over,
});

describe("selectBulkItems", () => {
  const items = [
    item({ id: "a", url: "https://github.com/o/r", linkType: "repo", tags: ["ai"] }),
    item({ id: "b", url: "https://youtube.com/x", linkType: "video", tags: [], title: "Random Video" }),
    item({ id: "c", url: "https://github.com/o/s", linkType: "repo", tags: ["dropme"] }),
  ];
  it("filters by field conditions (AND)", () => {
    const sel = selectBulkItems(items, { mode: "all", conditions: [{ field: "linkType", value: "repo" }, { field: "url", value: "github.com" }] });
    expect(sel.map((i) => i.id)).toEqual(["a", "c"]);
  });
  it("empty conditions select everything", () => {
    expect(selectBulkItems(items, { mode: "all", conditions: [] })).toHaveLength(3);
  });
  it("supports any (OR)", () => {
    const sel = selectBulkItems(items, { mode: "any", conditions: [{ field: "linkType", value: "video" }, { field: "tag", value: "dropme" }] });
    expect(sel.map((i) => i.id).sort()).toEqual(["b", "c"]);
  });
  it("query narrows via lexical retrieval before the field filter", () => {
    const sel = selectBulkItems(items, { mode: "all", conditions: [], query: "cool repo" });
    expect(sel.map((i) => i.id)).toContain("a");
    expect(sel.map((i) => i.id)).not.toContain("b");
  });
});

describe("describeItemEffects", () => {
  it("skips no-op tag adds and reports real ones", () => {
    const e = describeItemEffects(item({ tags: ["ai"] }), [{ type: "addTags", value: "ai, agents" }]);
    expect(e).toHaveLength(1);
    expect(e[0]!.label).toContain("#agents");
    expect(e[0]!.label).not.toContain("#ai");
  });
  it("removes only tags the item has", () => {
    expect(describeItemEffects(item({ tags: ["ai"] }), [{ type: "removeTags", value: "ai,nope" }])[0]!.label).toBe("− #ai");
    expect(describeItemEffects(item({ tags: [] }), [{ type: "removeTags", value: "ai" }])).toEqual([]);
  });
  it("setStage only fires when the stage actually changes", () => {
    expect(describeItemEffects(item({ stage: "to-try" }), [{ type: "setStage", value: "using" }])[0]!.label).toBe("stage to-try → using");
    expect(describeItemEffects(item({ stage: "using" }), [{ type: "setStage", value: "using" }])).toEqual([]);
    expect(describeItemEffects(item(), [{ type: "setStage", value: "bogus" }])).toEqual([]);
  });
  it("pin/unpin respect current state", () => {
    expect(describeItemEffects(item({ pinned: false }), [{ type: "pin" }])[0]!.label).toBe("pin");
    expect(describeItemEffects(item({ pinned: true }), [{ type: "pin" }])).toEqual([]);
    expect(describeItemEffects(item({ pinned: true }), [{ type: "unpin" }])[0]!.label).toBe("unpin");
  });
  it("archive only for un-archived links", () => {
    expect(describeItemEffects(item({ kind: "link", url: "https://x.com" }), [{ type: "archive" }])).toHaveLength(1);
    expect(describeItemEffects(item({ kind: "prompt", url: undefined }), [{ type: "archive" }])).toEqual([]);
    expect(describeItemEffects(item({ archive: { status: "ok", capturedAt: "" } }), [{ type: "archive" }])).toEqual([]);
  });
  it("delete is flagged destructive", () => {
    expect(describeItemEffects(item(), [{ type: "delete" }])[0]).toMatchObject({ type: "delete", destructive: true });
  });
});

describe("previewBulkPlan", () => {
  const items = [
    item({ id: "a", tags: [], pinned: false }),
    item({ id: "b", tags: ["ai"], pinned: true }),
    item({ id: "c", deletedAt: "2025-01-01" }), // trashed → excluded
  ];
  it("returns only items that actually change, and counts matched/total", () => {
    const p = previewBulkPlan(items, plan({ actions: [{ type: "pin" }] }));
    expect(p.total).toBe(2); // trashed excluded
    expect(p.matched).toBe(2);
    expect(p.changes.map((c) => c.itemId)).toEqual(["a"]); // b already pinned → no-op dropped
    expect(p.destructive).toBe(false);
  });
  it("flags destructive plans", () => {
    expect(previewBulkPlan(items, plan({ actions: [{ type: "delete" }] })).destructive).toBe(true);
  });
});

describe("parseBulkCommand", () => {
  it("parses tag + domain filter", () => {
    const p = parseBulkCommand("tag everything from github.com with #repo");
    expect(p?.actions).toEqual([{ type: "addTags", value: "repo" }]);
    expect(p?.select.conditions).toContainEqual({ field: "url", value: "github.com" });
  });
  it("parses archive + kind filter", () => {
    const p = parseBulkCommand("archive all my articles");
    expect(p?.actions).toContainEqual({ type: "archive" });
    expect(p?.select.conditions).toContainEqual({ field: "linkType", value: "article" });
  });
  it("parses move to a collection", () => {
    const p = parseBulkCommand("move all repos to the Tools collection");
    expect(p?.actions).toContainEqual({ type: "addToCollection", value: "tools" });
  });
  it("parses set stage", () => {
    const p = parseBulkCommand("mark everything tagged stale as dropped");
    expect(p?.actions).toContainEqual({ type: "setStage", value: "dropped" });
    expect(p?.select.conditions).toContainEqual({ field: "tag", value: "stale" });
  });
  it("parses an about-query", () => {
    const p = parseBulkCommand("pin everything about rust async");
    expect(p?.actions).toContainEqual({ type: "pin" });
    expect(p?.select.query).toBe("rust async");
  });
  it("returns null when no action is understood", () => {
    expect(parseBulkCommand("what is in my library")).toBeNull();
    expect(parseBulkCommand("")).toBeNull();
  });
});

describe("sanitizeBulkPlan", () => {
  it("keeps only allowed fields/actions and bounds sizes", () => {
    const p = sanitizeBulkPlan({
      summary: "x",
      select: { mode: "any", conditions: [{ field: "url", value: "github" }, { field: "evil", value: "x" }] },
      actions: [{ type: "addTags", value: "a" }, { type: "rm-rf", value: "/" }],
    });
    expect(p?.select.mode).toBe("any");
    expect(p?.select.conditions).toEqual([{ field: "url", value: "github" }]);
    expect(p?.actions).toEqual([{ type: "addTags", value: "a" }]);
  });
  it("rejects a plan with no valid actions", () => {
    expect(sanitizeBulkPlan({ actions: [{ type: "nope" }] })).toBeNull();
    expect(sanitizeBulkPlan(null)).toBeNull();
  });
});
