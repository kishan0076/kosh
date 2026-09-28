/**
 * Ranked vault search (§ Sprint 6) — a single pure ranker shared by the command palette
 * and the server /search endpoint. Supports free text plus filter operators:
 *   kind:skill  tag:frontend  stage:using  is:pinned  is:favorite  is:repo
 * Remaining words are AND-matched across weighted fields and scored by relevance.
 */

export interface SearchableItem {
  kind: string;
  title?: string;
  description?: string;
  url?: string;
  note?: string;
  tags: string[];
  stage?: string;
  linkType?: string;
  pinned?: boolean;
  favorite?: boolean;
  ai?: { summary?: string };
  prompt?: { body?: string };
  github?: { repoKind?: string };
  archive?: { excerpt?: string };
  updatedAt?: string;
}

export interface ParsedQuery {
  text: string;
  terms: string[];
  kind?: string;
  tag?: string;
  stage?: string;
  is: string[]; // pinned | favorite | repo
}

export interface SearchHit<T> {
  item: T;
  score: number;
}

/** Split a raw query into free-text terms and `field:value` / `is:x` filters. */
export function parseSearchQuery(raw: string): ParsedQuery {
  const parsed: ParsedQuery = { text: "", terms: [], is: [] };
  const words: string[] = [];
  for (const tokenRaw of raw.trim().split(/\s+/).filter(Boolean)) {
    const token = tokenRaw.toLowerCase();
    const m = token.match(/^(kind|tag|stage|is):(.+)$/);
    if (!m) {
      words.push(token);
      continue;
    }
    const [, field, value] = m as unknown as [string, string, string];
    if (field === "kind") parsed.kind = value;
    else if (field === "tag") parsed.tag = value;
    else if (field === "stage") parsed.stage = value;
    else if (field === "is") parsed.is.push(value);
  }
  parsed.terms = words;
  parsed.text = words.join(" ");
  return parsed;
}

function matchesFilters(item: SearchableItem, q: ParsedQuery): boolean {
  if (q.kind && item.kind !== q.kind) return false;
  if (q.stage && item.stage !== q.stage) return false;
  if (q.tag && !item.tags.some((t) => t.toLowerCase() === q.tag)) return false;
  for (const flag of q.is) {
    if (flag === "pinned" && !item.pinned) return false;
    if (flag === "favorite" && !item.favorite) return false;
    if (flag === "repo" && item.linkType !== "repo") return false;
  }
  return true;
}

/** Score one item against one lowercase term. Returns 0 when the term isn't found anywhere. */
function scoreTerm(item: SearchableItem, term: string): number {
  let score = 0;
  const title = item.title?.toLowerCase() ?? "";
  if (title === term) score += 14;
  else if (title.startsWith(term)) score += 10;
  else if (title.includes(term)) score += 6;

  for (const tag of item.tags) {
    const t = tag.toLowerCase();
    if (t === term) score += 5;
    else if (t.includes(term)) score += 3;
  }
  if (item.url?.toLowerCase().includes(term)) score += 2;
  if (item.description?.toLowerCase().includes(term)) score += 2;
  if (item.ai?.summary?.toLowerCase().includes(term)) score += 2;
  if (item.archive?.excerpt?.toLowerCase().includes(term)) score += 2;
  if (item.note?.toLowerCase().includes(term)) score += 1;
  if (item.prompt?.body?.toLowerCase().includes(term)) score += 1;
  return score;
}

/** Rank items by relevance to the query. Every free-text term must match (AND); a query with
 *  only filters (or empty) returns all matching items scored 0, so callers can fall back to recency. */
export function searchItems<T extends SearchableItem>(items: T[], rawQuery: string, opts: { limit?: number } = {}): SearchHit<T>[] {
  const q = parseSearchQuery(rawQuery);
  const hits: SearchHit<T>[] = [];
  for (const item of items) {
    if (!matchesFilters(item, q)) continue;
    let total = 0;
    let allMatched = true;
    for (const term of q.terms) {
      const s = scoreTerm(item, term);
      if (s === 0) {
        allMatched = false;
        break;
      }
      total += s;
    }
    if (!allMatched) continue;
    if (item.pinned) total += 1; // gentle tie-break toward pinned
    hits.push({ item, score: total });
  }
  hits.sort((a, b) => b.score - a.score || (b.item.updatedAt ?? "").localeCompare(a.item.updatedAt ?? ""));
  return opts.limit ? hits.slice(0, opts.limit) : hits;
}

/* ── recall-oriented retrieval (for "Ask your treasury" RAG grounding) ────────
 * searchItems is precision-first: every term must match (AND), which is right for a search box but wrong
 * for a natural-language QUESTION full of stopwords ("what did I save about SSRF?" → only "ssrf" matters).
 * retrieveItems strips stopwords + short words and OR-matches the remaining content terms, so a question
 * surfaces every item that mentions any of its meaningful words — the candidate set the model then reads. */

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "if", "of", "to", "in", "on", "for", "with", "about", "into", "from",
  "is", "are", "was", "were", "be", "been", "being", "do", "does", "did", "done", "have", "has", "had",
  "i", "me", "my", "we", "our", "you", "your", "it", "its", "this", "that", "these", "those", "there", "here",
  "what", "which", "who", "whom", "whose", "when", "where", "why", "how", "can", "could", "should", "would",
  "will", "shall", "may", "might", "must", "not", "no", "yes", "any", "all", "some", "more", "most", "other",
  "as", "at", "by", "so", "than", "then", "too", "very", "just", "up", "out", "over", "again", "once", "get",
  "got", "find", "show", "tell", "give", "saved", "save", "link", "links", "item", "items", "thing", "things",
]);

/** Retrieve candidate items for a natural-language question: stopword-stripped, OR-matched, recall-first.
 *  With no meaningful content terms (all stopwords) it returns items scored 0 so the caller can fall back
 *  to recency. Honors the same field:value / is: filters as searchItems. */
export function retrieveItems<T extends SearchableItem>(items: T[], rawQuery: string, opts: { limit?: number } = {}): SearchHit<T>[] {
  const q = parseSearchQuery(rawQuery);
  // Strip punctuation ("do?" → "do") so a trailing "?" can't leak a stopword through as a fake content term.
  // Keep 2-char content terms ("ai", "go", "js", "ml") — they're meaningful in a dev/AI library and common
  // stopwords of that length are already filtered by STOPWORDS.
  const terms = [...new Set(q.terms.map((t) => t.replace(/[^\p{L}\p{N}]/gu, "")).filter((t) => t.length >= 2 && !STOPWORDS.has(t)))];
  const hits: SearchHit<T>[] = [];
  for (const item of items) {
    if (!matchesFilters(item, q)) continue;
    let total = 0;
    for (const term of terms) total += scoreTerm(item, term); // OR: sum every term's contribution
    if (terms.length === 0 || total > 0) {
      if (item.pinned) total += 1;
      hits.push({ item, score: total });
    }
  }
  hits.sort((a, b) => b.score - a.score || (b.item.updatedAt ?? "").localeCompare(a.item.updatedAt ?? ""));
  return opts.limit ? hits.slice(0, opts.limit) : hits;
}
