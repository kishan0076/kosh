import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { config, storageDriver } from "../config.js";
import { s3 } from "../storage/objects.js";

/**
 * Storage for the Secure Vault — deliberately ISOLATED from the app's MongoDB store and its main
 * object store. It lives in its own directory (config.vault.dir, separate from DATA_DIR) or, when
 * configured, its own R2/S3 bucket (config.vault.r2Bucket). Only ever holds opaque ciphertext:
 * the server can't read any of it.
 */

const useR2 = () => storageDriver() === "r2" && !!config.vault.r2Bucket;
const localPath = (key: string) => join(config.vault.dir, key);
// Per-user key space; userId is URL-encoded so it can't escape the prefix. `name` is reject-listed for
// path-traversal here too (defense-in-depth): all current callers pass constrained names (manifest.json or
// files/<uuid>), but the storage layer must never let a name escape the user's prefix on disk or in the bucket.
const vaultKey = (userId: string, name: string) => {
  if (!name || name.includes("..") || name.startsWith("/") || name.includes("\\") || name.includes("\0")) {
    throw new Error("Invalid vault blob name.");
  }
  return `u/${encodeURIComponent(userId)}/${name}`;
};

export async function putVaultBlob(userId: string, name: string, data: Buffer, mime = "application/octet-stream"): Promise<void> {
  const key = vaultKey(userId, name);
  if (useR2()) {
    const { mod, client } = await s3();
    await client.send(new mod.PutObjectCommand({ Bucket: config.vault.r2Bucket!, Key: key, Body: data, ContentType: mime }));
  } else {
    const p = localPath(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, data);
  }
}

export async function getVaultBlob(userId: string, name: string): Promise<Buffer | null> {
  const key = vaultKey(userId, name);
  if (useR2()) {
    try {
      const { mod, client } = await s3();
      const res = await client.send(new mod.GetObjectCommand({ Bucket: config.vault.r2Bucket!, Key: key }));
      const bytes = await res.Body?.transformToByteArray();
      return bytes ? Buffer.from(bytes) : null;
    } catch (err) {
      // Return null ONLY for a genuine not-found. Any other error (network, throttle, auth) must propagate:
      // the manifest PUT's first-write/version guard treats null as "no vault yet" and would otherwise
      // OVERWRITE an existing vault on a transient read failure (unrecoverable — we hold only ciphertext).
      if (isNotFound(err)) return null;
      throw err;
    }
  }
  try {
    return await readFile(localPath(key));
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return null;
    throw err;
  }
}

/** True only for a definitive object-not-found from S3/R2 (never for a transient/ambiguous error). */
function isNotFound(err: unknown): boolean {
  const e = err as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === "NoSuchKey" || e?.name === "NotFound" || e?.Code === "NoSuchKey" || e?.$metadata?.httpStatusCode === 404;
}

export async function deleteVaultBlob(userId: string, name: string): Promise<void> {
  const key = vaultKey(userId, name);
  if (useR2()) {
    try {
      const { mod, client } = await s3();
      await client.send(new mod.DeleteObjectCommand({ Bucket: config.vault.r2Bucket!, Key: key }));
    } catch {
      /* already gone */
    }
  } else {
    try {
      await unlink(localPath(key));
    } catch {
      /* already gone */
    }
  }
}
