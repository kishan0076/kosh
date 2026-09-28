import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import type { RegistrySort, Tool } from "@kosh/shared";
import { ah, notFound } from "../errors.js";
import { requireWrite } from "../auth/middleware.js";
import { listRegistry, getRegistryDetail, installFromRegistry } from "../modules/registry.js";

export const registryRouter: Router = Router();

// Installing copies files + re-runs the scan; cap it per authenticated user.
const installLimiter = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => (req as { userId?: string }).userId ?? req.ip ?? "anon",
});

const TOOLS = ["claude", "codex", "cursor", "gemini", "generic"] as const;

/* GET /registry/skills — public discovery catalog (no auth). */
registryRouter.get(
  "/registry/skills",
  ah(async (req, res) => {
    const tool = TOOLS.includes(req.query.tool as Tool) ? (req.query.tool as Tool) : undefined;
    const risk = req.query.risk === "safe" || req.query.risk === "risky" ? (req.query.risk as "safe" | "risky") : undefined;
    const sort: RegistrySort = req.query.sort === "recent" || req.query.sort === "name" ? req.query.sort : "popular";
    const q = String(req.query.q ?? "").slice(0, 120);
    res.json({ skills: await listRegistry({ q, tool, risk }, sort) });
  }),
);

/* GET /registry/skills/:id — one public skill's detail for review before install (no auth). */
registryRouter.get(
  "/registry/skills/:id",
  ah(async (req, res) => {
    const detail = await getRegistryDetail(String(req.params.id));
    if (!detail) throw notFound("That skill isn't in the registry (it may be private or removed).");
    res.json(detail);
  }),
);

/* POST /registry/skills/:id/install — copy a public skill into the caller's vault (lands unreviewed). */
registryRouter.post(
  "/registry/skills/:id/install",
  installLimiter,
  ah(async (req, res) => {
    const uid = requireWrite(req);
    let result;
    try {
      result = await installFromRegistry(uid, String(req.params.id));
    } catch (e) {
      if ((e as Error).message === "SKILL_FILE_UNAVAILABLE") {
        res.status(502).json({ error: { code: "SKILL_FILE_UNAVAILABLE", message: "A file in this skill is no longer available from its author — it couldn't be installed." } });
        return;
      }
      throw e;
    }
    if (result === "not_found") throw notFound("That skill isn't in the registry (it may be private or removed).");
    res.status(result.duplicate ? 200 : 201).json(result);
  }),
);
