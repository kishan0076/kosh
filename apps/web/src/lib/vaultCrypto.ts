/**
 * Client-side end-to-end encryption for the Secure Vault.
 *
 * The master password never leaves the browser. It's stretched with PBKDF2-SHA-256
 * into a non-extractable AES-256-GCM key that lives only in memory (never persisted,
 * never sent to the server). Everything written to the server/storage is ciphertext,
 * so a compromised database or storage bucket reveals nothing without the password.
 *
 * Uses only native WebCrypto (crypto.subtle) — no external libraries (CSP-friendly).
 */

// OWASP 2023 guidance for PBKDF2-HMAC-SHA256. High enough to make offline brute-force
// of the verifier expensive; low enough to unlock in well under a second on real hardware.
export const PBKDF2_ITERATIONS = 600_000;

const enc = new TextEncoder();
const dec = new TextDecoder();
const VERIFIER_PLAINTEXT = "kosh-vault-verifier-v1";

/** An AES-GCM ciphertext envelope (both parts base64). The IV is random per encryption. */
export interface Cipher {
  iv: string;
  ct: string;
}

function toB64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(bin);
}

function fromB64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** A fresh random salt (base64) — stored in plaintext alongside the ciphertext; salt is not secret. */
export function randomSaltB64(): string {
  return toB64(crypto.getRandomValues(new Uint8Array(16)));
}

// TS's lib.dom widened typed-array buffers to ArrayBufferLike; WebCrypto wants BufferSource.
const bs = (u: Uint8Array | ArrayBuffer): BufferSource => u as unknown as BufferSource;

/** Stretch the master password into a non-extractable AES-GCM key (memory only). */
export async function deriveKey(password: string, saltB64: string, iterations = PBKDF2_ITERATIONS): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey("raw", bs(enc.encode(password)), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: bs(fromB64(saltB64)), iterations, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false, // non-extractable: the raw key bytes can never be read back out
    ["encrypt", "decrypt"],
  );
}

export async function encryptBytes(key: CryptoKey, data: ArrayBuffer | Uint8Array): Promise<Cipher> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv: bs(iv) }, key, bs(data));
  return { iv: toB64(iv), ct: toB64(ct) };
}

export async function decryptBytes(key: CryptoKey, c: Cipher): Promise<ArrayBuffer> {
  return crypto.subtle.decrypt({ name: "AES-GCM", iv: bs(fromB64(c.iv)) }, key, bs(fromB64(c.ct)));
}

export async function encryptJSON(key: CryptoKey, obj: unknown): Promise<Cipher> {
  return encryptBytes(key, enc.encode(JSON.stringify(obj)));
}

export async function decryptJSON<T>(key: CryptoKey, c: Cipher): Promise<T> {
  return JSON.parse(dec.decode(await decryptBytes(key, c))) as T;
}

/** A verifier lets us detect a wrong master password without ever storing it. */
export async function makeVerifier(key: CryptoKey): Promise<Cipher> {
  return encryptBytes(key, enc.encode(VERIFIER_PLAINTEXT));
}

export async function checkVerifier(key: CryptoKey, v: Cipher): Promise<boolean> {
  try {
    return dec.decode(await decryptBytes(key, v)) === VERIFIER_PLAINTEXT;
  } catch {
    return false; // GCM auth tag failed → wrong key
  }
}

/** base64 helpers for file bytes crossing the JSON API. */
export const bytesToB64 = toB64;
export const b64ToBytes = fromB64;

/** A rough password-strength score (0–4) for the create-password UI. Not a security control. */
export function passwordStrength(pw: string): { score: number; label: string } {
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 14) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw) && /\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  const labels = ["Very weak", "Weak", "Fair", "Good", "Strong"];
  return { score, label: labels[score] ?? "Very weak" };
}
