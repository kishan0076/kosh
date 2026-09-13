import { Router } from "express";
import { z } from "zod";
import { STAGES, type ItemSource } from "@kosh/shared";
import { getStore, type ServerItem } from "../db/index.js";
import { ah, notFound } from "../errors.js";
import { requireUser, requireWrite } from "../auth/middleware.js";
import { ingest, toClientItem } from "../modules/ingest.js";
import { enqueue } from "../modules/queue.js";
import { enrichItem } from "../modules/enrich.js";

export const itemsRouter: Router = Router();

const nowIso = () => new Date().toISOString();

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
          i.tags.some((t) => t.toLowerCase().includes(q))
        )
      )
        return false;
      return true;
    });
    res.json({ items: items.slice(0, limit).map(toClientItem), total: items.length });
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

/* POST /items/:id/refresh — re-run enrichment */
itemsRouter.post(
  "/items/:id/refresh",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const item = await ownedItem(uid, String(req.params.id));
    await getStore().items.updateById(item.id, { status: "enriching" });
    enqueue(`refresh:${item.id}`, () => enrichItem(uid, item.id), 1);
    res.status(202).json({ ok: true });
  }),
);
