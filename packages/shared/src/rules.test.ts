import { describe, expect, it } from "vitest";
import { itemMatchesRule, parseRuleTags, type AutomationRule } from "./rules.js";
import type { Item } from "./types.js";

const item = (over: Partial<Item> = {}): Item => ({
  id: "i1", kind: "link", url: "https://github.com/o/r", title: "Cool Repo", tags: ["ai"], collections: [],
  stage: "to-try", source: "web", status: "ready", createdAt: "", updatedAt: "", linkType: "repo",
  github: { owner: "o", repo: "r", repoKind: "mcp-server" }, ...over,
});
const rule = (over: Partial<AutomationRule> = {}): AutomationRule => ({
  id: "r1", name: "R", enabled: true, match: "all", conditions: [], actions: [], createdAt: "", updatedAt: "", ...over,
});

describe("itemMatchesRule", () => {
  it("matches by kind / linkType / repoKind / tag / url substring", () => {
    expect(itemMatchesRule(item(), rule({ conditions: [{ field: "kind", value: "link" }] }))).toBe(true);
    expect(itemMatchesRule(item(), rule({ conditions: [{ field: "linkType", value: "repo" }] }))).toBe(true);
    expect(itemMatchesRule(item(), rule({ conditions: [{ field: "repoKind", value: "mcp-server" }] }))).toBe(true);
    expect(itemMatchesRule(item(), rule({ conditions: [{ field: "tag", value: "ai" }] }))).toBe(true);
    expect(itemMatchesRule(item(), rule({ conditions: [{ field: "url", value: "github.com" }] }))).toBe(true);
    expect(itemMatchesRule(item(), rule({ conditions: [{ field: "title", value: "cool" }] }))).toBe(true); // case-insensitive
  });

  it("respects all vs any", () => {
    const conds = [{ field: "kind", value: "link" } as const, { field: "tag", value: "nope" } as const];
    expect(itemMatchesRule(item(), rule({ match: "all", conditions: conds }))).toBe(false);
    expect(itemMatchesRule(item(), rule({ match: "any", conditions: conds }))).toBe(true);
  });

  it("empty conditions match everything", () => {
    expect(itemMatchesRule(item(), rule({ conditions: [] }))).toBe(true);
  });

  it("non-matches return false", () => {
    expect(itemMatchesRule(item(), rule({ conditions: [{ field: "kind", value: "prompt" }] }))).toBe(false);
    expect(itemMatchesRule(item({ tags: [] }), rule({ conditions: [{ field: "tag", value: "ai" }] }))).toBe(false);
  });
});

describe("parseRuleTags", () => {
  it("splits, trims, strips #, dedupes", () => {
    expect(parseRuleTags(" #ai, agents ,ai, ")).toEqual(["ai", "agents"]);
    expect(parseRuleTags(undefined)).toEqual([]);
  });
});
