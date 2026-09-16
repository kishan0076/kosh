import type { ScanFinding, ScanResult } from "./types.js";

/**
 * Pure helpers for the "publish a project folder to a new GitHub repo" feature.
 * No Node / browser APIs — file bytes are read by the caller; this module only
 * decides *which* files to publish, sanitizes the repo name, and scans text for
 * secrets so we never push a `.env` full of keys. Covered by repo-upload.test.ts.
 */

export interface RepoFileMeta {
  /** POSIX-style path relative to the repo root (no leading slash). */
  path: string;
  size: number;
}

export interface SkippedFile {
  path: string;
  reason: string;
}

export interface RepoUploadPlan {
  include: RepoFileMeta[];
  skipped: SkippedFile[];
  totalBytes: number;
}

export interface PlanOptions {
  /** Contents of a `.gitignore` to also honor (best-effort subset). */
  gitignore?: string;
  maxFiles?: number;
  maxFileBytes?: number;
  maxTotalBytes?: number;
}

export const PUBLISH_LIMITS = {
  maxFiles: 500,
  maxFileBytes: 5 * 1024 * 1024, // 5 MB per file
  maxTotalBytes: 10 * 1024 * 1024, // 10 MB per push (inline transport)
} as const;

/** Directory / file names that are never published. Matched against any path segment. */
export const DEFAULT_IGNORES: readonly string[] = [
  ".git",
  "node_modules",
  ".DS_Store",
  "Thumbs.db",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  ".venv",
  "venv",
  ".cache",
  ".turbo",
];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Turn a single gitignore glob into a RegExp fragment (`*` → any non-slash run, `?` → one char). */
function globToRegExp(glob: string): string {
  return escapeRegExp(glob).replace(/\\\*/g, "[^/]*").replace(/\\\?/g, "[^/]");
}

interface IgnoreRule {
  re: RegExp;
}

/**
 * Build a best-effort `.gitignore` matcher. Supports comments, blank lines,
 * trailing-slash (dir-only), leading-slash (root-anchored), `*`/`?` globs, and
 * bare names that match at any depth. Negation (`!`) lines are ignored.
 */
export function makeGitignoreMatcher(text: string | undefined): (path: string) => boolean {
  const rules: IgnoreRule[] = [];
  for (const raw of (text ?? "").split(/\r?\n/)) {
    let line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("!")) continue;
    const dirOnly = line.endsWith("/");
    if (dirOnly) line = line.slice(0, -1);
    const rooted = line.startsWith("/");
    if (rooted) line = line.slice(1);
    if (!line) continue;
    const body = globToRegExp(line);
    // Rooted or path-bearing patterns anchor at the repo root; bare names match at any depth.
    const anchored = rooted || line.includes("/");
    const prefix = anchored ? "^" : "(^|/)";
    // A dir-only rule (`build/`) matches only paths *under* that directory, never a file named
    // `build`; a plain rule matches the entry itself and anything beneath it.
    const suffix = dirOnly ? "/" : "(/|$)";
    rules.push({ re: new RegExp(`${prefix}${body}${suffix}`) });
  }
  return (path: string) => rules.some((r) => r.re.test(path));
}

/** True if any path segment is in DEFAULT_IGNORES. */
export function isDefaultIgnored(path: string): boolean {
  return path.split("/").some((seg) => DEFAULT_IGNORES.includes(seg));
}

/**
 * Decide which files to publish. Applies (in order): default ignores, `.gitignore`,
 * per-file size cap, then the file-count and total-size caps. Everything dropped is
 * reported in `skipped` with a human reason so the UI can show it.
 */
export function planRepoUpload(files: RepoFileMeta[], opts: PlanOptions = {}): RepoUploadPlan {
  const maxFiles = opts.maxFiles ?? PUBLISH_LIMITS.maxFiles;
  const maxFileBytes = opts.maxFileBytes ?? PUBLISH_LIMITS.maxFileBytes;
  const maxTotalBytes = opts.maxTotalBytes ?? PUBLISH_LIMITS.maxTotalBytes;
  const ignoredByGit = makeGitignoreMatcher(opts.gitignore);

  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));
  const include: RepoFileMeta[] = [];
  const skipped: SkippedFile[] = [];
  let totalBytes = 0;

  for (const f of sorted) {
    const path = f.path.replace(/^\/+/, "");
    if (!path || path.endsWith("/")) continue; // directories carry no content
    if (isDefaultIgnored(path)) {
      skipped.push({ path, reason: "build/system file (auto-skipped)" });
      continue;
    }
    if (ignoredByGit(path)) {
      skipped.push({ path, reason: "matched .gitignore" });
      continue;
    }
    if (f.size > maxFileBytes) {
      skipped.push({ path, reason: `too large (${formatKb(f.size)} > ${formatKb(maxFileBytes)})` });
      continue;
    }
    if (include.length >= maxFiles) {
      skipped.push({ path, reason: `over the ${maxFiles}-file limit` });
      continue;
    }
    if (totalBytes + f.size > maxTotalBytes) {
      skipped.push({ path, reason: `over the ${formatKb(maxTotalBytes)} total-size limit` });
      continue;
    }
    include.push({ path, size: f.size });
    totalBytes += f.size;
  }

  return { include, skipped, totalBytes };
}

function formatKb(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * Turn an arbitrary folder name into a valid GitHub repository name:
 * only letters, digits, `.`, `_`, `-`; collapse runs of `-`; trim junk; cap at 100.
 */
export function sanitizeRepoName(raw: string): string {
  const base = (raw ?? "").split(/[\\/]/).filter(Boolean).pop() ?? "";
  let name = base
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 100);
  if (!name || name === "." || name === "..") name = "new-project";
  return name;
}

/** GitHub's own rule for an acceptable repo name. */
export function isValidRepoName(name: string): boolean {
  return /^[A-Za-z0-9._-]{1,100}$/.test(name) && name !== "." && name !== "..";
}

/* ── Secret scanning ─────────────────────────────────────────── */

interface SecretRule {
  id: string;
  re: RegExp;
  message: string;
}

// High-signal secret shapes. Findings are warnings, never a hard error — the user confirms.
const SECRET_RULES: SecretRule[] = [
  { id: "private-key", re: /-----BEGIN\s+(?:RSA|EC|DSA|OPENSSH|PGP)?\s*PRIVATE KEY-----/, message: "private key block" },
  { id: "aws-access-key", re: /\bAKIA[0-9A-Z]{16}\b/, message: "AWS access key id" },
  { id: "github-token", re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/, message: "GitHub token" },
  { id: "kosh-key", re: /\bksh_[A-Za-z0-9_-]{20,}\b/, message: "Kosh API key" },
  { id: "slack-token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, message: "Slack token" },
  { id: "google-api-key", re: /\bAIza[0-9A-Za-z_-]{35}\b/, message: "Google API key" },
  { id: "openai-key", re: /\bsk-[A-Za-z0-9]{20,}\b/, message: "OpenAI-style secret key" },
  { id: "private-key-pem", re: /\bPRIVATE KEY-----/, message: "PEM private key" },
];

// A `key = "value"` assignment where the key name screams secret.
const ASSIGNMENT_RE = /\b([A-Za-z0-9_]*(?:secret|token|password|passwd|pwd|api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret)[A-Za-z0-9_]*)\b\s*[:=]\s*['"]([^'"]{6,})['"]/i;
// Obvious placeholders we should NOT flag.
// "your-api-key-here"/"my_token_here" are placeholders, but a real credential that merely starts
// with those words (e.g. "my-Prod-P@ssw0rd-9x7") must still be flagged — so the tail may only be
// lowercase-word characters, which real secrets (digits/uppercase/symbols) won't fully match.
const PLACEHOLDER_RE = /^(?:x{3,}|y{3,}|z{3,}|your[-_ ][a-z][a-z_ -]*|my[-_ ][a-z][a-z_ -]*|changeme|change[-_]me|placeholder|example|test|dummy|todo|xxx.*|\.{3}|<.*>|\{\{.*\}\}|\$\{.*\}|(?:ksh|sk|gh[pousr])_x+)$/i;

// Files whose very presence (with real values) is a leak.
const ENV_FILE_RE = /(^|\/)\.env(\.[A-Za-z0-9_-]+)?$/;
const ENV_EXAMPLE_RE = /\.(example|sample|template|dist)$/i;

/**
 * Scan text files for likely secrets before publishing. Returns the same
 * ScanResult shape as scanSkill; `risky` is true when anything was found.
 */
export function scanSecrets(texts: Map<string, string>): ScanResult {
  const findings: ScanFinding[] = [];
  for (const [path, text] of texts) {
    const isEnvFile = ENV_FILE_RE.test(path) && !ENV_EXAMPLE_RE.test(path);
    const lines = text.split("\n");
    lines.forEach((line, i) => {
      const lineNo = i + 1;
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("//")) return;

      for (const rule of SECRET_RULES) {
        if (rule.re.test(line)) findings.push({ path, line: lineNo, rule: rule.id, text: rule.message });
      }

      const m = ASSIGNMENT_RE.exec(line);
      if (m && !PLACEHOLDER_RE.test(m[2]!.trim())) {
        findings.push({ path, line: lineNo, rule: "hardcoded-secret", text: `hardcoded ${m[1]!.toLowerCase()}` });
      } else if (isEnvFile && /^[A-Za-z_][A-Za-z0-9_]*\s*=\s*\S/.test(trimmed)) {
        const val = trimmed.slice(trimmed.indexOf("=") + 1).trim().replace(/^['"]|['"]$/g, "");
        if (val && !PLACEHOLDER_RE.test(val)) {
          findings.push({ path, line: lineNo, rule: "env-value", text: "environment file with a real value" });
        }
      }
    });
  }
  // De-dupe identical (path,line,rule) hits from overlapping rules.
  const seen = new Set<string>();
  const unique = findings.filter((f) => {
    const k = `${f.path}:${f.line}:${f.rule}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { risky: unique.length > 0, findings: unique };
}
