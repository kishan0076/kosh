import { Router } from "express";
import { dbDriver, runId, storageDriver } from "../config.js";
import { getStore } from "../db/index.js";
import { ah } from "../errors.js";

export const healthRouter: Router = Router();

healthRouter.get(
  "/health",
  ah(async (_req, res) => {
    let db = false;
    try {
      db = await getStore().ping();
    } catch {
      db = false;
    }
    res.json({
      ok: db,
      runId,
      db: dbDriver(),
      storage: storageDriver(),
      time: new Date().toISOString(),
    });
  }),
);
