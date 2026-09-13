import { describe, expect, it } from "vitest";
import { parseSearchQuery, searchItems, type SearchableItem } from "./search.js";

const mk = (p: Partial<SearchableItem>): SearchableItem => ({ kind: "link", tags: [], ...p });

const vault: SearchableItem[] = [
  mk({ kind: "skill", title: "pdf-tools", tags: ["claude", "pdf"], stage: "using", updatedAt: "2026-03-01" }),
  mk({ kind: "link", title: "React Router", linkType: "repo", tags: ["frontend"], pinned: true, github: { repoKind: "library" }, updatedAt: "2026-02-01" }),
  mk({ kind: "prompt", title: "Summarize a PDF", tags: ["pdf"], prompt: { body: "Summarize {{doc}}" }, stage: "to-try", updatedAt: "2026-01-01" }),
  mk({ kind: "link", title: "Some blog post", description: "about pdf parsing", tags: [], updatedAt: "2026-04-01" }),
];

describe("parseSearchQuery", () => {
  it("splits filters from free text", () => {
    const q = parseSearchQuery("pdf kind:skill tag:claude is:pinned stage:using");
    expect(q.terms).toEqual(["pdf"]);
    expect(q.kind).toBe("skill");
    expect(q.tag).toBe("claude");
    expect(q.stage).toBe("using");
    expect(q.is).toContain("pinned");
  });
  it("lowercases and ignores empty input", () => {
    expect(parseSearchQuery("   ").terms).toEqual([]);
  });
});

describe("searchItems", () => {
  it("ranks title matches above body/description matches", () => {
    const hits = searchItems(vault, "pdf");
    // The skill literally titled pdf-tools should outrank a description-only match.
    expect(hits[0]!.item.title).toBe("pdf-tools");
    expect(hits.map((h) => h.item.title)).toContain("Some blog post");
  });

  it("AND-matches every free-text term", () => {
    expect(searchItems(vault, "pdf nonexistentword")).toHaveLength(0);
  });

  it("applies kind: and stage: filters", () => {
    const hits = searchItems(vault, "pdf kind:skill");
    expect(hits).toHaveLength(1);
    expect(hits[0]!.item.kind).toBe("skill");
    expect(searchItems(vault, "kind:prompt")).toHaveLength(1);
  });

  it("applies is:pinned and is:repo flags", () => {
    expect(searchItems(vault, "is:pinned").every((h) => h.item.pinned)).toBe(true);
    expect(searchItems(vault, "is:repo")[0]!.item.linkType).toBe("repo");
  });

  it("respects the limit and returns all on an empty query", () => {
    expect(searchItems(vault, "", { limit: 2 })).toHaveLength(2);
    expect(searchItems(vault, "")).toHaveLength(vault.length);
  });

  it("matches a tag via tag: filter case-insensitively", () => {
    expect(searchItems(vault, "tag:PDF").length).toBe(2);
  });
});
