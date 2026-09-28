import { createHash } from "node:crypto";
import { extractReadable, siteNameFromUrl, type LinkArchive } from "@kosh/shared";
import { getStore, type ServerItem } from "../db/index.js";
import { publish } from "../events.js";
import { logger } from "../logger.js";
import { safeFetch } from "../integrations/safe-fetch.js";
import { putIfMissing } from "../storage/objects.js";
import { toClientItem } from "./ingest.js";

const nowIso = () => new Date().toISOString();
const sha256 = (buf: Buffer) => createHash("sha256").update(buf).digest("hex");

/** Minimum readable words for an archive to count as "ok" — below this the page is JS-only / has no article. */
const MIN_WORDS = 40;

/**
 * Build a readable Markdown snapshot from already-fetched HTML and store it in the object store.
 * Returns a LinkArchive describing the result (never throws — a failed extract is recorded, not fatal).
 * `og` supplies fallback title/siteName so the archive matches the card's metadata.
 */
export async function archiveFromHtml(
  userId: string,
  html: string,
  finalUrl: string,
  og?: { title?: string; siteName?: string },
): Promise<LinkArchive> {
  const capturedAt = nowIso();
  try {
    const r = extractReadable(html, finalUrl);
    if (r.wordCount < MIN_WORDS || !r.markdown.trim()) {
      return { status: "failed", capturedAt, finalUrl, error: "No readable article content was found on this page." };
    }
    const buf = Buffer.from(r.markdown, "utf8");
    const objectId = sha256(buf);
    await putIfMissing(userId, objectId, buf, "text/markdown");
    return {
      status: "ok",
      objectId,
      contentType: "text/markdown",
      title: r.title ?? og?.title,
      byline: r.byline,
      excerpt: r.excerpt,
      siteName: r.siteName ?? og?.siteName ?? siteNameFromUrl(finalUrl),
      wordCount: r.wordCount,
      length: buf.length,
      finalUrl,
      capturedAt,
    };
  } catch (err) {
    logger.warn({ err, finalUrl }, "archive extract failed");
    return { status: "failed", capturedAt, finalUrl, error: err instanceof Error ? err.message : "Couldn't archive this page." };
  }
}

/**
 * Fetch a saved link and store a readable snapshot, patching item.archive. Used by the manual
 * (re)archive endpoint; enrichment archives generic web pages inline from the HTML it already fetched.
 */
export async function archiveItem(userId: string, itemId: string): Promise<LinkArchive | null> {
  const store = getStore();
  const item = await store.items.findById(itemId);
  if (!item || item.userId !== userId || item.kind !== "link" || !item.url) return null;
  let archive: LinkArchive;
  try {
    const { body, url: finalUrl } = await safeFetch(item.url, { maxBytes: 2_000_000, timeoutMs: 10_000 });
    archive = await archiveFromHtml(userId, body, finalUrl, { title: item.title, siteName: item.meta?.siteName });
  } catch (err) {
    archive = { status: "failed", capturedAt: nowIso(), error: err instanceof Error ? err.message : "Couldn't reach that page." };
  }
  const updated = await store.items.updateById(itemId, { archive, updatedAt: nowIso() } as Partial<ServerItem>);
  if (updated) publish(userId, { kind: "item.updated", item: toClientItem(updated) }); // strip server-only fields
  return archive;
}
