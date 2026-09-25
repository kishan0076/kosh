import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
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

/* ── Admin password (env-configured login) ──────────────────────────────────────────────────────
 * The admin credential lives ONLY in env, never in the repo. A password may be stored either as a
 * scrypt hash ("scrypt:<saltB64url>:<hashB64url>", recommended) or as plaintext (convenient for a
 * self-hosted single admin). Verification is always constant-time to avoid leaking via timing. */
const SCRYPT_PREFIX = "scrypt:";
const SCRYPT_KEYLEN = 32;

/** Produce a storable scrypt hash of a password (for ADMIN_PASSWORD_HASH). */
export function hashPassword(plain: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(plain, salt, SCRYPT_KEYLEN);
  return `${SCRYPT_PREFIX}${salt.toString("base64url")}.${hash.toString("base64url")}`;
}

/** Constant-time compare of two strings (length-safe — never short-circuits on differing length). */
function safeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  // timingSafeEqual requires equal length; hash both to a fixed 32 bytes so length never leaks.
  const ah = createHash("sha256").update(ab).digest();
  const bh = createHash("sha256").update(bb).digest();
  return timingSafeEqual(ah, bh) && ab.length === bb.length;
}

/**
 * Verify a password against the stored value. `stored` is either a scrypt hash (preferred) or a
 * plaintext password. Always runs the full comparison (constant-time) so a wrong password and a
 * wrong-length password take the same path.
 */
export function verifyPassword(plain: string, stored: string): boolean {
  if (stored.startsWith(SCRYPT_PREFIX)) {
    const [saltB64, hashB64] = stored.slice(SCRYPT_PREFIX.length).split(".");
    if (!saltB64 || !hashB64) return false;
    try {
      const expected = Buffer.from(hashB64, "base64url");
      const actual = scryptSync(plain, Buffer.from(saltB64, "base64url"), expected.length || SCRYPT_KEYLEN);
      return actual.length === expected.length && timingSafeEqual(actual, expected);
    } catch {
      return false;
    }
  }
  return safeEqualStr(plain, stored);
}
