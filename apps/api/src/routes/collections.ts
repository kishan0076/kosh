import { Router } from "express";
import { z } from "zod";
import { slugify } from "@kosh/shared";
import { getStore, type ServerCollection } from "../db/index.js";
import { ah } from "../errors.js";
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
