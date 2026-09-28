import { describe, expect, it } from "vitest";
import { parseBookmarks } from "./bookmarks.js";

const SAMPLE = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
    <DT><H3>Bookmarks bar</H3>
    <DL><p>
        <DT><A HREF="https://example.com/a" ADD_DATE="1700000000">Example &amp; A</A>
        <DT><H3>Dev Tools</H3>
        <DL><p>
            <DT><A HREF="https://github.com/o/r">o/r repo</A>
            <DT><A HREF="javascript:void(0)">a bookmarklet</A>
        </DL><p>
    </DL><p>
    <DT><A HREF="https://pocket.example/x" TAGS="ai,agents">Pocket item</A>
    <DT><A HREF="https://example.com/a">Duplicate of A</A>
</DL><p>`;

describe("parseBookmarks", () => {
  const entries = parseBookmarks(SAMPLE);

  it("extracts only http(s) links, deduped", () => {
    const urls = entries.map((e) => e.url);
    expect(urls).toEqual(["https://example.com/a", "https://github.com/o/r", "https://pocket.example/x"]);
    expect(urls).not.toContain("javascript:void(0)"); // bookmarklet skipped
  });

  it("decodes titles", () => {
    expect(entries[0]!.title).toBe("Example & A");
  });

  it("derives tags from folders (ignoring the generic bar) and TAGS attributes", () => {
    // The repo lives under "Bookmarks bar > Dev Tools" — only the meaningful folder becomes a tag.
    expect(entries[1]!.tags).toEqual(["dev tools"]);
    // Explicit TAGS attribute (Pocket/Raindrop) is preserved.
    expect(entries[2]!.tags).toEqual(["ai", "agents"]);
    // A top-level item under only the generic bar gets no tags.
    expect(entries[0]!.tags).toBeUndefined();
  });

  it("parses ADD_DATE (epoch seconds) to ISO", () => {
    expect(entries[0]!.addedAt).toBe(new Date(1700000000 * 1000).toISOString());
  });

  it("returns [] for empty / non-bookmark input", () => {
    expect(parseBookmarks("")).toEqual([]);
    expect(parseBookmarks("<html><body>no links</body></html>")).toEqual([]);
  });
});
