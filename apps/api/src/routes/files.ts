import { Router } from "express";
import { z } from "zod";
import { getStore, type ServerItem } from "../db/index.js";
import { ah, badRequest, notFound } from "../errors.js";
import { requireUser, requireWrite } from "../auth/middleware.js";
import { toClientItem } from "../modules/ingest.js";
import { getObject, putIfMissing, sha256 } from "../storage/objects.js";

export const filesRouter: Router = Router();
const nowIso = () => new Date().toISOString();

filesRouter.post(
  "/files",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const { path, mime, content, bytesBase64, sha256: refHash, note, tags } = z
      .object({
        path: z.string().min(1),
        mime: z.string().default("application/octet-stream"),
        content: z.string().optional(),
        bytesBase64: z.string().optional(),
        sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
        size: z.number().int().min(0).optional(),
        note: z.string().max(2000).optional(),
        tags: z.array(z.string()).optional(),
      })
      .parse(req.body);
    // Prefer a pre-uploaded object (files never pass through the API on the web path, §6.2);
    // fall back to inline bytes for bot/MCP/small saves.
    let hash: string;
    let byteLen: number;
    if (refHash) {
      const stored = await getObject(uid, refHash);
      if (!stored) throw notFound("Uploaded file not found — re-run the upload.");
      // Re-hash small objects so a file's objectId always matches its bytes (§6.3).
      if (stored.length <= 2_000_000 && sha256(stored) !== refHash) throw badRequest("HASH_MISMATCH", "Uploaded bytes do not match the declared hash.");
      hash = refHash;
      byteLen = stored.length;
    } else {
      const buf = content != null ? Buffer.from(content, "utf8") : bytesBase64 != null ? Buffer.from(bytesBase64, "base64") : Buffer.alloc(0);
      hash = sha256(buf);
      byteLen = buf.length;
      await putIfMissing(uid, hash, buf, mime);
    }
    const now = nowIso();
    const item = await getStore().items.create({
      userId: uid,
      kind: "file",
      title: path,
      description: `Uploaded file (${mime}).`,
      tags: tags ?? [],
      collections: [],
      stage: "to-try",
      source: "web",
      status: "ready",
      note,
      fileObject: { path, objectId: hash, size: byteLen, mime },
      createdAt: now,
      updatedAt: now,
    } as Omit<ServerItem, "id">);
    res.status(201).json({ item: toClientItem(item) });
  }),
);

filesRouter.get(
  "/files/:id/raw",
  ah(async (req, res) => {
    const uid = requireUser(req);
    const item = await getStore().items.findById(String(req.params.id));
    if (!item || item.userId !== uid || !item.fileObject) throw notFound("File not found.");
    const buf = item.fileObject.objectId ? await getObject(uid, item.fileObject.objectId) : null;
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${item.fileObject.path.split("/").pop()}"`);
    res.send(buf ?? Buffer.alloc(0));
  }),
);
