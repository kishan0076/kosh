/**
 * Encrypted Drive folders — client-side E2EE for files before they reach Google (roadmap #7).
 *
 * The whole feature sits behind a flag (`driveEncryptionEnabled()`). With it OFF the Drive upload/download
 * path is byte-for-byte the existing one — nothing here runs. With it ON, files uploaded into a folder the
 * user marked "encrypted" are sealed with the vault's crypto (`@kosh/shared/filecrypt`: PBKDF2 → AES-256-GCM)
 * in the browser, so Google only ever stores ciphertext + a 17-byte header. The passphrase and derived key
 * never leave the tab (in-memory only); downloads decrypt client-side.
 *
 * Zero-knowledge: only a random salt + a small verifier ciphertext are persisted (localStorage). Neither
 * reveals anything without the passphrase, and the server never sees the key or plaintext.
 */
import {
  decryptFile,
  decryptedName,
  deriveFileKey,
  encryptFile,
  encryptedName,
  isEncryptedFile,
  randomFileSalt,
} from "@kosh/shared";
import { bytesToB64, b64ToBytes } from "./vaultCrypto";

/** app-private Drive `appProperties` keys. On a FOLDER: koshEnc="1" ⇒ encrypt uploads into it.
 *  On a FILE: koshEnc="1" ⇒ its bytes are a KENC container; koshEncName ⇒ its original (plaintext) name. */
export const ENC_PROP = "koshEnc";
export const ENC_NAME_PROP = "koshEncName";

const ENABLED_KEY = "kosh.driveEnc"; // "1" turns the feature on at runtime (in addition to the build-time flag)
const SALT_KEY = "kosh.driveEnc.salt"; // base64 PBKDF2 salt (not secret)
const VERIFIER_KEY = "kosh.driveEnc.verify"; // base64 KENC container proving the passphrase is right
const VERIFIER_TEXT = "kosh-drive-encryption-verifier-v1";

// Whole-file AES-GCM buffers the plaintext + ciphertext in memory at once, so cap encrypted uploads to keep
// a huge file from OOM-ing the tab. Plain (unencrypted) uploads are unaffected — they stream in chunks.
export const MAX_ENCRYPT_BYTES = 200 * 1024 * 1024;

const enc = new TextEncoder();
const dec = new TextDecoder();

// The derived key lives ONLY here, in memory — never persisted, never sent anywhere.
let sessionKey: CryptoKey | null = null;

const ls = (): Storage | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

/** The feature flag: a build-time env (`VITE_DRIVE_ENCRYPTION=1`) OR a runtime localStorage switch.
 *  OFF ⇒ every code path below is skipped and the Drive module behaves exactly as before. */
export function driveEncryptionEnabled(): boolean {
  try {
    if (import.meta.env?.VITE_DRIVE_ENCRYPTION === "1") return true;
  } catch {
    /* import.meta may be undefined in some test contexts */
  }
  return ls()?.getItem(ENABLED_KEY) === "1";
}

/** Turn the runtime switch on/off. Turning it off also locks (drops the in-memory key). */
export function setDriveEncryptionEnabled(on: boolean): void {
  const store = ls();
  if (store) {
    if (on) store.setItem(ENABLED_KEY, "1");
    else store.removeItem(ENABLED_KEY);
  }
  if (!on) lockDrive();
}

export function isDriveUnlocked(): boolean {
  return sessionKey !== null;
}

/** Whether a passphrase has ever been set (a verifier exists) — drives "unlock" vs "create passphrase" UI. */
export function hasDrivePassphrase(): boolean {
  return !!ls()?.getItem(VERIFIER_KEY);
}

/** Drop the in-memory key. Ciphertext already on Drive stays sealed until the next unlock. */
export function lockDrive(): void {
  sessionKey = null;
}

/**
 * Unlock (first run: set) the Drive encryption passphrase.
 * - First time (no verifier yet): derives a key from a fresh salt and writes a verifier — always succeeds.
 * - Later: derives from the stored salt and checks the verifier; a wrong passphrase returns false (no key set).
 */
export async function unlockDrive(passphrase: string): Promise<boolean> {
  if (!passphrase) return false;
  const store = ls();
  let salt = store?.getItem(SALT_KEY) ?? null;
  const firstRun = !salt || !store?.getItem(VERIFIER_KEY);
  if (!salt) {
    salt = randomFileSalt();
    store?.setItem(SALT_KEY, salt);
  }
  const key = await deriveFileKey(passphrase, salt);
  if (firstRun) {
    const verifier = await encryptFile(key, enc.encode(VERIFIER_TEXT));
    store?.setItem(VERIFIER_KEY, bytesToB64(verifier));
  } else {
    try {
      const back = await decryptFile(key, b64ToBytes(store!.getItem(VERIFIER_KEY)!));
      if (dec.decode(back) !== VERIFIER_TEXT) return false;
    } catch {
      return false; // GCM auth tag failed ⇒ wrong passphrase
    }
  }
  sessionKey = key;
  return true;
}

type PropBag = { appProperties?: Record<string, string>; isFolder?: boolean; name?: string };

/** A folder the user marked "encrypt uploads". */
export function isEncryptedFolder(node?: PropBag | null): boolean {
  return !!node?.isFolder && node?.appProperties?.[ENC_PROP] === "1";
}

/** A file whose bytes are a Kosh KENC container (by the app marker, or a `.kenc` name as a fallback). */
export function isEncryptedNode(node?: PropBag | null): boolean {
  if (!node || node.isFolder) return false;
  return node.appProperties?.[ENC_PROP] === "1" || !!node.name?.endsWith(".kenc");
}

export interface PreparedUpload {
  blob: Blob;
  name: string;
  mimeType: string;
  appProperties: Record<string, string>;
}

/**
 * Seal a File for upload: encrypt its bytes into a KENC container, rename it `<name>.kenc`, and return the
 * app-private markers to stamp on the Drive file so downloads can detect + decrypt it and restore the name.
 * Requires an unlocked key. The returned blob is stable (fixed IV) so a paused upload resumes correctly.
 */
export async function encryptForUpload(file: File): Promise<PreparedUpload> {
  if (!sessionKey) throw new Error("Unlock Drive encryption first.");
  if (file.size > MAX_ENCRYPT_BYTES) {
    throw new Error(`Encrypted uploads are capped at ${Math.round(MAX_ENCRYPT_BYTES / (1024 * 1024))} MB per file.`);
  }
  const plain = new Uint8Array(await file.arrayBuffer());
  const sealed = await encryptFile(sessionKey, plain);
  return {
    blob: new Blob([sealed] as BlobPart[], { type: "application/octet-stream" }),
    name: encryptedName(file.name),
    mimeType: "application/octet-stream",
    // koshEncName is capped so key+value stay under Drive's ~124-byte appProperties limit.
    appProperties: { [ENC_PROP]: "1", [ENC_NAME_PROP]: file.name.slice(0, 100) },
  };
}

/** Decrypt downloaded ciphertext back to plaintext + its original name. Requires an unlocked key. */
export async function decryptDownload(data: Uint8Array, node?: PropBag | null): Promise<{ bytes: Uint8Array; name: string }> {
  if (!isEncryptedFile(data)) throw new Error("That file isn't Kosh-encrypted.");
  if (!sessionKey) throw new Error("Unlock Drive encryption to decrypt this file.");
  const bytes = await decryptFile(sessionKey, data);
  const name = node?.appProperties?.[ENC_NAME_PROP] || decryptedName(node?.name ?? "download");
  return { bytes, name };
}
