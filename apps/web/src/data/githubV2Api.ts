import { API_BASE, ApiError } from "./api";

/* ── typed client for the Kosh /github repo-manager API ── */

async function greq<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
    ...init,
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    let code: string | undefined;
    let details: unknown;
    try {
      const body = await res.json();
      message = body?.error?.message ?? message;
      code = body?.error?.code;
      details = body?.error?.details;
    } catch {
      /* ignore */
    }
    throw new ApiError(message, code, details, res.status);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export type RepoSort = "updated" | "pushed" | "created" | "full_name";

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

export interface RepoDetail extends RepoSummary {
  parent?: string;
  network?: number;
  subscribers?: number;
}

export interface BranchLite {
  name: string;
  protected: boolean;
  commitSha: string;
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
export interface PushResult {
  commitSha: string;
  htmlUrl: string;
  branch: string;
  pullRequestUrl?: string;
  pullRequestNumber?: number;
}
export interface PushFileInput {
  path: string;
  content: string;
  encoding?: "utf-8" | "base64";
}
export interface OwnerLite {
  login: string;
  type: "user" | "org";
  avatarUrl?: string;
}

const enc = encodeURIComponent;

export const githubV2Api = {
  listRepos: (opts: { page?: number; perPage?: number; sort?: RepoSort } = {}) => {
    const p = new URLSearchParams();
    if (opts.page) p.set("page", String(opts.page));
    if (opts.perPage) p.set("perPage", String(opts.perPage));
    if (opts.sort) p.set("sort", opts.sort);
    return greq<{ repos: RepoSummary[]; page: number; hasMore: boolean }>(`/github/repos${p.toString() ? `?${p}` : ""}`);
  },
  getRepo: (owner: string, repo: string) => greq<{ repo: RepoDetail }>(`/github/repos/${enc(owner)}/${enc(repo)}`),
  getReadme: (owner: string, repo: string) => greq<{ readme: string | null }>(`/github/repos/${enc(owner)}/${enc(repo)}/readme`),
  branches: (owner: string, repo: string) => greq<{ branches: BranchLite[] }>(`/github/repos/${enc(owner)}/${enc(repo)}/branches`),
  commits: (owner: string, repo: string, branch?: string) => greq<{ commits: CommitLite[] }>(`/github/repos/${enc(owner)}/${enc(repo)}/commits${branch ? `?branch=${enc(branch)}` : ""}`),
  releases: (owner: string, repo: string) => greq<{ releases: ReleaseLite[] }>(`/github/repos/${enc(owner)}/${enc(repo)}/releases`),
  issues: (owner: string, repo: string, state = "open") => greq<{ issues: IssueLite[] }>(`/github/repos/${enc(owner)}/${enc(repo)}/issues?state=${state}`),
  pulls: (owner: string, repo: string, state = "open") => greq<{ pulls: PullLite[] }>(`/github/repos/${enc(owner)}/${enc(repo)}/pulls?state=${state}`),
  actions: (owner: string, repo: string) => greq<{ runs: WorkflowRunLite[] }>(`/github/repos/${enc(owner)}/${enc(repo)}/actions`),

  owners: () => greq<{ owners: OwnerLite[] }>("/github/owners"),
  nameAvailable: (owner: string, name: string) =>
    greq<{ available: boolean; invalid?: boolean }>(`/github/name-available?owner=${enc(owner)}&name=${enc(name)}`),
  tree: (owner: string, repo: string, branch?: string) =>
    greq<{ entries: { path: string; sha: string }[]; truncated: boolean }>(`/github/repos/${enc(owner)}/${enc(repo)}/tree${branch ? `?branch=${enc(branch)}` : ""}`),

  createRepo: (input: { name: string; description?: string; private?: boolean; autoInit?: boolean; gitignoreTemplate?: string; licenseTemplate?: string; homepage?: string; org?: string }) =>
    greq<{ repo: RepoDetail }>("/github/repos", { method: "POST", body: JSON.stringify(input) }),
  updateRepo: (owner: string, repo: string, patch: { name?: string; description?: string; private?: boolean; defaultBranch?: string; homepage?: string; archived?: boolean }) =>
    greq<{ repo: RepoDetail }>(`/github/repos/${enc(owner)}/${enc(repo)}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteRepo: (owner: string, repo: string, confirm: string) =>
    greq<{ ok: boolean }>(`/github/repos/${enc(owner)}/${enc(repo)}`, { method: "DELETE", body: JSON.stringify({ confirm }) }),
  setTopics: (owner: string, repo: string, topics: string[]) =>
    greq<{ topics: string[] }>(`/github/repos/${enc(owner)}/${enc(repo)}/topics`, { method: "PUT", body: JSON.stringify({ topics }) }),
  pushFiles: (owner: string, repo: string, input: { files: PushFileInput[]; message: string; branch?: string; allowSecrets?: boolean; pullRequest?: { base?: string; title: string; body?: string } }) =>
    greq<{ push: PushResult }>(`/github/repos/${enc(owner)}/${enc(repo)}/push`, { method: "POST", body: JSON.stringify(input) }),
};
