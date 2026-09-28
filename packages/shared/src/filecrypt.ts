/**
 * File encryption for "encrypted Drive folders" — zero-knowledge files.
 *
 * Reuses the vault's approach (PBKDF2-SHA-256 → AES-256-GCM, native WebCrypto only) but packs the result
 * into a compact self-describing BINARY container so encrypted bytes upload as-is (no base64 inflation):
 *
 *   magic "KENC" (4) · version 1 (1) · IV (12) · AES-GCM ciphertext+tag (rest)
 *
 * The passphrase and derived key never leave the browser; Google only ever stores ciphertext.
 */

const MAGIC = new Uint8Array([0x4b, 0x45, 0x4e, 0x43]); // "KENC"
const VERSION = 1;
const HEADER = MAGIC.length + 1 + 12; // magic + version + iv

const subtle = (): SubtleCrypto => {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (!c?.subtle) throw new Error("WebCrypto is unavailable in this environment.");
  return c.subtle;
};

const bs = (u: Uint8Array | ArrayBuffer): BufferSource => u as unknown as BufferSource;

function b64ToBytes(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Derive a non-extractable AES-GCM key from a passphrase + base64 salt (PBKDF2-SHA-256). */
export async function deriveFileKey(passphrase: string, saltB64: string, iterations = 600_000): Promise<CryptoKey> {
  const base = await subtle().importKey("raw", bs(new TextEncoder().encode(passphrase)), "PBKDF2", false, ["deriveKey"]);
  return subtle().deriveKey(
    { name: "PBKDF2", salt: bs(b64ToBytes(saltB64)), iterations, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** True if the bytes start with the KENC container magic + a known version. */
export function isEncryptedFile(data: Uint8Array): boolean {
  if (data.length < HEADER) return false;
  for (let i = 0; i < MAGIC.length; i++) if (data[i] !== MAGIC[i]) return false;
  return data[MAGIC.length] === VERSION;
}

/** Encrypt plaintext bytes into a KENC container. */
export async function encryptFile(key: CryptoKey, plain: Uint8Array | ArrayBuffer): Promise<Uint8Array> {
  const iv = (globalThis.crypto as Crypto).getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await subtle().encrypt({ name: "AES-GCM", iv: bs(iv) }, key, bs(plain)));
  const out = new Uint8Array(HEADER + ct.length);
  out.set(MAGIC, 0);
  out[MAGIC.length] = VERSION;
  out.set(iv, MAGIC.length + 1);
  out.set(ct, HEADER);
  return out;
}

/** Decrypt a KENC container back to plaintext bytes. Throws on a bad container or wrong key. */
export async function decryptFile(key: CryptoKey, data: Uint8Array): Promise<Uint8Array> {
  if (!isEncryptedFile(data)) throw new Error("Not a Kosh-encrypted file.");
  const iv = data.subarray(MAGIC.length + 1, HEADER);
  const ct = data.subarray(HEADER);
  return new Uint8Array(await subtle().decrypt({ name: "AES-GCM", iv: bs(iv) }, key, bs(ct)));
}

/** A fresh random salt (base64) for a new encryption passphrase. */
export function randomFileSalt(): string {
  const b = (globalThis.crypto as Crypto).getRandomValues(new Uint8Array(16));
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
}

/** The encrypted-file name convention: original name + ".kenc". */
export const ENCRYPTED_EXT = ".kenc";
export const encryptedName = (name: string): string => (name.endsWith(ENCRYPTED_EXT) ? name : name + ENCRYPTED_EXT);
export const decryptedName = (name: string): string => (name.endsWith(ENCRYPTED_EXT) ? name.slice(0, -ENCRYPTED_EXT.length) : name);
