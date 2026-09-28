import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { STAGES, searchItems, type ItemSource } from "@kosh/shared";
import { getStore, type ServerItem } from "../db/index.js";
import { ah, notFound } from "../errors.js";
import { requireUser, requireWrite } from "../auth/middleware.js";
import { ingest, toClientItem } from "../modules/ingest.js";
import { enqueue } from "../modules/queue.js";
import { enrichItem } from "../modules/enrich.js";
import { archiveItem } from "../modules/archive.js";
import { askTreasury } from "../modules/ask.js";
import { checkAllLinks, checkLink } from "../modules/linkcheck.js";
import { buildDigest, markWatchedSeen } from "../modules/digest.js";
import { runCompletion } from "../modules/complete.js";
import { getObject } from "../storage/objects.js";
import { enrichGithub } from "../integrations/github.js";
import { snapshotRepoSkills } from "../modules/snapshot.js";
import { tryGithubToken } from "../integrations/githubToken.js";

export const itemsRouter: Router = Router();

const nowIso = () => new Date().toISOString();

// A single extract-links / snapshot-skills / refresh call fans out into many
// GitHub requests + enrichment jobs, so cap these amplifying endpoints well
// below the global limiter. Keyed per authenticated user, not per IP.
const actionLimiter = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => (req as { userId?: string }).userId ?? req.ip ?? "anon",
});

// Hard ceiling on links ingested from one awesome-list README per call.
const MAX_EXTRACT_LINKS = 200;
// Hard ceiling on bookmarks imported in one call (a browser export can hold thousands).
const MAX_IMPORT = 500;

async function ownedItem(userId: string, id: string): Promise<ServerItem> {
  const item = await getStore().items.findById(id);
  if (!item || item.userId !== userId) throw notFound("Item not found.");
  return item;
}

/* POST /items — save a link (202, enrichment async) */
itemsRouter.post(
  "/items",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const body = z
      .object({
        url: z.string().min(1),
        note: z.string().max(2000).optional(),
        tags: z.array(z.string()).optional(),
        collectionIds: z.array(z.string()).optional(),
        source: z.string().optional(),
        foundVia: z.object({ kind: z.string(), label: z.string(), itemId: z.string().optional() }).optional(),
      })
      .parse(req.body);
    const { item, duplicate } = await ingest(uid, body.url, {
      note: body.note,
      tags: body.tags,
      collectionIds: body.collectionIds,
      source: (body.source as ItemSource) ?? "web",
      foundVia: body.foundVia as ServerItem["foundVia"],
    });
    res.status(duplicate ? 200 : 202).json({ item: toClientItem(item), duplicate });
  }),
);

/* GET /items — filtered list */
itemsRouter.get(
  "/items",
  ah(async (req, res) => {
    const uid = requireUser(req);
    const q = String(req.query.q ?? "").toLowerCase();
    const kind = req.query.kind as string | undefined;
    const linkType = req.query.linkType as string | undefined;
    const repoKind = req.query.repoKind as string | undefined;
    const tag = req.query.tag as string | undefined;
    const stage = req.query.stage as string | undefined;
    const source = req.query.source as string | undefined;
    const status = req.query.status as string | undefined;
    const collection = req.query.collection as string | undefined;
    const limit = Math.min(Number(req.query.limit ?? 200), 500);

    let items = await getStore().items.find({ userId: uid, deletedAt: null }, { sort: { updatedAt: -1 } });
    items = items.filter((i) => {
      if (kind && i.kind !== kind) return false;
      if (linkType && i.linkType !== linkType) return false;
      if (repoKind && i.github?.repoKind !== repoKind) return false;
      if (tag && !i.tags.includes(tag)) return false;
      if (stage && i.stage !== stage) return false;
      if (source && i.source !== source) return false;
      if (status && i.status !== status) return false;
      if (collection && !i.collections.includes(collection)) return false;
      if (
        q &&
        !(
          i.title?.toLowerCase().includes(q) ||
          i.description?.toLowerCase().includes(q) ||
          i.url?.toLowerCase().includes(q) ||
          i.note?.toLowerCase().includes(q) ||
          i.ai?.summary?.toLowerCase().includes(q) ||
          i.prompt?.body?.toLowerCase().includes(q) ||
          i.tags.some((t) => t.toLowerCase().includes(q))
        )
      )
        return false;
      return true;
    });
    res.json({ items: items.slice(0, limit).map(toClientItem), total: items.length });
  }),
);

/* GET /search — ranked, filter-aware search across the vault (§ Sprint 6) */
itemsRouter.get(
  "/search",
  ah(async (req, res) => {
    const uid = requireUser(req);
    const q = String(req.query.q ?? "");
    const limit = Math.min(Number(req.query.limit ?? 25), 100);
    const items = await getStore().items.find({ userId: uid, deletedAt: null });
    const hits = searchItems(items, q, { limit });
    res.json({ results: hits.map((h) => ({ item: toClientItem(h.item), score: h.score })), total: hits.length });
  }),
);

/* POST /ai/complete — run an arbitrary prompt against the user's provider (Prompt Playground) */
itemsRouter.post(
  "/ai/complete",
  actionLimiter,
  ah(async (req, res) => {
    const uid = requireUser(req);
    const { prompt, system } = z.object({ prompt: z.string().min(1).max(20_000), system: z.string().max(4000).optional() }).parse(req.body);
    res.json(await runCompletion(uid, prompt, system));
  }),
);

/* POST /ask — natural-language question answered from the user's saved items (RAG over the vault) */
itemsRouter.post(
  "/ask",
  actionLimiter,
  ah(async (req, res) => {
    const uid = requireUser(req);
    const { q } = z.object({ q: z.string().min(1).max(1000) }).parse(req.body);
    res.json(await askTreasury(uid, q));
  }),
);

/* GET /digest — "what's new" + weekly activity review (watched repos + your own activity) */
itemsRouter.get(
  "/digest",
  ah(async (req, res) => {
    const uid = requireUser(req);
    const days = req.query.days != null ? Number(req.query.days) : undefined;
    res.json(await buildDigest(uid, { days: Number.isFinite(days) ? days : undefined }));
  }),
);

/* POST /digest/seen — clear the "unseen changes" counters on watched repos */
itemsRouter.post(
  "/digest/seen",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    res.json({ cleared: await markWatchedSeen(uid) });
  }),
);

/* POST /import/bookmarks — bulk-import parsed bookmark entries into the Inbox */
itemsRouter.post(
  "/import/bookmarks",
  actionLimiter,
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const body = z
      .object({
        items: z
          .array(z.object({ url: z.string().min(1), title: z.string().optional(), tags: z.array(z.string()).optional() }))
          .min(1)
          .max(MAX_IMPORT),
      })
      .parse(req.body);
    let saved = 0;
    let skipped = 0;
    for (const b of body.items) {
      try {
        const { duplicate } = await ingest(uid, b.url, { source: "import", tags: b.tags?.slice(0, 5) });
        duplicate ? skipped++ : saved++;
      } catch {
        skipped++; // a malformed URL shouldn't abort the whole import
      }
    }
    res.json({ found: body.items.length, saved, skipped });
  }),
);

/* GET /inbox — to-try items awaiting triage (§8) */
itemsRouter.get(
  "/inbox",
  ah(async (req, res) => {
    const uid = requireUser(req);
    const items = await getStore().items.find({ userId: uid, deletedAt: null, stage: "to-try" }, { sort: { createdAt: -1 } });
    res.json({ items: items.map(toClientItem) });
  }),
);

/* GET /trash */
itemsRouter.get(
  "/trash",
  ah(async (req, res) => {
    const uid = requireUser(req);
    const items = await getStore().items.find({ userId: uid }, { sort: { deletedAt: -1 } });
    res.json({ items: items.filter((i) => i.deletedAt).map(toClientItem) });
  }),
);

/* GET /items/:id */
itemsRouter.get(
  "/items/:id",
  ah(async (req, res) => {
    const uid = requireUser(req);
    res.json({ item: toClientItem(await ownedItem(uid, String(req.params.id))) });
  }),
);

/* PATCH /items/:id */
const patchSchema = z.object({
  stage: z.enum(STAGES as unknown as [string, ...string[]]).optional(),
  rating: z.number().int().min(0).max(5).optional(),
  verdict: z.string().max(500).optional(),
  note: z.string().max(2000).optional(),
  title: z.string().max(300).optional(),
  description: z.string().max(2000).optional(),
  tags: z.array(z.string()).optional(),
  collections: z.array(z.string()).optional(),
  pinned: z.boolean().optional(),
  favorite: z.boolean().optional(),
  foundVia: z.object({ kind: z.string().max(20), label: z.string().max(200), itemId: z.string().max(100).optional() }).nullable().optional(),
  snoozedUntil: z.string().datetime().nullable().optional(),
  snapshotPolicy: z.enum(["auto", "manual", "all"]).optional(),
  watch: z.object({ enabled: z.boolean() }).optional(),
});

itemsRouter.patch(
  "/items/:id",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const item = await ownedItem(uid, String(req.params.id));
    const body = patchSchema.parse(req.body);
    const patch: Partial<ServerItem> = { updatedAt: nowIso() };
    for (const key of ["stage", "rating", "note", "title", "description", "tags", "collections", "pinned", "favorite"] as const) {
      if (body[key] !== undefined) (patch as Record<string, unknown>)[key] = body[key];
    }
    if (body.verdict !== undefined) {
      patch.verdict = body.verdict;
      patch.verdictAt = nowIso();
    }
    if (body.foundVia !== undefined) {
      patch.foundVia = (body.foundVia ?? undefined) as ServerItem["foundVia"];
    }
    if (body.snoozedUntil !== undefined) {
      patch.snoozedUntil = body.snoozedUntil ?? undefined;
    }
    if (body.snapshotPolicy || body.watch) {
      patch.github = { ...item.github, owner: item.github?.owner ?? "", repo: item.github?.repo ?? "" };
      if (body.snapshotPolicy) patch.github.snapshotPolicy = body.snapshotPolicy;
      if (body.watch) patch.github.watch = { ...item.github?.watch, enabled: body.watch.enabled };
    }
    const updated = await getStore().items.updateById(item.id, patch);
    res.json({ item: toClientItem(updated!) });
  }),
);

/* DELETE /items/:id — soft delete */
itemsRouter.delete(
  "/items/:id",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const item = await ownedItem(uid, String(req.params.id));
    await getStore().items.updateById(item.id, { deletedAt: nowIso(), updatedAt: nowIso() });
    res.json({ ok: true });
  }),
);

/* POST /items/:id/restore */
itemsRouter.post(
  "/items/:id/restore",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const item = await ownedItem(uid, String(req.params.id));
    const updated = await getStore().items.updateById(item.id, { deletedAt: undefined, updatedAt: nowIso() });
    res.json({ item: toClientItem(updated!) });
  }),
);

/* DELETE /trash/:id — purge permanently (+ linked skill) */
itemsRouter.delete(
  "/trash/:id",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const item = await ownedItem(uid, String(req.params.id));
    if (item.skillId) await getStore().skills.deleteById(item.skillId);
    await getStore().items.deleteById(item.id);
    res.json({ ok: true });
  }),
);

/* POST /items/:id/extract-links — awesome-list README → Inbox (§5.7) */
itemsRouter.post(
  "/items/:id/extract-links",
  actionLimiter,
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const item = await ownedItem(uid, String(req.params.id));
    const readme = item.github?.readme ?? "";
    const all = [...new Set((readme.match(/https?:\/\/github\.com\/[\w.-]+\/[\w.-]+/gi) ?? []).map((l) => l.replace(/[).,]+$/, "")))];
    const links = all.slice(0, MAX_EXTRACT_LINKS);
    const label = item.title ?? `${item.github?.owner}/${item.github?.repo}`;
    let saved = 0;
    let skipped = 0;
    for (const url of links) {
      const { duplicate } = await ingest(uid, url, { source: "import", foundVia: { kind: "list", label, itemId: item.id }, tags: [label] });
      duplicate ? skipped++ : saved++;
    }
    res.json({ found: all.length, processed: links.length, saved, skipped });
  }),
);

/* POST /items/:id/snapshot-skills — copy skill dirs from a repo (§6.4) */
itemsRouter.post(
  "/items/:id/snapshot-skills",
  actionLimiter,
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const item = await ownedItem(uid, String(req.params.id));
    const g = item.github;
    if (!g?.owner || !g.repo) throw notFound("Not a repo item.");
    const body = z.object({ dirs: z.array(z.string()).optional() }).parse(req.body ?? {});
    const token = await tryGithubToken(uid); // auto-refreshed; null degrades to the server/anon token
    const r = await enrichGithub(g.owner, g.repo, { token, prevSkillIndex: g.skillIndex, etag: undefined });
    if (!("ok" in r) || !r.ok) {
      res.status(502).json({ error: { code: "GITHUB_UNREACHABLE", message: "Couldn't reach GitHub to snapshot skills." } });
      return;
    }
    const copied = await snapshotRepoSkills(item, r.data, { token, dirs: body.dirs });
    res.json({ copied });
  }),
);

/* GET /items/:id/archive — the stored readable Markdown snapshot (anti-link-rot) */
itemsRouter.get(
  "/items/:id/archive",
  ah(async (req, res) => {
    const uid = requireUser(req);
    const item = await ownedItem(uid, String(req.params.id));
    if (item.archive?.status !== "ok" || !item.archive.objectId) throw notFound("No archived copy for this item.");
    const buf = await getObject(uid, item.archive.objectId);
    if (!buf) throw notFound("Archived copy is missing from storage.");
    res.json({ markdown: buf.toString("utf8"), archive: item.archive });
  }),
);

/* POST /items/:id/archive — (re)capture a readable snapshot of the link */
itemsRouter.post(
  "/items/:id/archive",
  actionLimiter,
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const item = await ownedItem(uid, String(req.params.id));
    if (item.kind !== "link" || !item.url) throw notFound("Only saved links can be archived.");
    enqueue(`archive:${item.id}`, () => archiveItem(uid, item.id).then(() => undefined), 3);
    res.status(202).json({ ok: true });
  }),
);

/* POST /items/:id/check-link — re-fetch the link and flag it dead / heal it back to ready */
itemsRouter.post(
  "/items/:id/check-link",
  actionLimiter,
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const result = await checkLink(uid, String(req.params.id));
    if (!result) throw notFound("Only saved links can be checked.");
    res.json(result);
  }),
);

/* POST /links/check — bulk link-rot sweep across the vault */
itemsRouter.post(
  "/links/check",
  actionLimiter,
  ah(async (req, res) => {
    const uid = requireWrite(req);
    res.json(await checkAllLinks(uid));
  }),
);

/* POST /items/:id/refresh — re-run enrichment */
itemsRouter.post(
  "/items/:id/refresh",
  actionLimiter,
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const item = await ownedItem(uid, String(req.params.id));
    await getStore().items.updateById(item.id, { status: "enriching" });
    enqueue(`refresh:${item.id}`, () => enrichItem(uid, item.id), 1);
    res.status(202).json({ ok: true });
  }),
);
