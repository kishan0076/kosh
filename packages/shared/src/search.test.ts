import { describe, expect, it } from "vitest";
import { parseSearchQuery, retrieveItems, searchItems, type SearchableItem } from "./search.js";

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

  it("scores archived excerpt text", () => {
    const withArchive = [mk({ title: "Untitled", archive: { excerpt: "a deep dive into webhook signing" } })];
    expect(searchItems(withArchive, "webhook")).toHaveLength(1);
  });
});

describe("retrieveItems (recall-first, for Ask)", () => {
  it("ignores stopwords in a natural-language question and matches on content words", () => {
    // searchItems (strict AND) finds nothing because most words are stopwords with no match…
    expect(searchItems(vault, "what did I save about pdf")).toHaveLength(0);
    // …but retrieveItems strips stopwords and OR-matches the meaningful term "pdf".
    const hits = retrieveItems(vault, "what did I save about pdf");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.map((h) => h.item.title)).toContain("pdf-tools");
  });

  it("OR-matches: an item matching any content term is retrieved", () => {
    const hits = retrieveItems(vault, "react or blog");
    const titles = hits.map((h) => h.item.title);
    expect(titles).toContain("React Router");
    expect(titles).toContain("Some blog post");
  });

  it("falls back to all items (pinned, then recency) when the question has no content terms", () => {
    const hits = retrieveItems(vault, "what did I do?");
    expect(hits).toHaveLength(vault.length);
    expect(hits.every((h) => h.score <= 1)).toBe(true); // 0, plus the +1 pinned tie-break
    expect(hits[0]!.item.pinned).toBe(true); // pinned wins the tie-break over pure recency
    // among the non-pinned (score 0) items, the newest sorts first
    expect(hits.filter((h) => !h.item.pinned)[0]!.item.updatedAt).toBe("2026-04-01");
  });

  it("honors filters and the limit", () => {
    expect(retrieveItems(vault, "pdf kind:prompt")).toHaveLength(1);
    expect(retrieveItems(vault, "pdf", { limit: 1 })).toHaveLength(1);
  });

  it("retrieves by meaningful 2-char terms like 'ai' (not filtered as too-short)", () => {
    const v = [mk({ title: "Agent framework", tags: ["ai"], updatedAt: "2026-01-02" }), mk({ title: "A recipe blog", tags: ["food"], updatedAt: "2026-01-03" })];
    const hits = retrieveItems(v, "what about ai");
    // "ai" is a real content term → the ai-tagged item scores > 0 and is retrieved by relevance, not recency.
    expect(hits[0]!.item.title).toBe("Agent framework");
    expect(hits[0]!.score).toBeGreaterThan(0);
  });
});
