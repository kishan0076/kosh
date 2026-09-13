import { randomUUID } from "node:crypto";
import { Router, raw } from "express";
import { z } from "zod";
import { config } from "../config.js";
import { ah, badRequest } from "../errors.js";
import { requireWrite } from "../auth/middleware.js";
import { objectExists, presignPut, putVerified } from "../storage/objects.js";

export const uploadsRouter: Router = Router();

// Allowlisted upload extensions (§6.2). Zips are unpacked client-side, never stored.
const ALLOWED = new Set(
  "md mdx txt json yaml yml toml csv py js ts tsx jsx sh ps1 rb go rs sql html css svg png jpg jpeg webp pdf".split(" "),
);
const extOf = (p: string) => p.split(".").pop()?.toLowerCase() ?? "";

const initSchema = z.object({
  files: z
    .array(
      z.object({
        path: z.string().min(1).max(400),
        sha256: z.string().regex(/^[a-f0-9]{64}$/, "sha256 must be 64 hex chars"),
        size: z.number().int().min(0).max(config.limits.maxFileBytes),
        mime: z.string().max(128).default("application/octet-stream"),
      }),
    )
    .min(1)
    .max(config.limits.maxFiles),
});

/** POST /uploads/init — dedup against existing objects and hand back per-file upload URLs.
 *  Files go straight to R2 (presigned PUT) or, in local mode, to PUT /uploads/local/o/:hash —
 *  they never travel through the JSON API. (§6.2) */
uploadsRouter.post(
  "/uploads/init",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const { files } = initSchema.parse(req.body);

    const bad = files.find((f) => !ALLOWED.has(extOf(f.path)));
    if (bad) throw badRequest("BAD_EXTENSION", `Files of type .${extOf(bad.path)} aren't allowed.`);
    const total = files.reduce((a, f) => a + f.size, 0);
    if (total > config.limits.maxTotalBytes) throw badRequest("TOO_LARGE", `Upload exceeds the ${Math.round(config.limits.maxTotalBytes / 1e6)} MB per-batch limit.`);

    const uploads = await Promise.all(
      files.map(async (f) => {
        if (await objectExists(uid, f.sha256)) return { path: f.path, sha256: f.sha256, uploaded: true, url: null, local: false };
        const url = await presignPut(uid, f.sha256, f.mime, f.size);
        return {
          path: f.path,
          sha256: f.sha256,
          uploaded: false,
          url: url ?? `${config.apiUrl}/api/uploads/local/o/${f.sha256}`,
          local: url === null,
        };
      }),
    );
    res.json({ sessionId: randomUUID(), uploads });
  }),
);

/** PUT /uploads/local/o/:hash — direct byte upload in local-storage mode (no R2).
 *  Verifies the declared hash before storing so a client can't poison the CAS. */
uploadsRouter.put(
  "/uploads/local/o/:hash",
  raw({ type: () => true, limit: config.limits.maxFileBytes }),
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const hash = String(req.params.hash);
    if (!/^[a-f0-9]{64}$/.test(hash)) throw badRequest("BAD_HASH", "Invalid object hash.");
    const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const mime = req.header("content-type") ?? "application/octet-stream";
    if (!(await putVerified(uid, hash, buf, mime))) throw badRequest("HASH_MISMATCH", "Uploaded bytes do not match the declared hash.");
    res.status(204).end();
  }),
);
