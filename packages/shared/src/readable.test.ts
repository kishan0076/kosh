import { describe, it, expect } from "vitest";
import { extractReadable, decodeEntities } from "./readable.js";

describe("decodeEntities", () => {
  it("decodes named, decimal and hex entities", () => {
    expect(decodeEntities("a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#39;")).toBe(`a & b <c> "d" 'e'`);
    expect(decodeEntities("caf&#233; &#x2014; ok")).toBe("café — ok");
    expect(decodeEntities("&nbsp;x")).toBe(" x");
  });
  it("leaves unknown entities untouched", () => {
    expect(decodeEntities("&notareal; &amp;")).toBe("&notareal; &");
  });
});

describe("extractReadable", () => {
  const page = (body: string, head = "") => `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;

  it("pulls metadata from OG / title / meta tags", () => {
    const html = page(
      "<article><p>Hello world content that is long enough to keep.</p></article>",
      `<title>Fallback</title>
       <meta property="og:title" content="Real Title" />
       <meta name="description" content="A short summary." />
       <meta property="og:site_name" content="Example Blog" />
       <meta name="author" content="Jane Doe" />`,
    );
    const r = extractReadable(html, "https://www.example.com/post");
    expect(r.title).toBe("Real Title");
    expect(r.excerpt).toBe("A short summary.");
    expect(r.siteName).toBe("Example Blog");
    expect(r.byline).toBe("Jane Doe");
  });

  it("falls back to <title> and the hostname for site name", () => {
    const r = extractReadable(page("<p>Body text here for the article body.</p>", "<title>Just a Title</title>"), "https://news.example.org/x");
    expect(r.title).toBe("Just a Title");
    expect(r.siteName).toBe("news.example.org");
  });

  it("drops scripts, styles and chrome (nav/header/footer/aside)", () => {
    const html = page(`
      <nav>Home About Contact</nav>
      <header>Site Header</header>
      <article>
        <p>The actual article paragraph worth archiving.</p>
        <script>window.evil = 1; alert('x')</script>
        <style>.x{color:red}</style>
      </article>
      <aside>Related junk links</aside>
      <footer>Copyright junk</footer>`);
    const r = extractReadable(html, "https://example.com");
    expect(r.markdown).toContain("The actual article paragraph worth archiving.");
    expect(r.markdown).not.toContain("evil");
    expect(r.markdown).not.toContain("color:red");
    expect(r.markdown).not.toContain("Site Header");
    expect(r.markdown).not.toContain("Related junk");
    expect(r.text).not.toContain("Home About Contact");
  });

  it("prefers the largest <article> as the content root", () => {
    const html = page(`
      <article><p>tiny</p></article>
      <article><p>This is the main and substantially longer article body that should win selection.</p></article>`);
    const r = extractReadable(html, "https://example.com");
    expect(r.markdown).toContain("substantially longer article body");
    expect(r.markdown).not.toContain("tiny");
  });

  it("converts headings, paragraphs and inline emphasis to Markdown", () => {
    const html = page(`<article>
      <h2>Section Title</h2>
      <p>Some <strong>bold</strong> and <em>italic</em> and <code>inline()</code> text.</p>
    </article>`);
    const r = extractReadable(html, "https://example.com");
    expect(r.markdown).toContain("## Section Title");
    expect(r.markdown).toContain("**bold**");
    expect(r.markdown).toContain("*italic*");
    expect(r.markdown).toContain("`inline()`");
  });

  it("converts lists (ordered counter) and resolves relative links + images", () => {
    const html = page(`<article>
      <ul><li>first item</li><li>second item</li></ul>
      <ol><li>step one</li><li>step two</li></ol>
      <p>See <a href="/docs/guide">the guide</a> and <img src="/img/a.png" alt="Diagram"></p>
    </article>`);
    const r = extractReadable(html, "https://example.com/blog/");
    expect(r.markdown).toContain("- first item");
    expect(r.markdown).toContain("- second item");
    expect(r.markdown).toContain("1. step one");
    expect(r.markdown).toContain("2. step two");
    expect(r.markdown).toContain("[the guide](https://example.com/docs/guide)");
    expect(r.markdown).toContain("![Diagram](https://example.com/img/a.png)");
  });

  it("preserves <pre><code> as a fenced block and drops unsafe link schemes", () => {
    const html = page(`<article>
      <pre><code>const x = 1;
const y = 2;</code></pre>
      <p><a href="javascript:alert(1)">bad</a> <a href="https://ok.com">good</a></p>
    </article>`);
    const r = extractReadable(html, "https://example.com");
    expect(r.markdown).toContain("```");
    expect(r.markdown).toContain("const x = 1;");
    expect(r.markdown).not.toContain("javascript:");
    expect(r.markdown).toContain("[good](https://ok.com)");
  });

  it("computes a word count and plain text", () => {
    const r = extractReadable(page("<article><p>one two three four five</p></article>"), "https://example.com");
    expect(r.wordCount).toBe(5);
    expect(r.text).toBe("one two three four five");
  });

  it("returns near-empty output for a page with no readable content", () => {
    const r = extractReadable(page("<div><script>app()</script></div>"), "https://spa.example.com");
    expect(r.wordCount).toBeLessThan(5);
  });
});
