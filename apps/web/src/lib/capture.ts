import { normalizeUrl } from "@kosh/shared";

export type Capture =
  | { kind: "empty" }
  | { kind: "search"; q: string }
  | { kind: "command"; q: string }
  | { kind: "repo"; url: string; owner: string; repo: string }
  | { kind: "link"; url: string };

const BARE_DOMAIN = /^([\w-]+\.)+[a-z]{2,}(\/\S*)?$/i;
const OWNER_REPO = /^[\w-]+\/[\w.-]+$/;

/** Interpret Quick-Add / palette input into an intent. Handles bare domains
 *  (github.com/o/r) and owner/repo shorthand, not just full URLs. */
export function parseCapture(raw: string): Capture {
  const v = raw.trim();
  if (!v) return { kind: "empty" };
  if (v.startsWith("/") || v.startsWith(">")) return { kind: "command", q: v.slice(1).trim() };

  const looksUrl = /^https?:\/\//i.test(v) || OWNER_REPO.test(v) || BARE_DOMAIN.test(v);
  if (looksUrl && !/\s/.test(v)) {
    try {
      const norm = normalizeUrl(v);
      const gh = norm.match(/^https?:\/\/github\.com\/([^/\s]+)\/([^/\s]+)/i);
      if (gh) return { kind: "repo", url: norm, owner: gh[1]!, repo: gh[2]! };
      if (/^https?:\/\//i.test(norm)) return { kind: "link", url: norm };
    } catch {
      /* fall through */
    }
  }
  return { kind: "search", q: v };
}
