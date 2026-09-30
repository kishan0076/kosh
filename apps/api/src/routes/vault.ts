import { randomUUID } from "node:crypto";
import { Router, type Request } from "express";
import { z } from "zod";
import { ah, badRequest, notFound } from "../errors.js";
import { requireWrite } from "../auth/middleware.js";
import { config } from "../config.js";
import { withKeyLock } from "../lib/keylock.js";
import { deleteVaultBlob, getVaultBlob, putVaultBlob } from "../vault/storage.js";

export const vaultRouter: Router = Router();

/** Each signed-in member has their OWN Secure Vault: every blob below is keyed by the user id, and the
 *  contents are end-to-end encrypted client-side under that user's master password. A write-scoped
 *  session or API key is required. */
function requireVaultUser(req: Request): string {
  return requireWrite(req);
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
    const uid = requireVaultUser(req);
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
    const uid = requireVaultUser(req);
    const body = manifestSchema.parse(req.body);
    const buf = Buffer.from(JSON.stringify(body), "utf8");
    if (buf.length > config.vault.maxManifestBytes) throw badRequest("TOO_LARGE", "Vault manifest is too large.");
    // Optimistic concurrency: the version must strictly increase, so a stale tab can't silently clobber a
    // newer save (and a fresh PUT can't overwrite an existing vault). The read-check-write is serialized
    // per user so two concurrent PUTs (two tabs / web + mobile) can't both pass the check and lose an update.
    const conflict = await withKeyLock(`vault:manifest:${uid}`, async () => {
      const existing = await getVaultBlob(uid, "manifest.json");
      if (existing) {
        const prev = JSON.parse(existing.toString("utf8")) as { version?: number };
        if (typeof prev.version === "number" && body.version <= prev.version) return prev.version;
      }
      await putVaultBlob(uid, "manifest.json", buf, "application/json");
      return null;
    });
    if (conflict !== null) {
      res.status(409).json({ error: { code: "VERSION_CONFLICT", message: "The vault changed elsewhere. Reload and try again.", details: { current: conflict } } });
      return;
    }
    res.json({ ok: true });
  }),
);

vaultRouter.post(
  "/vault/files",
  ah(async (req, res) => {
    const uid = requireVaultUser(req);
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
    const uid = requireVaultUser(req);
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
    const uid = requireVaultUser(req);
    const id = String(req.params.id);
    if (!FILE_ID.test(id)) throw badRequest("BAD_ID", "Invalid file id.");
    await deleteVaultBlob(uid, `files/${id}`);
    res.json({ ok: true });
  }),
);
