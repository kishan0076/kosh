import { Router } from "express";
import { z } from "zod";
import { extractVariables } from "@kosh/shared";
import { getStore, type ServerItem } from "../db/index.js";
import { ah, notFound } from "../errors.js";
import { requireUser, requireWrite } from "../auth/middleware.js";
import { toClientItem } from "../modules/ingest.js";

export const promptsRouter: Router = Router();
const nowIso = () => new Date().toISOString();

promptsRouter.get(
  "/prompts",
  ah(async (req, res) => {
    const uid = requireUser(req);
    const items = await getStore().items.find({ userId: uid, kind: "prompt", deletedAt: null }, { sort: { updatedAt: -1 } });
    res.json({ items: items.map(toClientItem) });
  }),
);

promptsRouter.post(
  "/prompts",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const { title, body, tags } = z.object({ title: z.string().min(1).max(200), body: z.string().min(1), tags: z.array(z.string()).optional() }).parse(req.body);
    const now = nowIso();
    const item = await getStore().items.create({
      userId: uid,
      kind: "prompt",
      title,
      description: body.slice(0, 140),
      tags: tags ?? [],
      collections: [],
      stage: "to-try",
      source: "web",
      status: "ready",
      prompt: { body, variables: extractVariables(body).map((name) => ({ name })), usedCount: 0 },
      createdAt: now,
      updatedAt: now,
    } as Omit<ServerItem, "id">);
    res.status(201).json({ item: toClientItem(item) });
  }),
);

promptsRouter.post(
  "/prompts/:id/use",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const item = await getStore().items.findById(String(req.params.id));
    if (!item || item.userId !== uid || !item.prompt) throw notFound("Prompt not found.");
    const updated = await getStore().items.updateById(item.id, {
      prompt: { ...item.prompt, usedCount: item.prompt.usedCount + 1 },
      updatedAt: nowIso(),
    });
    res.json({ item: toClientItem(updated!) });
  }),
);
