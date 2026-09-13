import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { config } from "../config.js";

// 32-byte key derived from ENCRYPTION_KEY.
const key = createHash("sha256").update(config.encryptionKey).digest();
const PREFIX = "enc:v1:";

/** Encrypt a secret at rest (AES-256-GCM). Returns "enc:v1:<iv>.<tag>.<cipher>" (base64url). */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64url")}.${tag.toString("base64url")}.${enc.toString("base64url")}`;
}

/** Decrypt a value produced by encryptSecret. Returns plaintext unchanged if it isn't encrypted. */
export function decryptSecret(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (!value.startsWith(PREFIX)) return value; // tolerate legacy plaintext
  try {
    const [ivB64, tagB64, dataB64] = value.slice(PREFIX.length).split(".");
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64!, "base64url"));
    decipher.setAuthTag(Buffer.from(tagB64!, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(dataB64!, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return undefined;
  }
}
