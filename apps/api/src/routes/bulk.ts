import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { getStore } from "../db/index.js";
import { ah } from "../errors.js";
import { requireUser, requireWrite } from "../auth/middleware.js";
import { toClientItem } from "../modules/ingest.js";
import { planBulk, applyBulk } from "../modules/bulk.js";
import { previewBulkPlan, sanitizeBulkPlan } from "@kosh/shared";

export const bulkRouter: Router = Router();

// Planning can hit the AI provider and re-previews the whole library; apply fans out into many writes.
// Cap both well below the global limiter, keyed per authenticated user.
const bulkLimiter = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => (req as { userId?: string }).userId ?? req.ip ?? "anon",
});

const actionSchema = z.object({
  type: z.enum(["addTags", "removeTags", "setStage", "addToCollection", "removeFromCollection", "pin", "unpin", "archive", "delete"]),
  value: z.string().max(300).optional(),
});

/* POST /bulk/plan — natural language → a validated plan + a preview diff (no changes made). */
bulkRouter.post(
  "/bulk/plan",
  bulkLimiter,
  ah(async (req, res) => {
    const uid = requireUser(req);
    const { command } = z.object({ command: z.string().min(1).max(500) }).parse(req.body);
    res.json(await planBulk(uid, command));
  }),
);

/* POST /bulk/preview — re-preview an (edited) plan against the live library, without AI. */
bulkRouter.post(
  "/bulk/preview",
  bulkLimiter,
  ah(async (req, res) => {
    const uid = requireUser(req);
    const plan = sanitizeBulkPlan(req.body?.plan);
    if (!plan) { res.status(400).json({ error: { code: "BAD_PLAN", message: "That plan has no valid actions." } }); return; }
    const items = (await getStore().items.find({ userId: uid, deletedAt: null })).map(toClientItem);
    res.json({ plan, preview: previewBulkPlan(items, plan) });
  }),
);

/* POST /bulk/apply — apply confirmed actions to the confirmed item ids. */
bulkRouter.post(
  "/bulk/apply",
  bulkLimiter,
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const body = z.object({
      itemIds: z.array(z.string().max(64)).min(1).max(1000),
      actions: z.array(actionSchema).min(1).max(10),
    }).parse(req.body);
    const result = await applyBulk(uid, body.itemIds, body.actions);
    res.json(result);
  }),
);
