import { createHash } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { PUBLISH_LIMITS, isValidRepoName, normalizeUrl, scanSecrets } from "@kosh/shared";
import { getStore, type ServerItem } from "../db/index.js";
import { AppError, ah, badRequest, unauthorized } from "../errors.js";
import { requireUser, requireWrite } from "../auth/middleware.js";
import { decryptSecret, encryptSecret } from "../auth/crypto.js";
import { toClientItem } from "../modules/ingest.js";
import { publish as publishEvent } from "../events.js";
import { GithubAuthError, RepoNameTakenError, createRepoWithFiles, deleteRepoWithToken, validateGithubToken } from "../integrations/github.js";

const sha1 = (s: string) => createHash("sha1").update(s).digest("hex");

export const publishRouter: Router = Router();
const nowIso = () => new Date().toISOString();

const fileSchema = z.object({
  path: z.string().min(1).max(400),
  content: z.string(),
  encoding: z.enum(["utf-8", "base64"]).default("utf-8"),
});

const publishSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(350).optional(),
  private: z.boolean().default(true),
  commitMessage: z.string().max(500).optional(),
  files: z.array(fileSchema).min(1).max(PUBLISH_LIMITS.maxFiles),
  token: z.string().min(1).max(500).optional(),
  allowSecrets: z.boolean().default(false),
  source: z.enum(["web", "cli"]).default("web"),
});

/** Decoded byte length of a file's content (base64 → ~3/4 of its char length). */
function byteLen(f: { content: string; encoding: string }): number {
  return f.encoding === "base64" ? Math.floor((f.content.replace(/=+$/, "").length * 3) / 4) : Buffer.byteLength(f.content, "utf8");
}

publishRouter.post(
  "/repos/publish",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const body = publishSchema.parse(req.body);

    if (!isValidRepoName(body.name)) {
      throw badRequest("INVALID_REPO_NAME", "Repository name may only contain letters, numbers, '.', '_' and '-'.");
    }

    // Size guards (inline transport). Bytes must reach GitHub, so we cap the push.
    let total = 0;
    for (const f of body.files) {
      const n = byteLen(f);
      if (n > PUBLISH_LIMITS.maxFileBytes) throw badRequest("FILE_TOO_LARGE", `"${f.path}" is larger than the ${PUBLISH_LIMITS.maxFileBytes / (1024 * 1024)} MB per-file limit.`);
      total += n;
    }
    if (total > PUBLISH_LIMITS.maxTotalBytes) {
      throw badRequest("TOO_LARGE", `This project is larger than the ${PUBLISH_LIMITS.maxTotalBytes / (1024 * 1024)} MB publish limit. Remove large files and try again.`);
    }

    // Secret scan — block unless the caller explicitly confirmed. Don't trust the client's
    // encoding flag: decode base64 files and scan any that are actually text (e.g. ASCII-armored
    // PEM/credential files), so a client can't hide a secret by mislabeling it binary.
    if (!body.allowSecrets) {
      const texts = new Map<string, string>();
      for (const f of body.files) {
        if (f.encoding !== "base64") {
          texts.set(f.path, f.content);
          continue;
        }
        const buf = Buffer.from(f.content, "base64");
        if (!buf.includes(0)) texts.set(f.path, buf.toString("utf8"));
      }
      const scan = scanSecrets(texts);
      if (scan.risky) {
        throw new AppError("SECRETS_FOUND", "Possible secrets found in these files. Review them, then publish again to confirm.", 422, { findings: scan.findings });
      }
    }

    // Resolve a write-capable token: explicit override → the user's stored token → server token.
    const user = await getStore().users.findById(uid);
    const token = body.token ?? decryptSecret(user?.githubToken) ?? undefined;
    if (!token) {
      throw badRequest("NO_GITHUB_TOKEN", "Connect GitHub (or paste a token) with repo access before publishing.");
    }

    let result;
    try {
      result = await createRepoWithFiles(token, {
        name: body.name,
        description: body.description,
        private: body.private,
        files: body.files,
        commitMessage: body.commitMessage,
      });
    } catch (err: unknown) {
      if (err instanceof RepoNameTakenError) throw new AppError("REPO_NAME_TAKEN", err.message, 409);
      if (err instanceof GithubAuthError) throw new AppError("GITHUB_AUTH", err.message, 403);
      throw err;
    }

    // Record the new repo in the vault so it shows up like any saved GitHub repo.
    // Set urlHash the same way ingest does, so a later save of the same URL dedupes to this item.
    const now = nowIso();
    const url = normalizeUrl(result.htmlUrl);
    let item: ServerItem;
    try {
      item = await getStore().items.create({
        userId: uid,
        kind: "link",
        url,
        originalUrl: result.htmlUrl,
        urlHash: sha1(url),
        linkType: "repo",
        title: `${result.owner}/${result.repo}`,
        description: body.description ?? "Published to GitHub from Kosh.",
        tags: ["published"],
        collections: [],
        stage: "to-try",
        source: body.source,
        status: "ready",
        github: {
          owner: result.owner,
          repo: result.repo,
          defaultBranch: result.defaultBranch,
          repoKind: "app",
          install: { source: "none" },
          snapshotPolicy: "manual",
        },
        createdAt: now,
        updatedAt: now,
      } as Omit<ServerItem, "id">);
    } catch (err) {
      // The repo is fully published but we couldn't record it — roll the repo back so a retry
      // with the same name works, rather than leaving an orphan behind.
      await deleteRepoWithToken(token, result.owner, result.repo);
      throw err;
    }

    const clientItem = toClientItem(item);
    publishEvent(uid, { kind: "item.created", item: clientItem });
    res.status(201).json({ item: clientItem, repo: result });
  }),
);

/* ── GitHub token (Personal Access Token) management ─────────── */

publishRouter.get(
  "/settings/github-token",
  ah(async (req, res) => {
    const uid = requireUser(req);
    const user = await getStore().users.findById(uid);
    if (!user) throw unauthorized();
    res.json({ connected: !!user.githubToken });
  }),
);

publishRouter.put(
  "/settings/github-token",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const { token } = z.object({ token: z.string().min(10).max(500) }).parse(req.body);
    const info = await validateGithubToken(token);
    if (!info) throw badRequest("INVALID_TOKEN", "That token didn't work. Check it has repo access and hasn't expired.");
    await getStore().users.updateById(uid, { githubToken: encryptSecret(token) });
    res.json({ connected: true, login: info.login, scopes: info.scopes });
  }),
);

publishRouter.delete(
  "/settings/github-token",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    await getStore().users.updateById(uid, { githubToken: "" });
    res.json({ connected: false });
  }),
);
