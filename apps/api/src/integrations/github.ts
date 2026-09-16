import { Octokit } from "octokit";
import { detectRepoKind, extractInstall, parseFrontmatter, type GithubMeta, type Manifests, type SkillIndexEntry, type Tool, type TreeEntry } from "@kosh/shared";
import { config } from "../config.js";
import { logger } from "../logger.js";

const SKILL_ENTRY = /(^|\/)SKILL\.md$/i;
const CONFIG_FILES = [/^CLAUDE\.md$/, /^AGENTS\.md$/, /^\.cursorrules$/, /^\.cursor\/rules\/.+/, /^\.mcp\.json$/, /^\.claude\/settings\.json$/];

export function githubClient(token?: string | null): Octokit {
  return new Octokit({ auth: token ?? config.github.token ?? undefined });
}

/* ── Publish a folder to a new repo (create → tree → commit → ref) ─── */

/** A repository name that's already taken on the account. */
export class RepoNameTakenError extends Error {
  constructor(public repoName: string) {
    super(`A repository named "${repoName}" already exists on this account.`);
    this.name = "RepoNameTakenError";
  }
}
/** The token is missing, invalid, or lacks the scope needed to create/push. */
export class GithubAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GithubAuthError";
  }
}

export interface PublishInputFile {
  /** Repo-root-relative POSIX path. */
  path: string;
  content: string;
  encoding?: "utf-8" | "base64";
}
export interface PublishRepoResult {
  owner: string;
  repo: string;
  htmlUrl: string;
  defaultBranch: string;
  commitSha: string;
  private: boolean;
}

/** Verify a token and report which OAuth scopes it carries (empty for fine-grained tokens). */
export async function validateGithubToken(token: string): Promise<{ login: string; scopes: string[] } | null> {
  try {
    const gh = githubClient(token);
    const me = await gh.rest.users.getAuthenticated();
    const raw = (me.headers as Record<string, string>)["x-oauth-scopes"] ?? "";
    const scopes = raw.split(",").map((s) => s.trim()).filter(Boolean);
    return { login: me.data.login, scopes };
  } catch {
    return null;
  }
}

/**
 * Create a brand-new GitHub repo and push all files as a single initial commit.
 * Text files are inlined into the tree; binary files go up as base64 blobs first.
 * Throws RepoNameTakenError / GithubAuthError for the two expected failures.
 */
export async function createRepoWithFiles(
  token: string,
  opts: { name: string; description?: string; private?: boolean; files: PublishInputFile[]; commitMessage?: string; branch?: string },
): Promise<PublishRepoResult> {
  if (!opts.files.length) throw new Error("Refusing to publish an empty file list.");
  const gh = githubClient(token);
  const branch = opts.branch || "main";

  let login: string;
  try {
    login = (await gh.rest.users.getAuthenticated()).data.login;
  } catch {
    throw new GithubAuthError("GitHub token is invalid or expired. Reconnect GitHub or paste a token with repo access.");
  }

  let created;
  try {
    created = await gh.rest.repos.createForAuthenticatedUser({
      name: opts.name,
      description: opts.description,
      private: opts.private ?? true,
      auto_init: false,
    });
  } catch (err: unknown) {
    const status = (err as { status?: number }).status;
    if (status === 422) throw new RepoNameTakenError(opts.name);
    if (status === 401 || status === 403) {
      throw new GithubAuthError("This GitHub token can't create repositories — it needs the 'repo' scope (or Administration: write for fine-grained tokens).");
    }
    throw err;
  }

  const owner = created.data.owner?.login ?? login;
  const repo = created.data.name;

  try {
    const tree: { path: string; mode: "100644"; type: "blob"; sha?: string; content?: string }[] = [];
    for (const f of opts.files) {
      const path = f.path.replace(/^\/+/, "");
      if (f.encoding === "base64") {
        const blob = await gh.rest.git.createBlob({ owner, repo, content: f.content, encoding: "base64" });
        tree.push({ path, mode: "100644", type: "blob", sha: blob.data.sha });
      } else {
        tree.push({ path, mode: "100644", type: "blob", content: f.content });
      }
    }
    const treeRes = await gh.rest.git.createTree({ owner, repo, tree });
    const commit = await gh.rest.git.createCommit({
      owner,
      repo,
      message: opts.commitMessage || "Initial commit from Kosh",
      tree: treeRes.data.sha,
      parents: [],
    });
    await gh.rest.git.createRef({ owner, repo, ref: `refs/heads/${branch}`, sha: commit.data.sha });
    return { owner, repo, htmlUrl: created.data.html_url, defaultBranch: branch, commitSha: commit.data.sha, private: created.data.private };
  } catch (err: unknown) {
    const status = (err as { status?: number }).status;
    if (status === 401 || status === 403) {
      throw new GithubAuthError("The repo was created but the token can't push files — it needs 'Contents: write' access.");
    }
    throw err;
  }
}

async function pool<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let i = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]!);
    }
  });
  await Promise.all(workers);
  return out;
}

function toolFromFrontmatter(fm: Record<string, unknown>): Tool | undefined {
  const compat = String(fm.compatibility ?? "").toLowerCase();
  if (compat.includes("claude")) return "claude";
  if (compat.includes("codex")) return "codex";
  if (compat.includes("cursor")) return "cursor";
  if (compat.includes("gemini")) return "gemini";
  return undefined;
}

async function getText(gh: Octokit, owner: string, repo: string, path: string): Promise<string | null> {
  try {
    const res = await gh.rest.repos.getContent({ owner, repo, path });
    const data = res.data as { content?: string; encoding?: string };
    if (data.content) return Buffer.from(data.content, (data.encoding as BufferEncoding) ?? "base64").toString("utf8");
  } catch {
    /* missing */
  }
  return null;
}

async function readManifests(gh: Octokit, owner: string, repo: string, tree: TreeEntry[]): Promise<Manifests> {
  const m: Manifests = {};
  const has = (p: string) => tree.some((t) => t.path === p);
  if (has("package.json")) {
    const raw = await getText(gh, owner, repo, "package.json");
    if (raw) {
      try {
        const pkg = JSON.parse(raw);
        m.pkg = { name: pkg.name, bin: pkg.bin, dependencies: pkg.dependencies, devDependencies: pkg.devDependencies };
      } catch {
        /* invalid */
      }
    }
  }
  if (has("pyproject.toml")) {
    const raw = await getText(gh, owner, repo, "pyproject.toml");
    if (raw) {
      const nameM = raw.match(/^\s*name\s*=\s*["']([^"']+)["']/m);
      m.pkg = { ...m.pkg, name: m.pkg?.name ?? nameM?.[1] };
      m.pyScripts = /\[project\.scripts\]|\[tool\.poetry\.scripts\]/.test(raw);
      const deps = [...raw.matchAll(/^\s*([\w.-]+)\s*=/gm)].map((x) => x[1]!.toLowerCase());
      m.pyDeps = Object.fromEntries(deps.map((d) => [d, "*"]));
    }
  }
  if (has("go.mod")) m.goModule = true;
  return m;
}

async function fullTree(gh: Octokit, owner: string, repo: string, branch: string): Promise<TreeEntry[]> {
  const res = await gh.rest.git.getTree({ owner, repo, tree_sha: branch, recursive: "1" });
  return (res.data.tree ?? []).map((t) => ({ path: t.path ?? "", type: t.type === "tree" ? "tree" : "blob", size: t.size, sha: t.sha }));
}

export interface GithubBudget {
  remaining: number;
  total: number;
  resetAt: string;
}
export interface GithubEnrichment {
  github: GithubMeta;
  readme: string;
  tree: TreeEntry[];
  title: string;
  description?: string;
  budget?: GithubBudget;
}

function readBudget(headers: Record<string, unknown>): GithubBudget | undefined {
  const remaining = Number(headers["x-ratelimit-remaining"]);
  const total = Number(headers["x-ratelimit-limit"]);
  const reset = Number(headers["x-ratelimit-reset"]);
  if (Number.isNaN(remaining) || Number.isNaN(total)) return undefined;
  return { remaining, total, resetAt: new Date((reset || 0) * 1000).toISOString() };
}

/** Enrich a GitHub repo: metadata, tree, readme, manifests, kind, skill index, install. (§5.4/§5.5)
 *  ETag-aware: returns { unchanged: true } on a 304 so a refresh costs no budget. */
export async function enrichGithub(
  owner: string,
  repo: string,
  opts: { token?: string | null; prevSkillIndex?: SkillIndexEntry[]; etag?: string } = {},
): Promise<{ ok: true; data: GithubEnrichment } | { ok: false; dead?: boolean; unchanged?: boolean }> {
  const gh = githubClient(opts.token);
  let budget: GithubBudget | undefined;
  try {
    const res = await gh.rest.repos.get({ owner, repo, headers: opts.etag ? { "If-None-Match": opts.etag } : {} });
    const r = res.data;
    budget = readBudget(res.headers as Record<string, unknown>);
    const etag = (res.headers as Record<string, string>).etag;
    const branch = r.default_branch;
    let tree: TreeEntry[] = [];
    try {
      tree = await fullTree(gh, owner, repo, branch);
    } catch (err) {
      logger.warn({ err }, "github tree fetch failed");
    }
    const blobs = tree.filter((t) => t.type === "blob");
    const skillDirs = blobs.filter((t) => SKILL_ENTRY.test(t.path)).map((t) => t.path.replace(/SKILL\.md$/i, ""));
    const configFiles = blobs.filter((t) => CONFIG_FILES.some((p) => p.test(t.path))).map((t) => t.path);
    const manifests = await readManifests(gh, owner, repo, tree);
    const { kind, signals } = detectRepoKind({ name: r.name, topics: r.topics ?? [], is_template: r.is_template ?? false, language: r.language }, tree, manifests);

    let readme = "";
    try {
      const rd = await gh.rest.repos.getReadme({ owner, repo });
      readme = Buffer.from(rd.data.content, "base64").toString("utf8");
    } catch {
      /* no readme */
    }

    const install = extractInstall(readme, manifests);
    const prev = new Map((opts.prevSkillIndex ?? []).map((s) => [s.path, s]));
    const skillIndex: SkillIndexEntry[] = await pool(skillDirs.slice(0, 60), 5, async (dir) => {
      const raw = await getText(gh, owner, repo, `${dir}SKILL.md`);
      const fm = raw ? parseFrontmatter(raw).data : {};
      const name = String(fm.name ?? dir.replace(/\/$/, "").split("/").pop() ?? "skill");
      return {
        path: dir,
        name,
        description: fm.description ? String(fm.description) : undefined,
        tool: toolFromFrontmatter(fm),
        snapshotted: prev.get(dir)?.snapshotted ?? false,
      };
    });

    const github: GithubMeta = {
      owner,
      repo,
      stars: r.stargazers_count,
      forks: r.forks_count,
      language: r.language ?? undefined,
      topics: r.topics ?? [],
      license: r.license?.spdx_id ?? undefined,
      pushedAt: r.pushed_at ?? undefined,
      defaultBranch: branch,
      archived: r.archived,
      etag,
      treeSha: tree.find((t) => t.path === "")?.sha,
      repoKind: kind,
      repoKindSignals: signals,
      skillDirs,
      configFiles,
      skillIndex,
      install,
      snapshotPolicy: "auto",
      copiedCount: (opts.prevSkillIndex ?? []).filter((s) => s.snapshotted).length,
    };

    return { ok: true, data: { github, readme, tree, title: r.full_name, description: r.description ?? undefined, budget } };
  } catch (err: unknown) {
    const status = (err as { status?: number }).status;
    if (status === 304) return { ok: false, unchanged: true };
    if (status === 404 || status === 403 || status === 451) return { ok: false, dead: true };
    logger.warn({ err, owner, repo }, "github enrichment error");
    return { ok: false, dead: true };
  }
}
