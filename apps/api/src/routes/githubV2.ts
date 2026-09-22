import { Router, type Request } from "express";
import { z } from "zod";
import { PUBLISH_LIMITS, scanSecrets, isValidRepoName } from "@kosh/shared";
import { getStore } from "../db/index.js";
import { AppError, ah, badRequest, notFound } from "../errors.js";
import { requireUser, requireWrite } from "../auth/middleware.js";
import { decryptSecret } from "../auth/crypto.js";
import { GithubAuthError, RepoNameTakenError } from "../integrations/github.js";
import {
  commitFiles,
  createRepo,
  deleteRepo,
  getFileContent,
  getReadmeMarkdown,
  getRepoDetail,
  getRepoTree,
  listBranches,
  listCommits,
  listIssues,
  listOwners,
  listPulls,
  listReleases,
  listRepos,
  listWorkflowRuns,
  repoNameAvailable,
  setTopics,
  updateRepo,
  type RepoSort,
} from "../integrations/githubManage.js";

/**
 * GitHub "V2" module API — a full repo manager over the user's connected token: list/inspect repos,
 * read branches/commits/releases/issues/PRs/Actions, and create/edit/delete/push. Every call resolves
 * the caller's stored token (never trusts one from the client). Octokit errors are mapped to typed
 * envelopes so the client can prompt a reconnect, show a rate-limit notice, etc.
 */
export const githubV2Router: Router = Router();

/** Resolve the caller's write-capable GitHub token, or fail with a reconnect-shaped error. */
async function requireGithubToken(uid: string): Promise<string> {
  const user = await getStore().users.findById(uid);
  const token = decryptSecret(user?.githubToken);
  if (!token) throw badRequest("NEEDS_CONNECT", "Connect GitHub to manage your repositories.");
  return token;
}

/** Map an Octokit/status error to a typed API envelope. */
function mapGithubError(err: unknown): never {
  if (err instanceof RepoNameTakenError) throw new AppError("REPO_NAME_TAKEN", err.message, 409);
  if (err instanceof GithubAuthError) throw new AppError("GITHUB_AUTH", err.message, 403);
  const status = (err as { status?: number }).status;
  const message = (err as { message?: string }).message ?? "GitHub request failed.";
  if (status === 401) throw badRequest("NEEDS_RECONNECT", "Your GitHub connection is invalid or expired. Reconnect GitHub.");
  if (status === 429) throw new AppError("RATE_LIMITED", "GitHub's rate limit was hit. Try again shortly.", 429);
  if (status === 403) {
    if (/rate limit/i.test(message)) throw new AppError("RATE_LIMITED", "GitHub's rate limit was hit. Try again shortly.", 429);
    throw new AppError("FORBIDDEN", "Your GitHub token doesn't have permission for that action.", 403);
  }
  if (status === 404) throw notFound("That repository wasn't found (or your token can't see it).");
  if (status === 409) throw new AppError("CONFLICT", message || "That request conflicts with the repository's current state.", 409);
  if (status === 422) throw new AppError("VALIDATION", message, 422);
  throw err;
}

/** Run a management call, mapping its errors. */
async function ghCall<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (err) {
    mapGithubError(err);
  }
}

const ownerRepo = (req: Request): { owner: string; repo: string } => ({ owner: String(req.params.owner), repo: String(req.params.repo) });

/* ── list + detail ── */

githubV2Router.get(
  "/github/repos",
  ah(async (req, res) => {
    const uid = requireUser(req);
    const token = await requireGithubToken(uid);
    const q = z
      .object({
        page: z.coerce.number().int().min(1).max(50).default(1),
        perPage: z.coerce.number().int().min(1).max(100).default(100),
        sort: z.enum(["updated", "pushed", "created", "full_name"]).default("pushed"),
      })
      .parse(req.query);
    res.json(await ghCall(listRepos(token, { page: q.page, perPage: q.perPage, sort: q.sort as RepoSort })));
  }),
);

// Possible owners for a new repo (the authed user + orgs). Placed before "/github/repos/:owner/:repo"
// so the static segments win react-router-style ordering isn't relevant on the server, but keep it tidy.
githubV2Router.get(
  "/github/owners",
  ah(async (req, res) => {
    const uid = requireUser(req);
    const token = await requireGithubToken(uid);
    res.json({ owners: await ghCall(listOwners(token)) });
  }),
);

// Is a repo name free for a given owner? (debounced availability check on the New Repository page)
githubV2Router.get(
  "/github/name-available",
  ah(async (req, res) => {
    const uid = requireUser(req);
    const token = await requireGithubToken(uid);
    const q = z.object({ owner: z.string().min(1).max(120), name: z.string().min(1).max(100) }).parse(req.query);
    if (!isValidRepoName(q.name)) return res.json({ available: false, invalid: true });
    res.json({ available: await ghCall(repoNameAvailable(token, q.owner, q.name)) });
  }),
);

githubV2Router.get(
  "/github/repos/:owner/:repo",
  ah(async (req, res) => {
    const uid = requireUser(req);
    const token = await requireGithubToken(uid);
    const { owner, repo } = ownerRepo(req);
    res.json({ repo: await ghCall(getRepoDetail(token, owner, repo)) });
  }),
);

// Existing blob paths on a branch — the base for the upload dry-run diff.
githubV2Router.get(
  "/github/repos/:owner/:repo/tree",
  ah(async (req, res) => {
    const uid = requireUser(req);
    const token = await requireGithubToken(uid);
    const { owner, repo } = ownerRepo(req);
    const branch = typeof req.query.branch === "string" ? req.query.branch : undefined;
    res.json(await ghCall(getRepoTree(token, owner, repo, branch)));
  }),
);

githubV2Router.get(
  "/github/repos/:owner/:repo/readme",
  ah(async (req, res) => {
    const uid = requireUser(req);
    const token = await requireGithubToken(uid);
    const { owner, repo } = ownerRepo(req);
    res.json({ readme: await ghCall(getReadmeMarkdown(token, owner, repo)) });
  }),
);

githubV2Router.get(
  "/github/repos/:owner/:repo/content",
  ah(async (req, res) => {
    const uid = requireUser(req);
    const token = await requireGithubToken(uid);
    const { owner, repo } = ownerRepo(req);
    const q = z.object({ path: z.string().min(1).max(400), branch: z.string().max(255).optional() }).parse(req.query);
    res.json(await ghCall(getFileContent(token, owner, repo, q.path, q.branch)));
  }),
);

githubV2Router.get(
  "/github/repos/:owner/:repo/branches",
  ah(async (req, res) => {
    const uid = requireUser(req);
    const token = await requireGithubToken(uid);
    const { owner, repo } = ownerRepo(req);
    res.json({ branches: await ghCall(listBranches(token, owner, repo)) });
  }),
);

githubV2Router.get(
  "/github/repos/:owner/:repo/commits",
  ah(async (req, res) => {
    const uid = requireUser(req);
    const token = await requireGithubToken(uid);
    const { owner, repo } = ownerRepo(req);
    const sha = typeof req.query.branch === "string" ? req.query.branch : undefined;
    res.json({ commits: await ghCall(listCommits(token, owner, repo, { perPage: 30, sha })) });
  }),
);

githubV2Router.get(
  "/github/repos/:owner/:repo/releases",
  ah(async (req, res) => {
    const uid = requireUser(req);
    const token = await requireGithubToken(uid);
    const { owner, repo } = ownerRepo(req);
    res.json({ releases: await ghCall(listReleases(token, owner, repo)) });
  }),
);

githubV2Router.get(
  "/github/repos/:owner/:repo/issues",
  ah(async (req, res) => {
    const uid = requireUser(req);
    const token = await requireGithubToken(uid);
    const { owner, repo } = ownerRepo(req);
    const state = req.query.state === "closed" || req.query.state === "all" ? req.query.state : "open";
    res.json({ issues: await ghCall(listIssues(token, owner, repo, { state })) });
  }),
);

githubV2Router.get(
  "/github/repos/:owner/:repo/pulls",
  ah(async (req, res) => {
    const uid = requireUser(req);
    const token = await requireGithubToken(uid);
    const { owner, repo } = ownerRepo(req);
    const state = req.query.state === "closed" || req.query.state === "all" ? req.query.state : "open";
    res.json({ pulls: await ghCall(listPulls(token, owner, repo, { state })) });
  }),
);

githubV2Router.get(
  "/github/repos/:owner/:repo/actions",
  ah(async (req, res) => {
    const uid = requireUser(req);
    const token = await requireGithubToken(uid);
    const { owner, repo } = ownerRepo(req);
    res.json({ runs: await ghCall(listWorkflowRuns(token, owner, repo)) });
  }),
);

/* ── mutations ── */

githubV2Router.post(
  "/github/repos",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const token = await requireGithubToken(uid);
    const body = z
      .object({
        name: z.string().min(1).max(100),
        description: z.string().max(350).optional(),
        private: z.boolean().default(true),
        autoInit: z.boolean().default(true),
        gitignoreTemplate: z.string().max(60).optional(),
        licenseTemplate: z.string().max(60).optional(),
        homepage: z.string().max(500).optional(),
        org: z.string().max(120).optional(),
      })
      .parse(req.body);
    if (!isValidRepoName(body.name)) throw badRequest("INVALID_REPO_NAME", "Repository name may only contain letters, numbers, '.', '_' and '-'.");
    res.status(201).json({ repo: await ghCall(createRepo(token, body)) });
  }),
);

githubV2Router.patch(
  "/github/repos/:owner/:repo",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const token = await requireGithubToken(uid);
    const { owner, repo } = ownerRepo(req);
    const patch = z
      .object({
        name: z.string().min(1).max(100).optional(),
        description: z.string().max(350).optional(),
        private: z.boolean().optional(),
        defaultBranch: z.string().max(255).optional(),
        homepage: z.string().max(500).optional(),
        archived: z.boolean().optional(),
      })
      .parse(req.body);
    if (patch.name !== undefined && !isValidRepoName(patch.name)) throw badRequest("INVALID_REPO_NAME", "Repository name may only contain letters, numbers, '.', '_' and '-'.");
    res.json({ repo: await ghCall(updateRepo(token, owner, repo, patch)) });
  }),
);

githubV2Router.delete(
  "/github/repos/:owner/:repo",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const token = await requireGithubToken(uid);
    const { owner, repo } = ownerRepo(req);
    // Type-to-confirm: the client must echo "owner/repo" so a mis-click can't nuke a repo.
    const { confirm } = z.object({ confirm: z.string() }).parse(req.body ?? {});
    if (confirm !== `${owner}/${repo}`) throw badRequest("CONFIRM_MISMATCH", `Type "${owner}/${repo}" to confirm deletion.`);
    await ghCall(deleteRepo(token, owner, repo));
    res.json({ ok: true });
  }),
);

githubV2Router.put(
  "/github/repos/:owner/:repo/topics",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const token = await requireGithubToken(uid);
    const { owner, repo } = ownerRepo(req);
    const { topics } = z.object({ topics: z.array(z.string().max(50)).max(20) }).parse(req.body);
    res.json({ topics: await ghCall(setTopics(token, owner, repo, topics)) });
  }),
);

const pushFileSchema = z.object({
  path: z.string().min(1).max(400),
  content: z.string(),
  encoding: z.enum(["utf-8", "base64"]).default("utf-8"),
});

githubV2Router.post(
  "/github/repos/:owner/:repo/push",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const token = await requireGithubToken(uid);
    const { owner, repo } = ownerRepo(req);
    const body = z
      .object({
        files: z.array(pushFileSchema).min(1).max(PUBLISH_LIMITS.maxFiles),
        message: z.string().min(1).max(500).default("Update from Kosh"),
        branch: z.string().max(255).optional(),
        allowSecrets: z.boolean().default(false),
        pullRequest: z
          .object({
            base: z.string().max(255).optional(),
            title: z.string().min(1).max(255),
            body: z.string().max(10000).optional(),
          })
          .optional(),
      })
      .parse(req.body);

    // Size guard (inline transport, same as publish).
    let total = 0;
    for (const f of body.files) {
      const n = f.encoding === "base64" ? Math.floor((f.content.replace(/=+$/, "").length * 3) / 4) : Buffer.byteLength(f.content, "utf8");
      if (n > PUBLISH_LIMITS.maxFileBytes) throw badRequest("FILE_TOO_LARGE", `"${f.path}" exceeds the ${PUBLISH_LIMITS.maxFileBytes / (1024 * 1024)} MB per-file limit.`);
      total += n;
    }
    if (total > PUBLISH_LIMITS.maxTotalBytes) throw badRequest("TOO_LARGE", `This push is larger than the ${PUBLISH_LIMITS.maxTotalBytes / (1024 * 1024)} MB limit.`);

    // Secret scan — block unless explicitly confirmed. Decode base64 text files so a mislabeled binary
    // can't smuggle a credential past the scan.
    if (!body.allowSecrets) {
      const texts = new Map<string, string>();
      for (const f of body.files) {
        if (f.encoding !== "base64") { texts.set(f.path, f.content); continue; }
        const buf = Buffer.from(f.content, "base64");
        if (!buf.includes(0)) texts.set(f.path, buf.toString("utf8"));
      }
      const scan = scanSecrets(texts);
      if (scan.risky) throw new AppError("SECRETS_FOUND", "Possible secrets found in these files. Review them, then push again to confirm.", 422, { findings: scan.findings });
    }

    res.status(201).json({ push: await ghCall(commitFiles(token, owner, repo, { files: body.files, message: body.message, branch: body.branch, pullRequest: body.pullRequest })) });
  }),
);
