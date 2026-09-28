import type { ItemStatus } from "@kosh/shared";
import { getStore, type ServerItem } from "../db/index.js";
import { safeFetch } from "../integrations/safe-fetch.js";
import { publish } from "../events.js";
import { toClientItem } from "./ingest.js";
import { logger } from "../logger.js";

/**
 * Link-rot monitor — re-fetch a saved link through the SSRF guard and flip its status between "ready" and
 * "dead" so a rotted link is visible (and its archived snapshot, if any, can stand in). Only manages the
 * ready↔dead pair; "enriching" (in-flight) and "archived" (deliberately frozen) items are left alone.
 */

const nowIso = () => new Date().toISOString();

/** The status a link should take after a check. Only ready↔dead is managed here — an "enriching" (in-flight)
 *  or "archived" (deliberately frozen) item is never clobbered by a health check. Pure. */
export function nextLinkStatus(prev: ItemStatus, ok: boolean): ItemStatus {
  if (prev === "ready" || prev === "dead") return ok ? "ready" : "dead";
  return prev;
}

export interface LinkCheckResult {
  itemId: string;
  ok: boolean;
  status?: number; // HTTP status when a response came back
  changed: boolean; // did ready↔dead flip
  dead: boolean; // the item's status is now "dead"
  archived: boolean; // a readable archive is available as a fallback
}

/** Check one saved link. Returns null for a non-link / foreign / url-less item. Never throws for a dead link. */
export async function checkLink(userId: string, itemId: string): Promise<LinkCheckResult | null> {
  const store = getStore();
  const item = await store.items.findById(itemId);
  if (!item || item.userId !== userId || item.kind !== "link" || !item.url) return null;

  let ok = false;
  let status: number | undefined;
  try {
    // A small ranged GET is enough to prove the page still resolves; the SSRF guard applies as always.
    const r = await safeFetch(item.url, { maxBytes: 65_536, timeoutMs: 10_000 });
    status = r.status;
    ok = r.status < 400;
  } catch (err) {
    logger.info({ err, itemId, url: item.url }, "link check: unreachable");
    ok = false;
  }

  const prev = item.status;
  const nextStatus = nextLinkStatus(prev, ok);
  const changed = nextStatus !== prev;
  const patch: Partial<ServerItem> = { lastCheckedAt: nowIso() };
  if (changed) patch.status = nextStatus;
  const updated = await store.items.updateById(itemId, patch);
  if (updated && changed) publish(userId, { kind: "item.updated", item: toClientItem(updated) });

  return { itemId, ok, status, changed, dead: nextStatus === "dead", archived: item.archive?.status === "ok" };
}

export interface BulkCheckSummary {
  checked: number;
  ok: number;
  dead: number; // currently failing
  healed: number; // flipped dead → ready this run
}

/** Check all of a user's saved links (bounded), with small concurrency so we don't hammer hosts. */
export async function checkAllLinks(userId: string, opts: { limit?: number } = {}): Promise<BulkCheckSummary> {
  const store = getStore();
  const links = (await store.items.find({ userId, kind: "link", deletedAt: null })).filter((i) => i.url && i.status !== "archived");
  const slice = links.slice(0, Math.min(opts.limit ?? 100, 200));
  const summary: BulkCheckSummary = { checked: 0, ok: 0, dead: 0, healed: 0 };
  const CONCURRENCY = 5;
  for (let i = 0; i < slice.length; i += CONCURRENCY) {
    const results = await Promise.all(slice.slice(i, i + CONCURRENCY).map((it) => checkLink(userId, it.id).catch(() => null)));
    for (const r of results) {
      if (!r) continue;
      summary.checked++;
      if (r.ok) summary.ok++;
      else summary.dead++;
      if (r.changed && r.ok) summary.healed++;
    }
  }
  return summary;
}
