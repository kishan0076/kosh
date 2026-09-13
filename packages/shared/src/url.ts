import type { LinkType } from "./types.js";

const TRACKING_PARAM = /^(utm_.*|fbclid|gclid|ref|ref_src|si|mc_cid|mc_eid|igshid)$/i;

/**
 * Canonicalize a user-supplied URL: coerce git/ssh/bare forms to https, strip
 * tracking params + hash + trailing slashes, lowercase the host, and collapse
 * GitHub repo URLs to `github.com/owner/repo`. (§5.1)
 */
export function normalizeUrl(input: string): string {
  let s = input.trim();

  const ssh = s.match(/^git@github\.com:([^/]+)\/(.+?)(\.git)?$/);
  if (ssh) s = `https://github.com/${ssh[1]}/${ssh[2]}`;

  // bare `owner/repo` or `owner/repo.git`
  const bareRepo = s.match(/^([\w.-]+)\/([\w.-]+?)(?:\.git)?$/);
  if (bareRepo && !s.includes(" ") && !/^https?:/i.test(s)) {
    s = `https://github.com/${bareRepo[1]}/${bareRepo[2]}`;
  }

  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;

  const u = new URL(s);
  u.hash = "";
  for (const k of [...u.searchParams.keys()]) {
    if (TRACKING_PARAM.test(k)) u.searchParams.delete(k);
  }
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");

  if (u.hostname === "github.com") {
    const m = u.pathname.match(/^\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
    if (m) return `https://github.com/${m[1]}/${m[2]}`;
  }

  return u.toString().replace(/\/+$/, "");
}

/** Classify a normalized URL into a coarse LinkType. (§5.1) */
export function classifyLink(url: string): LinkType {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return "other";
  }
  const parts = u.pathname.split("/").filter(Boolean);

  if (u.hostname === "github.com") {
    if (parts.length === 1) return "profile";
    if (parts.length === 2) return "repo";
    if (parts[2] === "releases") return "release";
    if (parts[2] && ["issues", "pull", "discussions"].includes(parts[2])) return "issue";
    return "repo";
  }
  if (u.hostname === "gist.github.com") return "gist";
  if (/^(npmjs\.com|pypi\.org|crates\.io|hub\.docker\.com)$/.test(u.hostname)) return "package";
  if (/(^|\.)(youtube\.com|youtu\.be)$/.test(u.hostname)) return "video";
  if (/(^|\.)(medium\.com|substack\.com|dev\.to|hashnode\.\w+)$/.test(u.hostname)) return "article";
  return "other";
}

/** Extract `{ owner, repo }` from any GitHub URL, or null. */
export function parseGithubRepo(url: string): { owner: string; repo: string } | null {
  try {
    const u = new URL(url);
    if (u.hostname !== "github.com") return null;
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length < 2 || !parts[0] || !parts[1]) return null;
    return { owner: parts[0], repo: parts[1].replace(/\.git$/, "") };
  } catch {
    return null;
  }
}

/** Best-effort site label from a URL, for card meta rows. */
export function siteNameFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
