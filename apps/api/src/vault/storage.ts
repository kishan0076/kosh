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
// Per-user key space; userId is URL-encoded so it can't escape the prefix.
const vaultKey = (userId: string, name: string) => `u/${encodeURIComponent(userId)}/${name}`;

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
    } catch {
      return null;
    }
  }
  try {
    return await readFile(localPath(key));
  } catch {
    return null;
  }
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
