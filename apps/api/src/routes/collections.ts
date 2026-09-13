import { Router } from "express";
import { z } from "zod";
import { slugify } from "@kosh/shared";
import { getStore, type ServerCollection } from "../db/index.js";
import { ah, notFound } from "../errors.js";
import { requireUser, requireWrite } from "../auth/middleware.js";

export const collectionsRouter: Router = Router();
const COLORS = ["#4f46e5", "#14b8a6", "#f59e0b", "#ec4899", "#8b5cf6", "#0ea5e9"];

function toClient(c: ServerCollection) {
  const { userId: _u, ...rest } = c;
  return rest;
}

collectionsRouter.get(
  "/collections",
  ah(async (req, res) => {
    const uid = requireUser(req);
    const cols = await getStore().collections.find({ userId: uid }, { sort: { order: 1 } });
    res.json({ collections: cols.map(toClient) });
  }),
);

collectionsRouter.post(
  "/collections",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const { name } = z.object({ name: z.string().min(1).max(80) }).parse(req.body);
    const count = await getStore().collections.count({ userId: uid });
    const col = await getStore().collections.create({
      userId: uid,
      name,
      slug: slugify(name),
      order: count + 1,
      color: COLORS[count % COLORS.length],
    } as Omit<ServerCollection, "id">);
    res.status(201).json({ collection: toClient(col) });
  }),
);

async function ownedCollection(uid: string, id: string): Promise<ServerCollection> {
  const c = await getStore().collections.findById(id);
  if (!c || c.userId !== uid) throw notFound("Collection not found.");
  return c;
}

collectionsRouter.patch(
  "/collections/:id",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const c = await ownedCollection(uid, String(req.params.id));
    const body = z.object({ name: z.string().min(1).max(80).optional(), color: z.string().max(20).optional() }).parse(req.body);
    const patch: Partial<ServerCollection> = {};
    if (body.name) {
      patch.name = body.name;
      patch.slug = slugify(body.name);
    }
    if (body.color) patch.color = body.color;
    const updated = await getStore().collections.updateById(c.id, patch);
    res.json({ collection: toClient(updated!) });
  }),
);

collectionsRouter.delete(
  "/collections/:id",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const c = await ownedCollection(uid, String(req.params.id));
    // pull the collection id off every item
    const items = await getStore().items.find({ userId: uid });
    for (const i of items) if (i.collections.includes(c.id)) await getStore().items.updateById(i.id, { collections: i.collections.filter((x) => x !== c.id) });
    await getStore().collections.deleteById(c.id);
    res.json({ ok: true });
  }),
);

collectionsRouter.post(
  "/collections/:id/items",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const c = await ownedCollection(uid, String(req.params.id));
    const { itemId } = z.object({ itemId: z.string() }).parse(req.body);
    const item = await getStore().items.findById(itemId);
    if (!item || item.userId !== uid) throw notFound("Item not found.");
    if (!item.collections.includes(c.id)) await getStore().items.updateById(item.id, { collections: [...item.collections, c.id] });
    res.json({ ok: true });
  }),
);

collectionsRouter.delete(
  "/collections/:id/items/:itemId",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const c = await ownedCollection(uid, String(req.params.id));
    const item = await getStore().items.findById(String(req.params.itemId));
    if (!item || item.userId !== uid) throw notFound("Item not found.");
    await getStore().items.updateById(item.id, { collections: item.collections.filter((x) => x !== c.id) });
    res.json({ ok: true });
  }),
);
