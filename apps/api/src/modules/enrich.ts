import { createHash } from "node:crypto";
import { parseGithubRepo, siteNameFromUrl, type GithubMeta, type Item, type WatchInfo } from "@kosh/shared";
import { getStore, type ServerItem } from "../db/index.js";
import { publish } from "../events.js";
import { logger } from "../logger.js";
import { enrichGithub, type GithubEnrichment } from "../integrations/github.js";
import { decryptSecret } from "../auth/crypto.js";
import { fetchOpenGraph } from "../integrations/opengraph.js";
import { lookupPackage, parsePackageUrl } from "../integrations/registries.js";
import { summarizeForUser } from "../integrations/claude.js";

const nowIso = () => new Date().toISOString();
const sha1 = (s: string) => createHash("sha1").update(s).digest("hex");

/** Extract distinct GitHub links from README markdown. */
function githubLinks(readme: string): string[] {
  const set = new Set<string>();
  const re = /https?:\/\/github\.com\/[\w.-]+\/[\w.-]+/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(readme))) set.add(m[0].replace(/[).,]+$/, ""));
  return [...set];
}

/** Diff a watched repo's current state against last-seen to compute "N new". (§5.7) */
function computeWatch(prev: WatchInfo | undefined, data: GithubEnrichment): WatchInfo | undefined {
  if (!prev?.enabled) return prev;
  const skillPaths = (data.github.skillIndex ?? []).map((s) => s.path);
  const linkHashes = data.github.repoKind === "awesome-list" ? githubLinks(data.readme).map(sha1) : [];
  const firstRun = prev.lastSkillPaths === undefined && prev.lastLinkHashes === undefined;
  const newSkills = prev.lastSkillPaths ? skillPaths.filter((p) => !prev.lastSkillPaths!.includes(p)).length : 0;
  const newLinks = prev.lastLinkHashes ? linkHashes.filter((h) => !prev.lastLinkHashes!.includes(h)).length : 0;
  return {
    enabled: true,
    lastCheckedAt: nowIso(),
    newSince: firstRun ? 0 : (prev.newSince ?? 0) + newSkills + newLinks,
    lastSkillPaths: skillPaths,
    lastLinkHashes: linkHashes,
  };
}

/** Compute an enrichment patch for a link item (routes by link type). */
async function computePatch(item: ServerItem, token: string | null): Promise<Partial<Item>> {
  const url = item.url!;

  // GitHub repo / issue / release
  const repo = ["repo", "issue", "release"].includes(item.linkType ?? "") ? parseGithubRepo(url) : null;
  if (repo) {
    const r = await enrichGithub(repo.owner, repo.repo, { token, prevSkillIndex: item.github?.skillIndex, etag: item.github?.etag });
    if ("unchanged" in r && r.unchanged) {
      // 304 — nothing changed upstream; refresh cost no budget.
      return { status: "ready", lastCheckedAt: nowIso(), github: item.github ? { ...item.github, watch: item.github.watch ? { ...item.github.watch, lastCheckedAt: nowIso() } : undefined } : undefined };
    }
    if (!r.ok) {
      return { status: "dead", title: item.title ?? `${repo.owner}/${repo.repo}`, meta: { siteName: "GitHub" } };
    }
    if (r.data.budget) await getStore().users.updateById(item.userId, { githubBudget: r.data.budget });
    const watch = computeWatch(item.github?.watch, r.data);
    const github: GithubMeta = { ...r.data.github, readme: r.data.readme || undefined, watch, snapshotPolicy: item.github?.snapshotPolicy ?? r.data.github.snapshotPolicy };
    const ai = await summarizeForUser(item.userId, { title: r.data.title, url, text: r.data.readme || r.data.description || "", existingTags: item.tags });
    // auto-snapshot small skills repos (§6.4) in the background — honour the user's
    // stored snapshotPolicy and authenticate with their token (private repos, higher rate limit).
    const snapData = { ...r.data, github: { ...r.data.github, snapshotPolicy: github.snapshotPolicy } };
    import("./snapshot.js").then(({ snapshotRepoSkills }) => snapshotRepoSkills(item, snapData, { token })).catch(() => {});
    return {
      status: "ready",
      title: r.data.title,
      description: r.data.description,
      github,
      meta: { siteName: "GitHub", image: undefined, favicon: "https://github.com/favicon.ico" },
      ai: ai ?? undefined,
      lastCheckedAt: nowIso(),
    };
  }

  // Package pages → registry lookup (+ link its repo)
  const pkg = item.linkType === "package" ? parsePackageUrl(url) : null;
  if (pkg) {
    const info = await lookupPackage(pkg.registry, pkg.name);
    if (info.repoUrl) {
      // fire-and-forget: ingest the source repo too (deduped)
      import("./ingest.js").then(({ ingest }) => ingest(item.userId, info.repoUrl!, { source: "snapshot" })).catch(() => {});
    }
    return {
      status: "ready",
      title: pkg.name,
      description: item.description,
      package: { registry: pkg.registry, name: pkg.name, version: info.version, repoUrl: info.repoUrl },
      meta: { siteName: pkg.registry },
    };
  }

  // Everything else → Open Graph
  try {
    const og = await fetchOpenGraph(url);
    const ai = await summarizeForUser(item.userId, { title: og.title, url, text: og.description || og.title || "", existingTags: item.tags });
    return {
      status: "ready",
      title: og.title ?? item.title ?? siteNameFromUrl(url),
      description: og.description ?? item.description,
      meta: { siteName: og.siteName ?? siteNameFromUrl(url), image: og.image },
      ai: ai ?? undefined,
    };
  } catch (err) {
    logger.warn({ err, url }, "opengraph failed");
    return { status: "ready", title: item.title ?? siteNameFromUrl(url), meta: { siteName: siteNameFromUrl(url) } };
  }
}

/** Enrich a saved link item and push the update over SSE. */
export async function enrichItem(userId: string, itemId: string): Promise<void> {
  const store = getStore();
  const item = await store.items.findById(itemId);
  if (!item || item.kind !== "link" || !item.url) return;
  const user = await store.users.findById(userId);
  const patch = await computePatch(item, decryptSecret(user?.githubToken) ?? null);
  const updated = await store.items.updateById(itemId, { ...patch, updatedAt: nowIso() } as Partial<ServerItem>);
  if (updated) publish(userId, { kind: "item.updated", item: updated });
}
