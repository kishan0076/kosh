import { githubClient, GithubAuthError, RepoNameTakenError, type PublishInputFile } from "./github.js";

/**
 * The GitHub "V2" management surface — list/inspect/create/edit/delete/push repos, plus read-only
 * Issues / Pull Requests / Actions. Octokit errors (which carry `.status`) bubble up; the route maps
 * them to typed API envelopes (see routes/githubV2.ts `githubCall`). In this sandbox the proxy blocks
 * api.github.com, so every one of these degrades to a typed error the client shows gracefully.
 */

/* ── shaping (octokit → lean client shapes) ── */

interface RepoLike {
  id: number;
  name: string;
  full_name: string;
  owner?: { login?: string; avatar_url?: string } | null;
  private: boolean;
  description?: string | null;
  html_url: string;
  default_branch?: string;
  language?: string | null;
  stargazers_count?: number;
  forks_count?: number;
  watchers_count?: number;
  open_issues_count?: number;
  archived?: boolean;
  disabled?: boolean;
  fork?: boolean;
  is_template?: boolean;
  visibility?: string;
  pushed_at?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
  size?: number;
  topics?: string[];
  homepage?: string | null;
  license?: { spdx_id?: string | null; name?: string | null } | null;
  permissions?: { admin?: boolean; maintain?: boolean; push?: boolean; triage?: boolean; pull?: boolean };
}

export interface RepoSummary {
  id: number;
  name: string;
  fullName: string;
  owner: string;
  ownerAvatar?: string;
  private: boolean;
  description?: string;
  htmlUrl: string;
  defaultBranch: string;
  language?: string;
  stars: number;
  forks: number;
  watchers: number;
  openIssues: number;
  archived: boolean;
  disabled: boolean;
  fork: boolean;
  template: boolean;
  visibility: string;
  pushedAt?: string;
  updatedAt?: string;
  createdAt?: string;
  size: number;
  topics: string[];
  homepage?: string;
  license?: string;
  canAdmin: boolean;
  canPush: boolean;
}

function toSummary(r: RepoLike): RepoSummary {
  return {
    id: r.id,
    name: r.name,
    fullName: r.full_name,
    owner: r.owner?.login ?? r.full_name.split("/")[0] ?? "",
    ownerAvatar: r.owner?.avatar_url ?? undefined,
    private: r.private,
    description: r.description ?? undefined,
    htmlUrl: r.html_url,
    defaultBranch: r.default_branch ?? "main",
    language: r.language ?? undefined,
    stars: r.stargazers_count ?? 0,
    forks: r.forks_count ?? 0,
    watchers: r.watchers_count ?? 0,
    openIssues: r.open_issues_count ?? 0,
    archived: r.archived ?? false,
    disabled: r.disabled ?? false,
    fork: r.fork ?? false,
    template: r.is_template ?? false,
    visibility: r.visibility ?? (r.private ? "private" : "public"),
    pushedAt: r.pushed_at ?? undefined,
    updatedAt: r.updated_at ?? undefined,
    createdAt: r.created_at ?? undefined,
    size: r.size ?? 0,
    topics: r.topics ?? [],
    homepage: r.homepage || undefined,
    license: r.license?.spdx_id ?? r.license?.name ?? undefined,
    canAdmin: r.permissions?.admin ?? false,
    canPush: r.permissions?.push ?? r.permissions?.admin ?? false,
  };
}

/* ── list + detail ── */

export type RepoSort = "updated" | "pushed" | "created" | "full_name";

/** One page of the authenticated user's repositories (owned + collaborator + org member). */
export async function listRepos(
  token: string,
  opts: { page?: number; perPage?: number; sort?: RepoSort } = {},
): Promise<{ repos: RepoSummary[]; page: number; hasMore: boolean }> {
  const gh = githubClient(token);
  const perPage = Math.min(Math.max(opts.perPage ?? 100, 1), 100);
  const page = Math.max(opts.page ?? 1, 1);
  const res = await gh.rest.repos.listForAuthenticatedUser({
    per_page: perPage,
    page,
    sort: opts.sort ?? "pushed",
    affiliation: "owner,collaborator,organization_member",
  });
  return { repos: res.data.map((r) => toSummary(r as unknown as RepoLike)), page, hasMore: res.data.length === perPage };
}

export interface RepoDetail extends RepoSummary {
  parent?: string;
  network?: number;
  subscribers?: number;
}

/* ── owners (the authed user + orgs they can create repos in) ── */

export interface OwnerLite {
  login: string;
  type: "user" | "org";
  avatarUrl?: string;
}

/** The authenticated user plus every org they belong to — the possible owners for a new repo. */
export async function listOwners(token: string): Promise<OwnerLite[]> {
  const gh = githubClient(token);
  const [me, orgs] = await Promise.all([
    gh.rest.users.getAuthenticated(),
    gh.rest.orgs.listForAuthenticatedUser({ per_page: 100 }),
  ]);
  const owners: OwnerLite[] = [{ login: me.data.login, type: "user", avatarUrl: me.data.avatar_url ?? undefined }];
  for (const o of orgs.data) owners.push({ login: o.login, type: "org", avatarUrl: o.avatar_url ?? undefined });
  return owners;
}

/** Is `owner/name` free? true = available, false = already exists. */
export async function repoNameAvailable(token: string, owner: string, name: string): Promise<boolean> {
  const gh = githubClient(token);
  try {
    await gh.rest.repos.get({ owner, repo: name });
    return false; // a 200 means it exists
  } catch (err) {
    if ((err as { status?: number }).status === 404) return true;
    throw err; // auth / rate-limit must surface, never masquerade as "available"
  }
}

/** The blobs (path + git sha) already on a branch — the base for the upload dry-run diff. Empty for a
 *  new/empty repo. The sha lets the client label each file Added / Overwrites / Unchanged. */
export async function getRepoTree(token: string, owner: string, repo: string, branch?: string): Promise<{ entries: { path: string; sha: string }[]; truncated: boolean }> {
  const gh = githubClient(token);
  const info = await gh.rest.repos.get({ owner, repo });
  const ref = branch || info.data.default_branch || "main";
  try {
    const res = await gh.rest.git.getTree({ owner, repo, tree_sha: ref, recursive: "1" });
    const entries = (res.data.tree ?? [])
      .filter((t) => t.type === "blob" && t.path && t.sha)
      .map((t) => ({ path: t.path as string, sha: t.sha as string }));
    return { entries, truncated: res.data.truncated ?? false };
  } catch (err) {
    // 404 (branch/repo empty) or 409 (empty repo) → nothing exists yet, which is a valid diff base.
    const status = (err as { status?: number }).status;
    if (status === 404 || status === 409) return { entries: [], truncated: false };
    throw err;
  }
}

export async function getRepoDetail(token: string, owner: string, repo: string): Promise<RepoDetail> {
  const gh = githubClient(token);
  const res = await gh.rest.repos.get({ owner, repo });
  const r = res.data as unknown as RepoLike & { parent?: { full_name?: string }; network_count?: number; subscribers_count?: number };
  return { ...toSummary(r), parent: r.parent?.full_name, network: r.network_count, subscribers: r.subscribers_count };
}

/** Read a single text file's content for the in-app editor. Missing file → an empty new file. */
export async function getFileContent(token: string, owner: string, repo: string, path: string, branch?: string): Promise<{ content: string; sha: string | null; isNew: boolean }> {
  const gh = githubClient(token);
  try {
    const res = await gh.rest.repos.getContent({ owner, repo, path, ...(branch ? { ref: branch } : {}) });
    if (Array.isArray(res.data) || (res.data as { type?: string }).type !== "file") {
      throw new Error("That path is a directory, not a file.");
    }
    const data = res.data as { content?: string; encoding?: string; sha?: string };
    const buf = Buffer.from(data.content ?? "", (data.encoding as BufferEncoding) ?? "base64");
    if (buf.includes(0)) throw new Error("That file is binary and can't be edited here.");
    return { content: buf.toString("utf8"), sha: data.sha ?? null, isNew: false };
  } catch (err) {
    if ((err as { status?: number }).status === 404) return { content: "", sha: null, isNew: true };
    throw err;
  }
}

export async function getReadmeMarkdown(token: string, owner: string, repo: string): Promise<string | null> {
  try {
    const gh = githubClient(token);
    const rd = await gh.rest.repos.getReadme({ owner, repo });
    return Buffer.from(rd.data.content, "base64").toString("utf8");
  } catch (err) {
    // "No README" is a 404. Anything else (auth, rate limit) must surface, not masquerade as empty.
    if ((err as { status?: number }).status === 404) return null;
    throw err;
  }
}

/* ── branches / commits / releases ── */

export interface BranchLite {
  name: string;
  protected: boolean;
  commitSha: string;
}
export async function listBranches(token: string, owner: string, repo: string): Promise<BranchLite[]> {
  const gh = githubClient(token);
  const res = await gh.rest.repos.listBranches({ owner, repo, per_page: 100 });
  return res.data.map((b) => ({ name: b.name, protected: b.protected ?? false, commitSha: b.commit.sha }));
}

export interface CommitLite {
  sha: string;
  message: string;
  authorName?: string;
  authorLogin?: string;
  authorAvatar?: string;
  date?: string;
  htmlUrl: string;
}
export async function listCommits(token: string, owner: string, repo: string, opts: { perPage?: number; sha?: string } = {}): Promise<CommitLite[]> {
  const gh = githubClient(token);
  let res;
  try {
    res = await gh.rest.repos.listCommits({ owner, repo, per_page: Math.min(opts.perPage ?? 30, 100), ...(opts.sha ? { sha: opts.sha } : {}) });
  } catch (err) {
    // A brand-new/empty repo returns 409 "Git Repository is empty" — that's just no commits yet.
    if ((err as { status?: number }).status === 409) return [];
    throw err;
  }
  return res.data.map((c) => ({
    sha: c.sha,
    message: c.commit.message,
    authorName: c.commit.author?.name ?? undefined,
    authorLogin: c.author?.login ?? undefined,
    authorAvatar: c.author?.avatar_url ?? undefined,
    date: c.commit.author?.date ?? undefined,
    htmlUrl: c.html_url,
  }));
}

export interface ReleaseLite {
  id: number;
  tag: string;
  name?: string;
  draft: boolean;
  prerelease: boolean;
  publishedAt?: string;
  htmlUrl: string;
  body?: string;
}
export async function listReleases(token: string, owner: string, repo: string): Promise<ReleaseLite[]> {
  const gh = githubClient(token);
  const res = await gh.rest.repos.listReleases({ owner, repo, per_page: 30 });
  return res.data.map((r) => ({
    id: r.id,
    tag: r.tag_name,
    name: r.name ?? undefined,
    draft: r.draft,
    prerelease: r.prerelease,
    publishedAt: r.published_at ?? undefined,
    htmlUrl: r.html_url,
    body: r.body ?? undefined,
  }));
}

/* ── read-only: issues / pulls / actions ── */

export interface IssueLite {
  number: number;
  title: string;
  state: string;
  authorLogin?: string;
  comments: number;
  createdAt?: string;
  htmlUrl: string;
  labels: { name: string; color: string }[];
}
export async function listIssues(token: string, owner: string, repo: string, opts: { state?: "open" | "closed" | "all" } = {}): Promise<IssueLite[]> {
  const gh = githubClient(token);
  const res = await gh.rest.issues.listForRepo({ owner, repo, state: opts.state ?? "open", per_page: 30 });
  // listForRepo returns PRs too — drop them (they surface under Pull requests).
  return res.data
    .filter((i) => !i.pull_request)
    .map((i) => ({
      number: i.number,
      title: i.title,
      state: i.state,
      authorLogin: i.user?.login ?? undefined,
      comments: i.comments,
      createdAt: i.created_at,
      htmlUrl: i.html_url,
      labels: (i.labels ?? []).map((l) => (typeof l === "string" ? { name: l, color: "888888" } : { name: l.name ?? "", color: l.color ?? "888888" })),
    }));
}

export interface PullLite {
  number: number;
  title: string;
  state: string;
  draft: boolean;
  authorLogin?: string;
  createdAt?: string;
  htmlUrl: string;
  base?: string;
  head?: string;
}
export async function listPulls(token: string, owner: string, repo: string, opts: { state?: "open" | "closed" | "all" } = {}): Promise<PullLite[]> {
  const gh = githubClient(token);
  const res = await gh.rest.pulls.list({ owner, repo, state: opts.state ?? "open", per_page: 30 });
  return res.data.map((p) => ({
    number: p.number,
    title: p.title,
    state: p.state,
    draft: p.draft ?? false,
    authorLogin: p.user?.login ?? undefined,
    createdAt: p.created_at,
    htmlUrl: p.html_url,
    base: p.base?.ref,
    head: p.head?.ref,
  }));
}

export interface WorkflowRunLite {
  id: number;
  name?: string;
  status?: string;
  conclusion?: string;
  event?: string;
  branch?: string;
  createdAt?: string;
  htmlUrl: string;
}
export async function listWorkflowRuns(token: string, owner: string, repo: string): Promise<WorkflowRunLite[]> {
  const gh = githubClient(token);
  const res = await gh.rest.actions.listWorkflowRunsForRepo({ owner, repo, per_page: 30 });
  return res.data.workflow_runs.map((w) => ({
    id: w.id,
    name: w.name ?? undefined,
    status: w.status ?? undefined,
    conclusion: w.conclusion ?? undefined,
    event: w.event,
    branch: w.head_branch ?? undefined,
    createdAt: w.created_at,
    htmlUrl: w.html_url,
  }));
}

/* ── mutations: create / edit / delete / push ── */

export async function createRepo(
  token: string,
  opts: { name: string; description?: string; private?: boolean; autoInit?: boolean; gitignoreTemplate?: string; licenseTemplate?: string; homepage?: string; org?: string },
): Promise<RepoDetail> {
  const gh = githubClient(token);
  const common = {
    name: opts.name,
    description: opts.description,
    private: opts.private ?? true,
    auto_init: opts.autoInit ?? false,
    gitignore_template: opts.gitignoreTemplate || undefined,
    license_template: opts.licenseTemplate || undefined,
    homepage: opts.homepage || undefined,
  };
  try {
    // An org owner uses createInOrg; otherwise the repo lands on the authenticated user.
    const res = opts.org
      ? await gh.rest.repos.createInOrg({ org: opts.org, ...common })
      : await gh.rest.repos.createForAuthenticatedUser(common);
    const r = res.data as unknown as RepoLike;
    return { ...toSummary(r) };
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 422) throw new RepoNameTakenError(opts.name);
    if (status === 401 || status === 403) throw new GithubAuthError(opts.org ? `This token can't create repositories in ${opts.org} — you need repo-creation rights in that organization.` : "This GitHub token can't create repositories — reconnect with the 'repo' scope.");
    throw err;
  }
}

export async function updateRepo(
  token: string,
  owner: string,
  repo: string,
  patch: { name?: string; description?: string; private?: boolean; defaultBranch?: string; homepage?: string; archived?: boolean },
): Promise<RepoDetail> {
  const gh = githubClient(token);
  const res = await gh.rest.repos.update({
    owner,
    repo,
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.description !== undefined ? { description: patch.description } : {}),
    ...(patch.private !== undefined ? { private: patch.private } : {}),
    ...(patch.defaultBranch !== undefined ? { default_branch: patch.defaultBranch } : {}),
    ...(patch.homepage !== undefined ? { homepage: patch.homepage } : {}),
    ...(patch.archived !== undefined ? { archived: patch.archived } : {}),
  });
  return { ...toSummary(res.data as unknown as RepoLike) };
}

export async function deleteRepo(token: string, owner: string, repo: string): Promise<void> {
  const gh = githubClient(token);
  await gh.rest.repos.delete({ owner, repo });
}

/** Replace a repo's topics (lowercased, GitHub's own rule). Returns the stored list. */
export async function setTopics(token: string, owner: string, repo: string, names: string[]): Promise<string[]> {
  const gh = githubClient(token);
  const clean = [...new Set(names.map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 20);
  const res = await gh.rest.repos.replaceAllTopics({ owner, repo, names: clean });
  return res.data.names ?? clean;
}

export interface PushResult {
  commitSha: string;
  htmlUrl: string;
  branch: string;
  pullRequestUrl?: string;
  pullRequestNumber?: number;
}

/**
 * Push a set of files to an EXISTING repo as one commit on top of `branch` (default: the repo's default
 * branch). Builds a tree on the branch's current tree so existing files are preserved unless overwritten.
 * Handles the empty-repo case (no commits yet) by committing with no parent. When `pullRequest` is set
 * (and `branch` differs from its base), opens a PR from the pushed branch back to the base.
 */
export async function commitFiles(
  token: string,
  owner: string,
  repo: string,
  opts: { files: PublishInputFile[]; message: string; branch?: string; pullRequest?: { base?: string; title: string; body?: string } },
): Promise<PushResult> {
  if (!opts.files.length) throw new Error("Refusing to push an empty file list.");
  const gh = githubClient(token);

  const info = await gh.rest.repos.get({ owner, repo });
  const defaultBranch = info.data.default_branch || "main";
  const branch = opts.branch || defaultBranch;

  // Resolve the commit this push builds on:
  //  - existing branch → its head (base_tree preserves the branch's existing files)
  //  - a NEW branch on a repo that has commits → fork from the default branch (never orphan it)
  //  - empty repo (the default branch has no commits yet) → a root commit with no parent
  const isNotFound = (e: unknown) => (e as { status?: number }).status === 404;
  const headOf = async (ref: string): Promise<{ sha: string; tree: string }> => {
    const r = await gh.rest.git.getRef({ owner, repo, ref });
    const c = await gh.rest.git.getCommit({ owner, repo, commit_sha: r.data.object.sha });
    return { sha: r.data.object.sha, tree: c.data.tree.sha };
  };

  let parentSha: string | undefined;
  let baseTree: string | undefined;
  let branchExists = false;
  try {
    const head = await headOf(`heads/${branch}`);
    parentSha = head.sha;
    baseTree = head.tree;
    branchExists = true;
  } catch (err) {
    if (!isNotFound(err)) throw err; // never mask a real failure (auth/5xx) as "empty repo"
    if (branch !== defaultBranch) {
      // A brand-new branch: base it on the default branch so existing files aren't dropped.
      try {
        const head = await headOf(`heads/${defaultBranch}`);
        parentSha = head.sha;
        baseTree = head.tree;
      } catch (e2) {
        if (!isNotFound(e2)) throw e2; // default missing only when the repo is genuinely empty
      }
    }
    // else: empty repo (default branch has no commits) → root commit, no parent / base tree
  }

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

  const treeRes = await gh.rest.git.createTree({ owner, repo, tree, ...(baseTree ? { base_tree: baseTree } : {}) });
  const commit = await gh.rest.git.createCommit({
    owner,
    repo,
    message: opts.message,
    tree: treeRes.data.sha,
    parents: parentSha ? [parentSha] : [],
  });

  if (branchExists) {
    await gh.rest.git.updateRef({ owner, repo, ref: `heads/${branch}`, sha: commit.data.sha });
  } else {
    await gh.rest.git.createRef({ owner, repo, ref: `refs/heads/${branch}`, sha: commit.data.sha });
  }

  // Optionally open a PR from the pushed branch back to a base (commit-as-PR for protected branches).
  let pullRequestUrl: string | undefined;
  let pullRequestNumber: number | undefined;
  const prBase = opts.pullRequest?.base || defaultBranch;
  if (opts.pullRequest && branch !== prBase) {
    const pr = await gh.rest.pulls.create({
      owner,
      repo,
      head: branch,
      base: prBase,
      title: opts.pullRequest.title || opts.message,
      body: opts.pullRequest.body,
    });
    pullRequestUrl = pr.data.html_url;
    pullRequestNumber = pr.data.number;
  }

  return { commitSha: commit.data.sha, htmlUrl: `${info.data.html_url}/commit/${commit.data.sha}`, branch, pullRequestUrl, pullRequestNumber };
}
