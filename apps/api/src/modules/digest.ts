import type { Item } from "@kosh/shared";
import { getStore } from "../db/index.js";
import { publish } from "../events.js";
import { toClientItem } from "./ingest.js";

/**
 * Digest — a periodic "what's new" + activity review over a user's vault. Two halves:
 *  • Watched repos that gained new links/skills since you last cleared them (from enrichment's watch diff).
 *  • Your own activity in the window: saved / enriched counts, dead links, backlog, top tags, recent items.
 * Purely computed from the store (no AI, no network) so it's cheap and deterministic. Delivered in-app;
 * the same shape could later feed the Telegram bot or the email worker.
 */

const DAY_MS = 86_400_000;

export interface WatchDigestEntry {
  itemId: string;
  title: string;
  url?: string;
  newSince: number;
  lastCheckedAt?: string;
}

export interface Digest {
  days: number;
  since: string; // ISO cutoff
  savedCount: number; // items created in the window
  enrichedCount: number; // of those, how many have an AI summary
  deadCount: number; // links currently flagged dead (all-time)
  toTryCount: number; // current to-try backlog (all-time)
  usingCount: number; // current "using" count (all-time)
  topTags: { tag: string; count: number }[]; // most common tags among newly-saved items
  recent: Item[]; // newest saved items in the window (client shape)
  watched: WatchDigestEntry[]; // watched repos with unseen changes, busiest first
  watchedNewTotal: number;
}

export async function buildDigest(userId: string, opts: { days?: number } = {}): Promise<Digest> {
  const store = getStore();
  const days = Math.min(Math.max(Math.floor(opts.days ?? 7), 1), 90);
  const since = new Date(Date.now() - days * DAY_MS).toISOString();
  const all = await store.items.find({ userId, deletedAt: null });

  const savedSince = all.filter((i) => i.createdAt >= since);
  const tagCounts = new Map<string, number>();
  for (const i of savedSince) for (const t of i.tags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
  const topTags = [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 8)
    .map(([tag, count]) => ({ tag, count }));

  const watched: WatchDigestEntry[] = all
    .filter((i) => i.github?.watch?.enabled && (i.github.watch.newSince ?? 0) > 0)
    .map((i) => ({
      itemId: i.id,
      title: i.title ?? `${i.github?.owner ?? ""}/${i.github?.repo ?? ""}`.replace(/^\/$/, "Untitled"),
      url: i.url,
      newSince: i.github!.watch!.newSince ?? 0,
      lastCheckedAt: i.github?.watch?.lastCheckedAt,
    }))
    .sort((a, b) => b.newSince - a.newSince);

  return {
    days,
    since,
    savedCount: savedSince.length,
    enrichedCount: savedSince.filter((i) => i.ai?.summary).length,
    deadCount: all.filter((i) => i.status === "dead").length,
    toTryCount: all.filter((i) => i.stage === "to-try").length,
    usingCount: all.filter((i) => i.stage === "using").length,
    topTags,
    recent: [...savedSince].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 8).map(toClientItem),
    watched,
    watchedNewTotal: watched.reduce((n, w) => n + w.newSince, 0),
  };
}

/** Clear the "unseen changes" counter on every watched repo (the digest's "mark all seen"). Returns count. */
export async function markWatchedSeen(userId: string): Promise<number> {
  const store = getStore();
  const items = await store.items.find({ userId, deletedAt: null });
  let cleared = 0;
  for (const i of items) {
    const w = i.github?.watch;
    if (i.github && w?.enabled && (w.newSince ?? 0) > 0) {
      const updated = await store.items.updateById(i.id, { github: { ...i.github, watch: { ...w, newSince: 0 } } });
      if (updated) publish(userId, { kind: "item.updated", item: toClientItem(updated) }); // clears the live badge
      cleared++;
    }
  }
  return cleared;
}
