import { Router } from "express";
import { z } from "zod";
import { itemMatchesRule } from "@kosh/shared";
import { getStore, type ServerRule } from "../db/index.js";
import { ah, notFound } from "../errors.js";
import { requireUser, requireWrite } from "../auth/middleware.js";

export const rulesRouter: Router = Router();
const nowIso = () => new Date().toISOString();

function toClient(r: ServerRule) {
  const { userId: _u, ...rest } = r;
  return rest;
}

const conditionSchema = z.object({
  field: z.enum(["kind", "linkType", "repoKind", "source", "url", "title", "tag"]),
  value: z.string().max(200),
});
const actionSchema = z.object({
  type: z.enum(["addTags", "setStage", "addToCollection", "pin", "archive"]),
  value: z.string().max(300).optional(),
});
const ruleBody = z.object({
  name: z.string().min(1).max(120),
  enabled: z.boolean().optional(),
  match: z.enum(["all", "any"]).optional(),
  conditions: z.array(conditionSchema).max(10),
  actions: z.array(actionSchema).min(1).max(10),
});

async function ownedRule(uid: string, id: string): Promise<ServerRule> {
  const r = await getStore().rules.findById(id);
  if (!r || r.userId !== uid) throw notFound("Rule not found.");
  return r;
}

rulesRouter.get(
  "/rules",
  ah(async (req, res) => {
    const uid = requireUser(req);
    const rules = await getStore().rules.find({ userId: uid }, { sort: { createdAt: -1 } });
    res.json({ rules: rules.map(toClient) });
  }),
);

rulesRouter.post(
  "/rules",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const body = ruleBody.parse(req.body);
    const now = nowIso();
    const rule = await getStore().rules.create({
      userId: uid,
      name: body.name,
      enabled: body.enabled ?? true,
      match: body.match ?? "all",
      conditions: body.conditions,
      actions: body.actions,
      runCount: 0,
      createdAt: now,
      updatedAt: now,
    } as Omit<ServerRule, "id">);
    res.status(201).json({ rule: toClient(rule) });
  }),
);

rulesRouter.patch(
  "/rules/:id",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const rule = await ownedRule(uid, String(req.params.id));
    const body = ruleBody.partial().parse(req.body);
    const updated = await getStore().rules.updateById(rule.id, { ...body, updatedAt: nowIso() } as Partial<ServerRule>);
    res.json({ rule: toClient(updated!) });
  }),
);

rulesRouter.delete(
  "/rules/:id",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const rule = await ownedRule(uid, String(req.params.id));
    await getStore().rules.deleteById(rule.id);
    res.json({ ok: true });
  }),
);

/* POST /rules/test — dry-run: how many current items a candidate rule would match */
rulesRouter.post(
  "/rules/test",
  ah(async (req, res) => {
    const uid = requireUser(req);
    const body = z.object({ match: z.enum(["all", "any"]), conditions: z.array(conditionSchema).max(10) }).parse(req.body);
    const items = await getStore().items.find({ userId: uid, deletedAt: null });
    const matches = items.filter((i) => itemMatchesRule(i, body)).length;
    res.json({ matches, total: items.length });
  }),
);
