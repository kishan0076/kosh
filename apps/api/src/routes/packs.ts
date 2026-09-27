import { Router } from "express";
import { z } from "zod";
import { getStore, type ServerContextPack } from "../db/index.js";
import { ah, notFound } from "../errors.js";
import { requireUser, requireWrite } from "../auth/middleware.js";
import { toClientItem } from "../modules/ingest.js";
import { resolvePack } from "../modules/packs.js";

export const packsRouter: Router = Router();

const nowIso = () => new Date().toISOString();
const MAX_ITEMS = 200; // hard ceiling on how many items one pack can reference

function toClient(p: ServerContextPack) {
  const { userId: _u, ...rest } = p;
  return rest;
}

async function ownedPack(uid: string, id: string): Promise<ServerContextPack> {
  const p = await getStore().contextPacks.findById(id);
  if (!p || p.userId !== uid) throw notFound("Context pack not found.");
  return p;
}

/** Keep only ids that reference an existing, non-deleted item this user owns — deduped, order preserved. */
async function filterOwnedItemIds(uid: string, ids: string[]): Promise<string[]> {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of ids.slice(0, MAX_ITEMS)) {
    if (seen.has(id)) continue;
    seen.add(id);
    const item = await getStore().items.findById(id);
    if (item && item.userId === uid && !item.deletedAt) out.push(id);
  }
  return out;
}

/* GET /packs — list packs (with a resolved item count) */
packsRouter.get(
  "/packs",
  ah(async (req, res) => {
    const uid = requireUser(req);
    const packs = await getStore().contextPacks.find({ userId: uid }, { sort: { updatedAt: -1 } });
    res.json({ packs: packs.map((p) => ({ ...toClient(p), itemCount: p.itemIds.length })) });
  }),
);

/* POST /packs — create a pack */
packsRouter.post(
  "/packs",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const body = z
      .object({
        name: z.string().min(1).max(120),
        description: z.string().max(500).optional(),
        instructions: z.string().max(20_000).optional(),
        itemIds: z.array(z.string()).max(MAX_ITEMS).optional(),
      })
      .parse(req.body);
    const itemIds = body.itemIds ? await filterOwnedItemIds(uid, body.itemIds) : [];
    const now = nowIso();
    const pack = await getStore().contextPacks.create({
      userId: uid,
      name: body.name,
      description: body.description,
      instructions: body.instructions,
      itemIds,
      version: 1,
      createdAt: now,
      updatedAt: now,
    } as Omit<ServerContextPack, "id">);
    res.status(201).json({ pack: toClient(pack) });
  }),
);

/* GET /packs/:id — a pack plus its resolved items (in order, missing ones dropped) for display */
packsRouter.get(
  "/packs/:id",
  ah(async (req, res) => {
    const uid = requireUser(req);
    const pack = await ownedPack(uid, String(req.params.id));
    const items = [];
    for (const id of pack.itemIds) {
      const item = await getStore().items.findById(id);
      if (item && item.userId === uid && !item.deletedAt) items.push(toClientItem(item));
    }
    res.json({ pack: toClient(pack), items });
  }),
);

/* GET /packs/:id/context — the assembled, grounded Markdown an agent loads */
packsRouter.get(
  "/packs/:id/context",
  ah(async (req, res) => {
    const uid = requireUser(req);
    const pack = await ownedPack(uid, String(req.params.id));
    res.json(await resolvePack(uid, pack));
  }),
);

/* PATCH /packs/:id — update fields; version bumps when the assembled content (items/instructions) changes */
packsRouter.patch(
  "/packs/:id",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const pack = await ownedPack(uid, String(req.params.id));
    const body = z
      .object({
        name: z.string().min(1).max(120).optional(),
        description: z.string().max(500).nullable().optional(),
        instructions: z.string().max(20_000).nullable().optional(),
        itemIds: z.array(z.string()).max(MAX_ITEMS).optional(),
      })
      .parse(req.body);

    const patch: Partial<ServerContextPack> = { updatedAt: nowIso() };
    let contentChanged = false;
    if (body.name !== undefined) patch.name = body.name;
    if (body.description !== undefined) patch.description = body.description ?? undefined;
    if (body.instructions !== undefined) {
      patch.instructions = body.instructions ?? undefined;
      if ((body.instructions ?? undefined) !== pack.instructions) contentChanged = true;
    }
    if (body.itemIds !== undefined) {
      patch.itemIds = await filterOwnedItemIds(uid, body.itemIds);
      if (patch.itemIds.join(",") !== pack.itemIds.join(",")) contentChanged = true;
    }
    if (contentChanged) patch.version = pack.version + 1;

    const updated = await getStore().contextPacks.updateById(pack.id, patch);
    res.json({ pack: toClient(updated!) });
  }),
);

/* POST /packs/:id/items — append an item (idempotent); version bumps */
packsRouter.post(
  "/packs/:id/items",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const pack = await ownedPack(uid, String(req.params.id));
    const { itemId } = z.object({ itemId: z.string() }).parse(req.body);
    const item = await getStore().items.findById(itemId);
    if (!item || item.userId !== uid || item.deletedAt) throw notFound("Item not found.");
    if (pack.itemIds.includes(itemId)) {
      res.json({ pack: toClient(pack), duplicate: true });
      return;
    }
    if (pack.itemIds.length >= MAX_ITEMS) throw notFound("This pack is full.");
    const updated = await getStore().contextPacks.updateById(pack.id, {
      itemIds: [...pack.itemIds, itemId],
      version: pack.version + 1,
      updatedAt: nowIso(),
    });
    res.json({ pack: toClient(updated!) });
  }),
);

/* DELETE /packs/:id/items/:itemId — remove an item; version bumps */
packsRouter.delete(
  "/packs/:id/items/:itemId",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const pack = await ownedPack(uid, String(req.params.id));
    const itemId = String(req.params.itemId);
    if (!pack.itemIds.includes(itemId)) {
      res.json({ pack: toClient(pack) });
      return;
    }
    const updated = await getStore().contextPacks.updateById(pack.id, {
      itemIds: pack.itemIds.filter((x) => x !== itemId),
      version: pack.version + 1,
      updatedAt: nowIso(),
    });
    res.json({ pack: toClient(updated!) });
  }),
);

/* DELETE /packs/:id — delete a pack */
packsRouter.delete(
  "/packs/:id",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const pack = await ownedPack(uid, String(req.params.id));
    await getStore().contextPacks.deleteById(pack.id);
    res.json({ ok: true });
  }),
);
