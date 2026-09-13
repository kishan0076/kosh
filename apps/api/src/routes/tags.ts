import { Router } from "express";
import { z } from "zod";
import { getStore } from "../db/index.js";
import { ah } from "../errors.js";
import { requireUser, requireWrite } from "../auth/middleware.js";

export const tagsRouter: Router = Router();
const nowIso = () => new Date().toISOString();

tagsRouter.get(
  "/tags",
  ah(async (req, res) => {
    const uid = requireUser(req);
    const items = await getStore().items.find({ userId: uid, deletedAt: null });
    const counts = new Map<string, number>();
    for (const i of items) for (const t of i.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    res.json({ tags: [...counts.entries()].map(([tag, value]) => ({ tag, value })).sort((a, b) => b.value - a.value) });
  }),
);

async function rewriteTags(userId: string, fn: (tags: string[]) => string[] | null) {
  const store = getStore();
  const items = await store.items.find({ userId });
  for (const i of items) {
    const next = fn(i.tags);
    if (next) await store.items.updateById(i.id, { tags: [...new Set(next)], updatedAt: nowIso() });
  }
}

tagsRouter.post(
  "/tags/rename",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const { from, to } = z.object({ from: z.string().min(1), to: z.string().min(1) }).parse(req.body);
    await rewriteTags(uid, (tags) => (tags.includes(from) ? tags.map((t) => (t === from ? to : t)) : null));
    res.json({ ok: true });
  }),
);

tagsRouter.post(
  "/tags/merge",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const { from, to } = z.object({ from: z.array(z.string()).min(1), to: z.string().min(1) }).parse(req.body);
    await rewriteTags(uid, (tags) => (tags.some((t) => from.includes(t)) ? tags.map((t) => (from.includes(t) ? to : t)) : null));
    res.json({ ok: true });
  }),
);

tagsRouter.delete(
  "/tags/:name",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const name = String(req.params.name);
    await rewriteTags(uid, (tags) => (tags.includes(name) ? tags.filter((t) => t !== name) : null));
    res.json({ ok: true });
  }),
);
