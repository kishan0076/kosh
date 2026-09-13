import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { config, storageDriver } from "../config.js";
import { logger } from "../logger.js";

export const sha256 = (buf: Buffer) => createHash("sha256").update(buf).digest("hex");
export const objectKey = (userId: string, hash: string) => `u/${userId}/o/${hash}`;

/* ── Local filesystem store (default; runs anywhere) ─────────── */
const localPath = (key: string) => join(config.dataDir, "objects", key);

async function localPut(key: string, buf: Buffer) {
  const p = localPath(key);
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, buf);
}
async function localGet(key: string): Promise<Buffer | null> {
  try {
    return await readFile(localPath(key));
  } catch {
    return null;
  }
}
async function localExists(key: string): Promise<boolean> {
  try {
    await access(localPath(key));
    return true;
  } catch {
    return false;
  }
}

/* ── R2 / S3 store (production) ──────────────────────────────── */
type S3Mod = typeof import("@aws-sdk/client-s3");
let s3Client: InstanceType<S3Mod["S3Client"]> | null = null;
let s3Mod: S3Mod | null = null;
async function s3(): Promise<{ mod: S3Mod; client: InstanceType<S3Mod["S3Client"]> }> {
  if (!s3Mod) s3Mod = await import("@aws-sdk/client-s3");
  if (!s3Client) {
    s3Client = new s3Mod.S3Client({
      region: "auto",
      endpoint: config.r2.endpoint ?? `https://${config.r2.accountId}.r2.cloudflarestorage.com`,
      forcePathStyle: !!config.r2.endpoint,
      credentials: { accessKeyId: config.r2.accessKeyId!, secretAccessKey: config.r2.secretAccessKey! },
    });
  }
  return { mod: s3Mod, client: s3Client };
}

/* ── Public API ─────────────────────────────────────────────── */
export async function putIfMissing(userId: string, hash: string, buf: Buffer, mime: string): Promise<string> {
  const key = objectKey(userId, hash);
  if (storageDriver() === "r2") {
    const { mod, client } = await s3();
    try {
      await client.send(new mod.HeadObjectCommand({ Bucket: config.r2.bucket, Key: key }));
    } catch {
      await client.send(new mod.PutObjectCommand({ Bucket: config.r2.bucket, Key: key, Body: buf, ContentType: mime }));
    }
  } else {
    if (!(await localExists(key))) await localPut(key, buf);
  }
  return key;
}

export async function getObject(userId: string, hash: string): Promise<Buffer | null> {
  const key = objectKey(userId, hash);
  if (storageDriver() === "r2") {
    try {
      const { mod, client } = await s3();
      const res = await client.send(new mod.GetObjectCommand({ Bucket: config.r2.bucket, Key: key }));
      const bytes = await res.Body?.transformToByteArray();
      return bytes ? Buffer.from(bytes) : null;
    } catch (err) {
      logger.warn({ err, key }, "r2 get failed");
      return null;
    }
  }
  return localGet(key);
}
