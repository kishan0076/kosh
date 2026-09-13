import { createHash } from "node:crypto";
import { SOURCE_PRIORITY, classifyLink, normalizeUrl, type FoundVia, type Item, type ItemSource } from "@kosh/shared";
import { getStore, type ServerItem } from "../db/index.js";
import { publish } from "../events.js";
import { enqueue } from "./queue.js";
import { enrichItem } from "./enrich.js";

const sha1 = (s: string) => createHash("sha1").update(s).digest("hex");
const nowIso = () => new Date().toISOString();

export interface IngestOpts {
  source?: ItemSource;
  note?: string;
  tags?: string[];
  collectionIds?: string[];
  foundVia?: FoundVia;
}

/** Normalize → dedupe → create the link card → enqueue enrichment. (§5.2)
 *  The card is saved before any enrichment runs; nothing downstream blocks the save. */
export async function ingest(userId: string, rawUrl: string, opts: IngestOpts = {}): Promise<{ item: ServerItem; duplicate: boolean }> {
  const store = getStore();
  const url = normalizeUrl(rawUrl);
  const urlHash = sha1(url);

  const existing = await store.items.findOne({ userId, urlHash, deletedAt: null });
  if (existing) return { item: existing, duplicate: true };

  const now = nowIso();
  const item = await store.items.create({
    userId,
    kind: "link",
    url,
    originalUrl: rawUrl,
    urlHash,
    linkType: classifyLink(url),
    title: new URL(url).hostname.replace(/^www\./, ""),
    tags: opts.tags ?? [],
    collections: opts.collectionIds ?? [],
    stage: "to-try",
    source: opts.source ?? "web",
    status: "enriching",
    note: opts.note,
    foundVia: opts.foundVia,
    createdAt: now,
    updatedAt: now,
  } as Omit<ServerItem, "id">);

  publish(userId, { kind: "item.created", item });
  const priority = SOURCE_PRIORITY[opts.source ?? "web"] ?? 5;
  enqueue(`enrich:${item.id}`, () => enrichItem(userId, item.id), priority);

  return { item, duplicate: false };
}

export function toClientItem(item: ServerItem): Item {
  const { userId: _userId, urlHash: _urlHash, ...rest } = item;
  return rest;
}
