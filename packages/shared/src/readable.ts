/**
 * Dependency-free "readability" extraction: turn a fetched HTML page into a clean, readable Markdown
 * snapshot (plus plain text for search + word count). Lives in @kosh/shared, pure and unit-tested, so
 * both the server (archive job) and any client can reuse it.
 *
 * The output is Markdown on purpose: the app renders it through the sanitizing <Markdown> component
 * (react-markdown + rehype-sanitize), so an archived page is never injected as raw HTML — honoring the
 * "never render unsanitized markup" golden rule. This is intentionally a pragmatic extractor (not a full
 * DOM/Readability port): it drops chrome, keeps the main content, and formats the common article tags.
 */

export interface ReadableResult {
  title?: string;
  byline?: string;
  excerpt?: string;
  siteName?: string;
  /** Plain text of the extracted content — for word count, search, and AI. */
  text: string;
  /** The readable article rendered as Markdown, safe to display through <Markdown>. */
  markdown: string;
  wordCount: number;
}

/* ── entities ── */
const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", mdash: "—", ndash: "–",
  hellip: "…", copy: "©", reg: "®", trade: "™", rsquo: "'", lsquo: "'", ldquo: "“", rdquo: "”",
  raquo: "»", laquo: "«", middot: "·", bull: "•", deg: "°", eacute: "é", egrave: "è",
};

/** Decode the entities that show up in real articles (named + numeric, decimal & hex). */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (m, ent: string) => {
    if (ent[0] === "#") {
      const code = ent[1] === "x" || ent[1] === "X" ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      if (Number.isFinite(code) && code > 0 && code <= 0x10ffff) {
        try {
          return String.fromCodePoint(code);
        } catch {
          return m;
        }
      }
      return m;
    }
    return Object.prototype.hasOwnProperty.call(NAMED, ent) ? NAMED[ent]! : m;
  });
}

/* ── metadata ── */
function metaContent(html: string, patterns: RegExp[]): string | undefined {
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) {
      const v = decodeEntities(m[1].trim());
      if (v) return v;
    }
  }
  return undefined;
}

function hostName(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

/** Resolve a possibly-relative href/src against the page URL; drop unsafe schemes. */
function resolveUrl(href: string, base?: string): string {
  const h = href.trim();
  if (!h) return "";
  if (/^(javascript|data|vbscript):/i.test(h)) return "";
  if (/^(https?:|mailto:|tel:|#)/i.test(h)) return h;
  if (!base) return h;
  try {
    return new URL(h, base).toString();
  } catch {
    return h;
  }
}

/* ── noise removal ── */
const DROP_TAGS = [
  "script", "style", "noscript", "template", "svg", "iframe", "head", "nav", "header", "footer",
  "aside", "form", "button", "select", "textarea", "input", "label", "dialog", "canvas", "object",
  "embed", "audio", "video", "map", "figure",
];

/** Strip comments and whole "chrome"/non-content elements (with their contents). */
function stripNoise(html: string): string {
  let out = html.replace(/<!--[\s\S]*?-->/g, "");
  for (const tag of DROP_TAGS) {
    // Remove paired <tag ...>...</tag> (non-greedy, case-insensitive, dot-matches-newline via [\s\S]).
    out = out.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, "gi"), " ");
    // Remove any dangling self-closing / unmatched openers of the same tag.
    out = out.replace(new RegExp(`<\\/?${tag}\\b[^>]*>`, "gi"), " ");
  }
  return out;
}

/** Pick the densest main-content region: the largest <article>, else <main>, else <body>, else all. */
function pickContentRoot(html: string): string {
  const collect = (tag: string): string[] => {
    const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi");
    const found: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(html))) found.push(m[1]!);
    return found;
  };
  const articles = collect("article");
  if (articles.length) return articles.sort((a, b) => textLength(b) - textLength(a))[0]!;
  const mains = collect("main");
  if (mains.length) return mains.sort((a, b) => textLength(b) - textLength(a))[0]!;
  const body = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  if (body?.[1]) return body[1];
  return html;
}

/** Rough visible-text length of an HTML fragment (tags stripped) — for ranking content regions. */
function textLength(fragment: string): number {
  return fragment.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().length;
}

/** Plain visible text of a fragment (decoded, whitespace-collapsed). */
function plainText(fragment: string): string {
  return decodeEntities(fragment.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

const countWords = (text: string): number => (text ? text.split(/\s+/).filter(Boolean).length : 0);

const attr = (tagBody: string, name: string): string | undefined => {
  const m = tagBody.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return m ? (m[2] ?? m[3] ?? m[4]) : undefined;
};

const MAX_MARKDOWN = 400_000; // cap the stored snapshot

interface ListCtx {
  ordered: boolean;
  index: number;
}

/**
 * Convert an HTML content fragment to Markdown via a small tokenizer (more robust than pure regex
 * replace for nested tags): inline formatting is emitted into a buffer, block boundaries flush it.
 */
function htmlToMarkdown(fragment: string, base?: string): string {
  const out: string[] = [];
  let outLen = 0; // running length of `out` joined — kept O(1) so the size cap check isn't quadratic
  const emit = (s: string) => { out.push(s); outLen += s.length + 1; };
  let inline = "";
  let mode: "para" | "heading" | "li" = "para";
  let headingLevel = 0;
  const lists: ListCtx[] = [];
  let quoteDepth = 0;
  let inPre = false;
  let preBuf = "";
  let linkOpen = false;
  let linkHref = "";

  const flush = () => {
    const content = inline.replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").trim();
    inline = "";
    if (mode === "heading") {
      if (content) emit("#".repeat(headingLevel) + " " + content.replace(/\n+/g, " "));
      mode = "para";
      headingLevel = 0;
      return;
    }
    if (mode === "li") {
      const top = lists[lists.length - 1];
      const depth = Math.max(0, lists.length - 1);
      const marker = top?.ordered ? `${top.index}.` : "-";
      if (content) emit("  ".repeat(depth) + marker + " " + content.replace(/\n+/g, " "));
      mode = "para";
      return;
    }
    if (!content) return;
    emit(quoteDepth > 0 ? content.split("\n").map((l) => "> " + l).join("\n") : content);
  };

  const TOKEN = /<!--[\s\S]*?-->|<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>|[^<]+/g;
  let t: RegExpExecArray | null;
  while ((t = TOKEN.exec(fragment))) {
    const raw = t[0];
    if (raw.startsWith("<!--")) continue;
    const tagName = t[1];
    if (!tagName) {
      // text node
      if (inPre) preBuf += decodeEntities(raw);
      else inline += decodeEntities(raw).replace(/\s+/g, " ");
      continue;
    }
    const tag = tagName.toLowerCase();
    const isEnd = raw[1] === "/";
    const tagBody = t[2] ?? "";

    if (inPre && tag !== "pre") continue; // ignore markup inside <pre> except its close

    switch (tag) {
      case "h1": case "h2": case "h3": case "h4": case "h5": case "h6": {
        flush();
        if (!isEnd) { mode = "heading"; headingLevel = Number(tag[1]); } else flush();
        break;
      }
      case "p": case "div": case "section": case "article": case "main": case "table":
      case "thead": case "tbody": case "tr": case "figcaption": case "dl": case "dd": case "dt": {
        flush();
        break;
      }
      case "ul": case "ol": {
        flush();
        if (!isEnd) lists.push({ ordered: tag === "ol", index: 1 });
        else lists.pop();
        break;
      }
      case "li": {
        flush();
        if (!isEnd) {
          mode = "li";
        } else {
          flush();
          const top = lists[lists.length - 1];
          if (top?.ordered) top.index += 1;
        }
        break;
      }
      case "blockquote": {
        flush();
        if (!isEnd) quoteDepth += 1;
        else quoteDepth = Math.max(0, quoteDepth - 1);
        break;
      }
      case "pre": {
        if (!isEnd) {
          flush();
          inPre = true;
          preBuf = "";
        } else {
          inPre = false;
          const code = preBuf.replace(/^\n+/, "").replace(/\s+$/, "");
          if (code) emit("```\n" + code + "\n```");
          preBuf = "";
        }
        break;
      }
      case "hr": {
        flush();
        emit("---");
        break;
      }
      case "br": {
        inline += "\n";
        break;
      }
      case "strong": case "b": {
        inline += "**";
        break;
      }
      case "em": case "i": {
        inline += "*";
        break;
      }
      case "code": {
        inline += "`";
        break;
      }
      case "a": {
        if (!isEnd) {
          const href = resolveUrl(attr(tagBody, "href") ?? "", base);
          linkOpen = !!href;
          linkHref = href;
          if (linkOpen) inline += "[";
        } else if (linkOpen) {
          inline += `](${linkHref})`;
          linkOpen = false;
          linkHref = "";
        }
        break;
      }
      case "img": {
        const src = resolveUrl(attr(tagBody, "src") ?? "", base);
        if (src) inline += ` ![${(attr(tagBody, "alt") ?? "").replace(/[[\]]/g, "")}](${src}) `;
        break;
      }
      default:
        break;
    }
    if (outLen > MAX_MARKDOWN) break;
  }
  flush();

  return out
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+$/gm, "")
    .trim()
    .slice(0, MAX_MARKDOWN);
}

/**
 * Extract a readable Markdown snapshot + plain text + metadata from a page's HTML.
 * Callers decide whether the result is worth keeping (e.g. require a minimum wordCount).
 */
export function extractReadable(html: string, url?: string): ReadableResult {
  const title = metaContent(html, [
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)["']/i,
    /<title[^>]*>([\s\S]*?)<\/title>/i,
  ]);
  const byline = metaContent(html, [
    /<meta[^>]+name=["']author["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+property=["']article:author["'][^>]+content=["']([^"']+)["']/i,
  ]);
  const excerpt = metaContent(html, [
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i,
  ]);
  const siteName =
    metaContent(html, [/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i]) ?? hostName(url);

  const root = pickContentRoot(stripNoise(html));
  const markdown = htmlToMarkdown(root, url);
  const text = plainText(root);
  return { title, byline, excerpt, siteName, text, markdown, wordCount: countWords(text) };
}
