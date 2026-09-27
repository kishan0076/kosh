import { Router } from "express";
import { z } from "zod";
import { getStore, type ServerContextPack } from "../db/index.js";
import { ah, badRequest, notFound } from "../errors.js";
import { requireUser, requireWrite } from "../auth/middleware.js";
import { toClientItem } from "../modules/ingest.js";
import { listVersions, makeSnapshot, nextSnapshots, resolvePack, type PackComposition } from "../modules/packs.js";

export const packsRouter: Router = Router();

const nowIso = () => new Date().toISOString();
const MAX_ITEMS = 200; // hard ceiling on how many items one pack can reference

/** Client shape: drop the owner id and the (potentially large) version history — the history is served
 *  compactly via `versions`, and the full snapshots never need to reach the browser. */
function toClient(p: ServerContextPack) {
  const { userId: _u, snapshots: _s, ...rest } = p;
  return rest;
}

async function ownedPack(uid: string, id: string): Promise<ServerContextPack> {
  const p = await getStore().contextPacks.findById(id);
  if (!p || p.userId !== uid) throw notFound("Context pack not found.");
  return p;
}

/** Keep only ids that reference an existing, non-deleted item this user owns — deduped, order preserved. */
async function filterOwnedItemIds(uid: string, ids: string[]): Promise<string[]> {
  const unique = [...new Set(ids)].slice(0, MAX_ITEMS);
  const found = await Promise.all(unique.map((id) => getStore().items.findById(id)));
  return unique.filter((_id, i) => {
    const item = found[i];
    return item && item.userId === uid && !item.deletedAt;
  });
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

/* POST /packs — create a pack (version 1, snapshotted) */
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
    const comp: PackComposition = { name: body.name, description: body.description, instructions: body.instructions, itemIds, version: 1 };
    const pack = await getStore().contextPacks.create({
      userId: uid,
      ...comp,
      snapshots: [makeSnapshot(comp, now)],
      createdAt: now,
      updatedAt: now,
    } as Omit<ServerContextPack, "id">);
    res.status(201).json({ pack: toClient(pack) });
  }),
);

/* GET /packs/:id — a pack, its resolved items (in order), and its version history */
packsRouter.get(
  "/packs/:id",
  ah(async (req, res) => {
    const uid = requireUser(req);
    const pack = await ownedPack(uid, String(req.params.id));
    const found = await Promise.all(pack.itemIds.map((id) => getStore().items.findById(id)));
    const items = found.filter((it): it is NonNullable<typeof it> => !!it && it.userId === uid && !it.deletedAt).map(toClientItem);
    res.json({ pack: toClient(pack), items, versions: listVersions(pack) });
  }),
);

/* GET /packs/:id/context?version=N — the assembled, grounded Markdown an agent loads (pin with ?version) */
packsRouter.get(
  "/packs/:id/context",
  ah(async (req, res) => {
    const uid = requireUser(req);
    const pack = await ownedPack(uid, String(req.params.id));
    const version = req.query.version != null ? Number(req.query.version) : undefined;
    if (version != null && !Number.isInteger(version)) throw badRequest("BAD_VERSION", "version must be an integer.");
    const resolved = await resolvePack(uid, pack, { version });
    if (!resolved) throw notFound(`Version ${version} of this pack is no longer available.`);
    res.json(resolved);
  }),
);

/* PATCH /packs/:id — update fields; any change to the assembled content bumps + snapshots the version */
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

    // The resulting composition after this patch (name/description/instructions all appear in the
    // assembled document, so a change to any of them — or to the item set — is a content change).
    const next: PackComposition = {
      name: body.name ?? pack.name,
      description: body.description !== undefined ? (body.description ?? undefined) : pack.description,
      instructions: body.instructions !== undefined ? (body.instructions ?? undefined) : pack.instructions,
      itemIds: body.itemIds !== undefined ? await filterOwnedItemIds(uid, body.itemIds) : pack.itemIds,
      version: pack.version,
    };
    const contentChanged =
      next.name !== pack.name ||
      next.description !== pack.description ||
      next.instructions !== pack.instructions ||
      next.itemIds.join(",") !== pack.itemIds.join(",");

    const patch: Partial<ServerContextPack> = { updatedAt: nowIso(), name: next.name, description: next.description, instructions: next.instructions, itemIds: next.itemIds };
    if (contentChanged) {
      next.version = pack.version + 1;
      patch.version = next.version;
      patch.snapshots = nextSnapshots(pack, next, nowIso());
    }

    const updated = await getStore().contextPacks.updateById(pack.id, patch);
    if (!updated) throw notFound("Context pack not found.");
    res.json({ pack: toClient(updated) });
  }),
);

/** Persist a new item set at a bumped version (shared by add/remove). */
async function saveItemIds(pack: ServerContextPack, itemIds: string[]): Promise<ServerContextPack> {
  const version = pack.version + 1;
  const next: PackComposition = { name: pack.name, description: pack.description, instructions: pack.instructions, itemIds, version };
  const now = nowIso();
  const updated = await getStore().contextPacks.updateById(pack.id, { itemIds, version, snapshots: nextSnapshots(pack, next, now), updatedAt: now });
  if (!updated) throw notFound("Context pack not found.");
  return updated;
}

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
    if (pack.itemIds.length >= MAX_ITEMS) throw badRequest("PACK_FULL", `A pack can hold at most ${MAX_ITEMS} items.`);
    res.json({ pack: toClient(await saveItemIds(pack, [...pack.itemIds, itemId])) });
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
    res.json({ pack: toClient(await saveItemIds(pack, pack.itemIds.filter((x) => x !== itemId))) });
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
