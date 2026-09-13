import { Router } from "express";
import { z } from "zod";
import { getStore, type ServerItem } from "../db/index.js";
import { ah, notFound } from "../errors.js";
import { requireUser, requireWrite } from "../auth/middleware.js";
import { toClientItem } from "../modules/ingest.js";
import { getObject, putIfMissing, sha256 } from "../storage/objects.js";

export const filesRouter: Router = Router();
const nowIso = () => new Date().toISOString();

filesRouter.post(
  "/files",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const { path, mime, content, bytesBase64, note, tags } = z
      .object({
        path: z.string().min(1),
        mime: z.string().default("application/octet-stream"),
        content: z.string().optional(),
        bytesBase64: z.string().optional(),
        note: z.string().max(2000).optional(),
        tags: z.array(z.string()).optional(),
      })
      .parse(req.body);
    const buf = content != null ? Buffer.from(content, "utf8") : bytesBase64 != null ? Buffer.from(bytesBase64, "base64") : Buffer.alloc(0);
    const hash = sha256(buf);
    await putIfMissing(uid, hash, buf, mime);
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
      fileObject: { path, objectId: hash, size: buf.length, mime },
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
