import { Octokit } from "octokit";
import { detectRepoKind, extractInstall, parseFrontmatter, type GithubMeta, type Manifests, type SkillIndexEntry, type Tool, type TreeEntry } from "@kosh/shared";
import { config } from "../config.js";
import { logger } from "../logger.js";

const SKILL_ENTRY = /(^|\/)SKILL\.md$/i;
const CONFIG_FILES = [/^CLAUDE\.md$/, /^AGENTS\.md$/, /^\.cursorrules$/, /^\.cursor\/rules\/.+/, /^\.mcp\.json$/, /^\.claude\/settings\.json$/];

export function githubClient(token?: string | null): Octokit {
  return new Octokit({ auth: token ?? config.github.token ?? undefined });
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

export interface GithubEnrichment {
  github: GithubMeta;
  readme: string;
  tree: TreeEntry[];
  title: string;
  description?: string;
}

/** Enrich a GitHub repo: metadata, tree, readme, manifests, kind, skill index, install. (§5.4/§5.5) */
export async function enrichGithub(owner: string, repo: string, opts: { token?: string | null; prevSkillIndex?: SkillIndexEntry[] } = {}): Promise<{ ok: true; data: GithubEnrichment } | { ok: false; dead: boolean }> {
  const gh = githubClient(opts.token);
  try {
    const { data: r } = await gh.rest.repos.get({ owner, repo });
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
      repoKind: kind,
      repoKindSignals: signals,
      skillDirs,
      configFiles,
      skillIndex,
      install,
      snapshotPolicy: "auto",
      copiedCount: 0,
    };

    return { ok: true, data: { github, readme, tree, title: r.full_name, description: r.description ?? undefined } };
  } catch (err: unknown) {
    const status = (err as { status?: number }).status;
    if (status === 404 || status === 403 || status === 451) return { ok: false, dead: true };
    logger.warn({ err, owner, repo }, "github enrichment error");
    return { ok: false, dead: true };
  }
}
