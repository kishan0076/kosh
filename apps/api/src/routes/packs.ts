import { Router } from "express";
import { z } from "zod";
import { getStore, type ServerContextPack } from "../db/index.js";
import { ah, badRequest, notFound } from "../errors.js";
import { requireUser, requireWrite } from "../auth/middleware.js";
import { toClientItem } from "../modules/ingest.js";
import {
  MAX_PACK_ITEMS,
  addItemToPack,
  createPack,
  diffPackVersions,
  findPublicPack,
  listVersions,
  ownedPack,
  removeItemFromPack,
  resolvePack,
  setPackSharing,
  updatePackFields,
} from "../modules/packs.js";
import type { ServerItem } from "../db/index.js";
import { suggestPack } from "../modules/autopack.js";

export const packsRouter: Router = Router();

/** Client shape: drop the owner id and the (potentially large) version history — the history is served
 *  compactly via `versions`, and the full snapshots never need to reach the browser. */
function toClient(p: ServerContextPack) {
  const { userId: _u, snapshots: _s, ...rest } = p;
  return rest;
}

/** Lightweight, read-only item view for the public share page (no ids / owner data beyond what's shown). */
function publicItem(it: ServerItem) {
  return {
    title: it.title ?? it.url ?? "Untitled",
    kind: it.kind,
    linkType: it.linkType,
    url: it.url,
    tags: it.tags,
    summary: it.ai?.summary ?? it.description,
  };
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

/* GET /packs/public/:slug — a shared pack, rendered read-only for anyone with the link (NO auth). */
packsRouter.get(
  "/packs/public/:slug",
  ah(async (req, res) => {
    const pack = await findPublicPack(getStore(), String(req.params.slug));
    if (!pack) throw notFound("This shared pack isn't available.");
    const found = await Promise.all(pack.itemIds.map((id) => getStore().items.findById(id)));
    const items = found
      .filter((it): it is ServerItem => !!it && it.userId === pack.userId && !it.deletedAt)
      .map(publicItem);
    const resolved = await resolvePack(pack.userId, pack);
    res.json({
      name: pack.name,
      description: pack.description,
      instructions: pack.instructions,
      version: pack.version,
      updatedAt: pack.updatedAt,
      items,
      context: resolved?.markdown ?? "",
    });
  }),
);

/* POST /packs/suggest — propose a pack (items + draft instructions) for a natural-language goal */
packsRouter.post(
  "/packs/suggest",
  ah(async (req, res) => {
    const uid = requireUser(req);
    const { goal } = z.object({ goal: z.string().min(1).max(500) }).parse(req.body);
    res.json(await suggestPack(uid, goal));
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
        itemIds: z.array(z.string()).max(MAX_PACK_ITEMS).optional(),
      })
      .parse(req.body);
    const pack = await createPack(getStore(), uid, body);
    res.status(201).json({ pack: toClient(pack) });
  }),
);

/* GET /packs/:id — a pack, its resolved items (in order), and its version history */
packsRouter.get(
  "/packs/:id",
  ah(async (req, res) => {
    const uid = requireUser(req);
    const pack = await ownedPack(getStore(), uid, String(req.params.id));
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
    const pack = await ownedPack(getStore(), uid, String(req.params.id));
    const version = req.query.version != null ? Number(req.query.version) : undefined;
    if (version != null && !Number.isInteger(version)) throw badRequest("BAD_VERSION", "version must be an integer.");
    const resolved = await resolvePack(uid, pack, { version });
    if (!resolved) throw notFound(`Version ${version} of this pack is no longer available.`);
    res.json(resolved);
  }),
);

/* GET /packs/:id/diff?from=N&to=M — what changed between two retained versions */
packsRouter.get(
  "/packs/:id/diff",
  ah(async (req, res) => {
    const uid = requireUser(req);
    const pack = await ownedPack(getStore(), uid, String(req.params.id));
    const from = Number(req.query.from);
    const to = Number(req.query.to);
    if (!Number.isInteger(from) || !Number.isInteger(to)) throw badRequest("BAD_VERSION", "from and to must be integer versions.");
    const diff = diffPackVersions(pack, from, to);
    if (!diff) throw notFound("One of those versions is no longer retained.");
    // Resolve labels for the added/removed ids (best-effort; a deleted item just shows its id).
    const ids = [...new Set([...diff.addedItemIds, ...diff.removedItemIds])];
    const found = await Promise.all(ids.map((id) => getStore().items.findById(id)));
    const items: Record<string, { title: string; kind: string; linkType?: string; url?: string }> = {};
    ids.forEach((id, i) => {
      const it = found[i];
      if (it && it.userId === uid) items[id] = { title: it.title ?? it.url ?? "Untitled", kind: it.kind, linkType: it.linkType, url: it.url };
    });
    res.json({ ...diff, items });
  }),
);

/* POST /packs/:id/share — toggle read-only public sharing ({ public: boolean }) */
packsRouter.post(
  "/packs/:id/share",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const pack = await ownedPack(getStore(), uid, String(req.params.id));
    const { public: isPublic } = z.object({ public: z.boolean() }).parse(req.body);
    const updated = await setPackSharing(getStore(), pack, isPublic);
    res.json({ pack: toClient(updated) });
  }),
);

/* PATCH /packs/:id — update fields; any change to the assembled content bumps + snapshots the version */
packsRouter.patch(
  "/packs/:id",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const pack = await ownedPack(getStore(), uid, String(req.params.id));
    const body = z
      .object({
        name: z.string().min(1).max(120).optional(),
        description: z.string().max(500).nullable().optional(),
        instructions: z.string().max(20_000).nullable().optional(),
        itemIds: z.array(z.string()).max(MAX_PACK_ITEMS).optional(),
      })
      .parse(req.body);
    const updated = await updatePackFields(getStore(), uid, pack, body);
    res.json({ pack: toClient(updated) });
  }),
);

/* POST /packs/:id/items — append an item (idempotent); version bumps */
packsRouter.post(
  "/packs/:id/items",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const pack = await ownedPack(getStore(), uid, String(req.params.id));
    const { itemId } = z.object({ itemId: z.string() }).parse(req.body);
    const { pack: updated, duplicate } = await addItemToPack(getStore(), uid, pack, itemId);
    res.json({ pack: toClient(updated), duplicate });
  }),
);

/* DELETE /packs/:id/items/:itemId — remove an item; version bumps */
packsRouter.delete(
  "/packs/:id/items/:itemId",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const pack = await ownedPack(getStore(), uid, String(req.params.id));
    const updated = await removeItemFromPack(getStore(), pack, String(req.params.itemId));
    res.json({ pack: toClient(updated) });
  }),
);

/* DELETE /packs/:id — delete a pack */
packsRouter.delete(
  "/packs/:id",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const pack = await ownedPack(getStore(), uid, String(req.params.id));
    await getStore().contextPacks.deleteById(pack.id);
    res.json({ ok: true });
  }),
);
