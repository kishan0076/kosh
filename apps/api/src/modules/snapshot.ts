import mime from "mime-types";
import type { GithubEnrichment } from "../integrations/github.js";
import { githubClient } from "../integrations/github.js";
import { getStore, type ServerItem } from "../db/index.js";
import { logger } from "../logger.js";
import { createSkillVersion, type IncomingFile } from "./skills.js";

const TEXT_RE = /\.(md|mdx|txt|json|ya?ml|toml|csv|py|js|ts|tsx|jsx|sh|ps1|rb|go|rs|sql|html|css|svg)$/i;
const mimeOf = (p: string) => (mime.lookup(p) || "application/octet-stream").toString();

/** Copy skill folders from a repo into the user's vault. (§6.4)
 *  Runs for the dirs the snapshot policy allows; skips dirs whose git sha is unchanged. */
export async function snapshotRepoSkills(item: ServerItem, data: GithubEnrichment, opts: { token?: string | null; dirs?: string[] } = {}): Promise<number> {
  const g = data.github;
  if (!g.owner || !g.repo) return 0;
  const skillDirs = g.skillDirs ?? [];
  const policy = g.snapshotPolicy ?? "auto";
  const wanted =
    opts.dirs ??
    (policy === "all"
      ? skillDirs
      : policy === "auto" && skillDirs.length > 0 && skillDirs.length <= 10
        ? skillDirs
        : (g.skillIndex ?? []).filter((s) => s.snapshotted).map((s) => s.path));
  if (!wanted.length) return 0;

  const gh = githubClient(opts.token);
  const store = getStore();
  let copied = 0;

  for (const dir of wanted) {
    try {
      const dirSha = dir === "" ? g.treeSha : data.tree.find((t) => t.type === "tree" && t.path === dir.replace(/\/$/, ""))?.sha;
      const existing = await store.skills.findOne({ userId: item.userId, "source.itemId": item.id, "source.path": dir, deletedAt: null });
      if (existing && existing.origin !== "repo") continue; // user took it over
      if (existing && existing.source?.dirSha === dirSha) continue; // unchanged

      const blobs = data.tree.filter((t) => t.type === "blob" && t.path.startsWith(dir) && (t.size ?? 0) < 5_000_000);
      const files: IncomingFile[] = [];
      for (const b of blobs) {
        const res = await gh.rest.git.getBlob({ owner: g.owner, repo: g.repo, file_sha: b.sha! });
        const buf = Buffer.from(res.data.content, (res.data.encoding as BufferEncoding) ?? "base64");
        const rel = b.path.slice(dir.length);
        files.push(TEXT_RE.test(rel) ? { path: rel, mime: mimeOf(rel), content: buf.toString("utf8") } : { path: rel, mime: mimeOf(rel), bytesBase64: buf.toString("base64") });
      }
      if (!files.some((f) => /^SKILL\.md$/i.test(f.path))) continue;

      const name = dir === "" ? g.repo : dir.replace(/\/$/, "").split("/").pop()!;
      await createSkillVersion(item.userId, files, {
        origin: "repo",
        itemSource: "snapshot",
        name,
        license: g.license,
        trust: "unreviewed",
        note: `Snapshot of ${g.owner}/${g.repo}@${dirSha?.slice(0, 7) ?? "HEAD"}`,
        source: { itemId: item.id, owner: g.owner, repo: g.repo, path: dir, dirSha },
        foundVia: { kind: "list", label: `${g.owner}/${g.repo}`, itemId: item.id },
      });
      copied++;
    } catch (err) {
      logger.warn({ err, dir, repo: `${g.owner}/${g.repo}` }, "snapshot dir failed");
    }
  }

  if (copied) {
    // mark index entries copied + bump the repo card's copiedCount
    const fresh = await store.items.findById(item.id);
    if (fresh?.github?.skillIndex) {
      const skillIndex = fresh.github.skillIndex.map((s) => (wanted.includes(s.path) ? { ...s, snapshotted: true } : s));
      await store.items.updateById(item.id, { github: { ...fresh.github, skillIndex, copiedCount: skillIndex.filter((s) => s.snapshotted).length } });
    }
    logger.info({ copied, repo: `${g.owner}/${g.repo}` }, "snapshot complete");
  }
  return copied;
}
