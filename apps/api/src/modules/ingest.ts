import { createHash } from "node:crypto";
import { SOURCE_PRIORITY, classifyLink, normalizeUrl, parseGithubRepo, type FoundVia, type Item, type ItemSource } from "@kosh/shared";
import { getStore, type ServerItem } from "../db/index.js";
import { publish } from "../events.js";
import { enqueue } from "./queue.js";
import { enrichItem } from "./enrich.js";

const sha1 = (s: string) => createHash("sha1").update(s).digest("hex");
const nowIso = () => new Date().toISOString();

interface Subpath {
  parentUrl: string;
  subPath: string;
  childLinkType: "repo" | "release" | "issue";
}

/** Detect a GitHub sub-path URL (/tree, /blob, /releases, /issues, /pull, /discussions). (§5.5) */
function parseGithubSubpath(url: string): Subpath | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.hostname !== "github.com") return null;
  const p = u.pathname.split("/").filter(Boolean);
  if (p.length < 3) return null;
  const [owner, repo, kind, ...rest] = p;
  const parentUrl = `https://github.com/${owner}/${repo}`;
  if (kind === "tree" || kind === "blob") {
    const path = rest.slice(1); // drop the branch segment
    const subPath = kind === "blob" ? path.slice(0, -1).join("/") : path.join("/");
    return { parentUrl, subPath: subPath || "/", childLinkType: "repo" };
  }
  if (kind === "releases") return { parentUrl, subPath: rest.join("/") || "releases", childLinkType: "release" };
  if (["issues", "pull", "discussions"].includes(kind ?? "")) return { parentUrl, subPath: `${kind}/${rest.join("/")}`, childLinkType: "issue" };
  return null;
}

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

  // GitHub sub-path → save the repo card (parent) + a child card. (§5.5)
  const sub = parseGithubSubpath(url);
  if (sub) {
    const parent = await ingest(userId, sub.parentUrl, opts);
    const childHash = sha1(url);
    const existingChild = await store.items.findOne({ userId, urlHash: childHash, deletedAt: null });
    if (existingChild) return { item: existingChild, duplicate: true };
    const repo = parseGithubRepo(sub.parentUrl);
    const now = nowIso();
    const child = await store.items.create({
      userId,
      kind: "link",
      url,
      originalUrl: rawUrl,
      urlHash: childHash,
      linkType: sub.childLinkType,
      parentItemId: parent.item.id,
      subPath: sub.subPath,
      title: repo ? `${repo.owner}/${repo.repo} · ${sub.subPath}` : sub.subPath,
      tags: opts.tags ?? [],
      collections: opts.collectionIds ?? [],
      stage: "to-try",
      source: opts.source ?? "web",
      status: "ready",
      note: opts.note,
      foundVia: opts.foundVia,
      meta: { siteName: "GitHub" },
      createdAt: now,
      updatedAt: now,
    } as Omit<ServerItem, "id">);
    publish(userId, { kind: "item.created", item: child });
    return { item: child, duplicate: false };
  }

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
