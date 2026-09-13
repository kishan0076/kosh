import { Router } from "express";
import { safeFetch } from "../integrations/safe-fetch.js";
import { ah, badRequest } from "../errors.js";

export const imgRouter: Router = Router();

/** Proxy an Open Graph image through safeFetch (never hot-linked). */
imgRouter.get(
  "/img",
  ah(async (req, res) => {
    const u = String(req.query.u ?? "");
    if (!u) throw badRequest("MISSING_URL", "Provide ?u=<image url>.");
    const r = await safeFetch(u, { maxBytes: 5_000_000, timeoutMs: 8000 });
    const type = r.headers.get("content-type") ?? "image/*";
    if (!type.startsWith("image/")) throw badRequest("NOT_IMAGE", "That URL is not an image.");
    res.setHeader("Content-Type", type);
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(r.bytes);
  }),
);
