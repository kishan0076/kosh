import { parseGithubRepo, siteNameFromUrl, type Item } from "@kosh/shared";
import { getStore, type ServerItem } from "../db/index.js";
import { publish } from "../events.js";
import { logger } from "../logger.js";
import { enrichGithub } from "../integrations/github.js";
import { fetchOpenGraph } from "../integrations/opengraph.js";
import { lookupPackage, parsePackageUrl } from "../integrations/registries.js";
import { summarize } from "../integrations/claude.js";

const nowIso = () => new Date().toISOString();

/** Compute an enrichment patch for a link item (routes by link type). */
async function computePatch(item: ServerItem, token: string | null): Promise<Partial<Item>> {
  const url = item.url!;

  // GitHub repo / issue / release
  const repo = ["repo", "issue", "release"].includes(item.linkType ?? "") ? parseGithubRepo(url) : null;
  if (repo) {
    const r = await enrichGithub(repo.owner, repo.repo, { token, prevSkillIndex: item.github?.skillIndex });
    if (!r.ok) {
      return { status: "dead", title: item.title ?? `${repo.owner}/${repo.repo}`, meta: { siteName: "GitHub" } };
    }
    const ai = await summarize({ title: r.data.title, url, text: r.data.readme || r.data.description || "", existingTags: item.tags });
    return {
      status: "ready",
      title: r.data.title,
      description: r.data.description,
      github: { ...r.data.github, readme: r.data.readme || undefined },
      meta: { siteName: "GitHub", image: undefined, favicon: "https://github.com/favicon.ico" },
      ai: ai ?? undefined,
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
    const ai = await summarize({ title: og.title, url, text: og.description || og.title || "", existingTags: item.tags });
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
  const patch = await computePatch(item, user?.githubToken ?? null);
  const updated = await store.items.updateById(itemId, { ...patch, updatedAt: nowIso() } as Partial<ServerItem>);
  if (updated) publish(userId, { kind: "item.updated", item: updated });
}
