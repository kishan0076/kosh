/**
 * Parse a Netscape bookmarks file (the `<DL><DT><A HREF …>` format every browser and most read-later
 * apps — Chrome, Firefox, Safari, Pocket, Raindrop — export). Pure and dependency-free: extract each
 * http(s) link with its title, folder-derived tags, any explicit TAGS attribute, and its add date.
 */

export interface BookmarkEntry {
  url: string;
  title?: string;
  tags?: string[];
  addedAt?: string; // ISO, from ADD_DATE when present
}

const decodeEntities = (s: string): string =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, n: string) => {
      try {
        return String.fromCodePoint(Number(n));
      } catch {
        return "";
      }
    });

const stripTags = (s: string): string => s.replace(/<[^>]*>/g, "");

/** Read an attribute value (double- or single-quoted) from an opening tag string. */
function attr(tag: string, name: string): string | undefined {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "i")) ?? tag.match(new RegExp(`\\b${name}\\s*=\\s*'([^']*)'`, "i"));
  return m ? m[1] : undefined;
}

// Generic top-level folder names that aren't meaningful as tags.
const IGNORED_FOLDERS = new Set(["bookmarks", "bookmarks bar", "bookmarks toolbar", "bookmarks menu", "other bookmarks", "favorites", "favorites bar", "unsorted"]);

const normTag = (t: string): string => decodeEntities(t).trim().toLowerCase();

/** Extract every http(s) bookmark from a Netscape-format export, deduped by URL, in document order. */
export function parseBookmarks(html: string): BookmarkEntry[] {
  const out: BookmarkEntry[] = [];
  const seen = new Set<string>();
  const folders: string[] = []; // current folder stack (H3 pushes, </DL> pops)

  // One pass over the four tokens that matter: <H3>…</H3>, <DL>, </DL>, <A …>…</A>.
  const tokenRe = /<h3\b[^>]*>([\s\S]*?)<\/h3>|<dl\b[^>]*>|<\/dl>|<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  for (const m of html.matchAll(tokenRe)) {
    const tok = m[0];
    if (/^<h3/i.test(tok)) {
      folders.push(decodeEntities(stripTags(m[1] ?? "")).trim());
    } else if (/^<\/dl/i.test(tok)) {
      folders.pop(); // close the innermost folder (the extra top-level </DL> pops harmlessly on empty)
    } else if (/^<a/i.test(tok)) {
      const openAttrs = m[2] ?? "";
      const href = attr(openAttrs, "href");
      if (!href) continue;
      const url = decodeEntities(href).trim();
      if (!/^https?:\/\//i.test(url)) continue; // skip javascript:, place:, chrome:, data: …
      if (seen.has(url)) continue;
      seen.add(url);

      const title = decodeEntities(stripTags(m[3] ?? "")).trim() || undefined;

      const tagSet = new Set<string>();
      for (const f of folders) {
        const t = normTag(f);
        if (t && !IGNORED_FOLDERS.has(t)) tagSet.add(t);
      }
      for (const t of (attr(openAttrs, "tags") ?? "").split(",")) {
        const n = normTag(t);
        if (n) tagSet.add(n);
      }
      const tags = [...tagSet].slice(0, 5);

      let addedAt: string | undefined;
      const addDate = attr(openAttrs, "add_date");
      if (addDate && /^\d+$/.test(addDate)) {
        const raw = Number(addDate);
        const ms = raw > 1e12 ? raw : raw * 1000; // seconds (browsers) or already-ms
        const d = new Date(ms);
        if (!Number.isNaN(d.getTime())) addedAt = d.toISOString();
      }

      out.push({ url, title, tags: tags.length ? tags : undefined, addedAt });
    }
  }
  return out;
}
