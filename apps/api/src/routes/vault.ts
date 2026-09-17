import { randomUUID } from "node:crypto";
import { Router, type Request } from "express";
import { z } from "zod";
import { getStore } from "../db/index.js";
import { ah, badRequest, forbidden, notFound } from "../errors.js";
import { requireWrite } from "../auth/middleware.js";
import { isAdmin } from "../auth/users.js";
import { config } from "../config.js";
import { deleteVaultBlob, getVaultBlob, putVaultBlob } from "../vault/storage.js";

export const vaultRouter: Router = Router();

/** Admin-only gate (defense in depth alongside the client-side E2EE). */
async function requireAdmin(req: Request): Promise<string> {
  const uid = requireWrite(req); // must be an authenticated, write-scoped session/key
  const user = await getStore().users.findById(uid);
  if (!isAdmin(user)) throw forbidden("The secure vault is admin-only.");
  return uid;
}

const cipher = z.object({ iv: z.string().min(1), ct: z.string().min(1) });
const FILE_ID = /^[0-9a-f-]{36}$/;

/** The manifest is an opaque envelope: plaintext KDF params + a verifier + the encrypted index.
 *  The server stores it verbatim and can read none of the secrets inside. */
const manifestSchema = z.object({
  version: z.number().int(),
  kdf: z.object({ salt: z.string().min(1), iterations: z.number().int().positive() }),
  verifier: cipher,
  index: cipher,
});

vaultRouter.get(
  "/vault/manifest",
  ah(async (req, res) => {
    const uid = await requireAdmin(req);
    const buf = await getVaultBlob(uid, "manifest.json");
    if (!buf) {
      res.json({ exists: false }); // first run — the client will create a master password
      return;
    }
    res.json(JSON.parse(buf.toString("utf8")));
  }),
);

vaultRouter.put(
  "/vault/manifest",
  ah(async (req, res) => {
    const uid = await requireAdmin(req);
    const body = manifestSchema.parse(req.body);
    const buf = Buffer.from(JSON.stringify(body), "utf8");
    if (buf.length > config.vault.maxManifestBytes) throw badRequest("TOO_LARGE", "Vault manifest is too large.");
    // Optimistic concurrency: the version must strictly increase, so a stale tab can't silently
    // clobber a newer save (and a fresh PUT can't overwrite an existing vault).
    const existing = await getVaultBlob(uid, "manifest.json");
    if (existing) {
      const prev = JSON.parse(existing.toString("utf8")) as { version?: number };
      if (typeof prev.version === "number" && body.version <= prev.version) {
        res.status(409).json({ error: { code: "VERSION_CONFLICT", message: "The vault changed elsewhere. Reload and try again.", details: { current: prev.version } } });
        return;
      }
    }
    await putVaultBlob(uid, "manifest.json", buf, "application/json");
    res.json({ ok: true });
  }),
);

vaultRouter.post(
  "/vault/files",
  ah(async (req, res) => {
    const uid = await requireAdmin(req);
    const { contentB64 } = z.object({ contentB64: z.string().min(1) }).parse(req.body);
    const buf = Buffer.from(contentB64, "base64");
    if (buf.length > config.vault.maxFileBytes) throw badRequest("TOO_LARGE", "Encrypted file is too large.");
    const id = randomUUID();
    await putVaultBlob(uid, `files/${id}`, buf);
    res.status(201).json({ id });
  }),
);

vaultRouter.get(
  "/vault/files/:id",
  ah(async (req, res) => {
    const uid = await requireAdmin(req);
    const id = String(req.params.id);
    if (!FILE_ID.test(id)) throw badRequest("BAD_ID", "Invalid file id.");
    const buf = await getVaultBlob(uid, `files/${id}`);
    if (!buf) throw notFound("File not found.");
    res.json({ contentB64: buf.toString("base64") });
  }),
);

vaultRouter.delete(
  "/vault/files/:id",
  ah(async (req, res) => {
    const uid = await requireAdmin(req);
    const id = String(req.params.id);
    if (!FILE_ID.test(id)) throw badRequest("BAD_ID", "Invalid file id.");
    await deleteVaultBlob(uid, `files/${id}`);
    res.json({ ok: true });
  }),
);
