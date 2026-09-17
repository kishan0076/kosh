import { create } from "zustand";
import { uid } from "@/lib/ids";
import {
  PBKDF2_ITERATIONS,
  checkVerifier,
  decryptBytes,
  decryptJSON,
  deriveKey,
  encryptBytes,
  encryptJSON,
  makeVerifier,
  randomSaltB64,
  b64ToBytes,
  bytesToB64,
  type Cipher,
} from "@/lib/vaultCrypto";
import { vaultApi, type VaultManifest } from "./vaultApi";

/* ── data model (all of this only ever exists decrypted in memory) ── */

export type VaultEntryType = "note" | "secret" | "file";

export interface VaultFileRef {
  id: string;
  name: string;
  mime: string;
  size: number;
}

export interface VaultEntry {
  id: string;
  type: VaultEntryType;
  title: string;
  category: string;
  folder?: string;
  note?: string;
  secret?: string;
  file?: VaultFileRef;
  createdAt: string;
  updatedAt: string;
}

export interface VaultIndexData {
  version: 1;
  categories: string[];
  entries: VaultEntry[];
}

export type VaultStatus = "loading" | "first-run" | "locked" | "unlocked" | "error";

const AUTO_LOCK_MS = 5 * 60 * 1000; // lock after 5 minutes of inactivity
const nowIso = () => new Date().toISOString();

// Auto-lock timer lives at module scope (never serialized).
let lockTimer: ReturnType<typeof setTimeout> | null = null;

interface VaultState {
  status: VaultStatus;
  error: string | null;
  busy: boolean;
  key: CryptoKey | null; // in-memory only — never persisted or sent to the server
  manifest: VaultManifest | null;
  data: VaultIndexData | null;

  init: () => Promise<void>;
  create: (password: string) => Promise<void>;
  unlock: (password: string) => Promise<boolean>;
  lock: () => void;
  touch: () => void;

  addCategory: (name: string) => Promise<void>;
  addEntry: (input: Omit<VaultEntry, "id" | "createdAt" | "updatedAt">) => Promise<void>;
  updateEntry: (id: string, patch: Partial<Omit<VaultEntry, "id" | "createdAt">>) => Promise<void>;
  deleteEntry: (id: string) => Promise<void>;
  uploadFile: (file: File) => Promise<VaultFileRef>;
  readFile: (ref: VaultFileRef) => Promise<Blob>;
}

export const useVault = create<VaultState>((set, get) => {
  /** Re-encrypt the index and persist it. Called after every mutation. */
  async function save() {
    const { key, manifest, data } = get();
    if (!key || !manifest || !data) return;
    const index: Cipher = await encryptJSON(key, data);
    // Monotonic version for optimistic concurrency — the server rejects a non-increasing PUT.
    const next: VaultManifest = { ...manifest, version: (manifest.version ?? 1) + 1, index };
    await vaultApi.putManifest(next);
    set({ manifest: next });
  }

  function scheduleAutoLock() {
    if (lockTimer) clearTimeout(lockTimer);
    lockTimer = setTimeout(() => get().lock(), AUTO_LOCK_MS);
  }

  return {
    status: "loading",
    error: null,
    busy: false,
    key: null,
    manifest: null,
    data: null,

    init: async () => {
      set({ status: "loading", error: null });
      try {
        const m = await vaultApi.getManifest();
        if ("exists" in m && m.exists === false) set({ status: "first-run", manifest: null });
        else set({ status: "locked", manifest: m as VaultManifest });
      } catch (err) {
        set({ status: "error", error: err instanceof Error ? err.message : "Couldn't reach the vault." });
      }
    },

    create: async (password) => {
      set({ busy: true, error: null });
      try {
        const salt = randomSaltB64();
        const key = await deriveKey(password, salt);
        const verifier = await makeVerifier(key);
        const data: VaultIndexData = { version: 1, categories: ["Personal"], entries: [] };
        const index = await encryptJSON(key, data);
        const manifest: VaultManifest = { version: 1, kdf: { salt, iterations: PBKDF2_ITERATIONS }, verifier, index };
        await vaultApi.putManifest(manifest);
        set({ key, manifest, data, status: "unlocked", busy: false });
        scheduleAutoLock();
      } catch (err) {
        set({ busy: false, error: err instanceof Error ? err.message : "Couldn't create the vault." });
      }
    },

    unlock: async (password) => {
      const m = get().manifest;
      if (!m) return false;
      set({ busy: true, error: null });
      try {
        const key = await deriveKey(password, m.kdf.salt, m.kdf.iterations);
        if (!(await checkVerifier(key, m.verifier))) {
          set({ busy: false, error: "Incorrect master password." });
          return false;
        }
        const data = await decryptJSON<VaultIndexData>(key, m.index);
        set({ key, data, status: "unlocked", busy: false, error: null });
        scheduleAutoLock();
        return true;
      } catch {
        set({ busy: false, error: "Incorrect master password." });
        return false;
      }
    },

    lock: () => {
      if (lockTimer) {
        clearTimeout(lockTimer);
        lockTimer = null;
      }
      // Drop the key and all decrypted data from memory.
      set((s) => ({ key: null, data: null, status: s.manifest ? "locked" : "first-run", error: null }));
    },

    touch: () => {
      if (get().status === "unlocked") scheduleAutoLock();
    },

    addCategory: async (name) => {
      const trimmed = name.trim();
      const data = get().data;
      if (!trimmed || !data || data.categories.includes(trimmed)) return;
      set({ data: { ...data, categories: [...data.categories, trimmed] } });
      await save();
    },

    addEntry: async (input) => {
      const data = get().data;
      if (!data) return;
      const now = nowIso();
      const entry: VaultEntry = { ...input, id: uid("v"), createdAt: now, updatedAt: now };
      const categories = data.categories.includes(entry.category) ? data.categories : [...data.categories, entry.category];
      set({ data: { ...data, categories, entries: [entry, ...data.entries] } });
      await save();
    },

    updateEntry: async (id, patch) => {
      const data = get().data;
      if (!data) return;
      set({
        data: {
          ...data,
          entries: data.entries.map((e) => (e.id === id ? { ...e, ...patch, updatedAt: nowIso() } : e)),
        },
      });
      await save();
    },

    deleteEntry: async (id) => {
      const data = get().data;
      if (!data) return;
      const entry = data.entries.find((e) => e.id === id);
      set({ data: { ...data, entries: data.entries.filter((e) => e.id !== id) } });
      await save();
      // Best-effort remove the encrypted file blob too.
      if (entry?.file) vaultApi.deleteFile(entry.file.id).catch(() => {});
    },

    uploadFile: async (file) => {
      const key = get().key;
      if (!key) throw new Error("Vault is locked.");
      const cipher = await encryptBytes(key, await file.arrayBuffer());
      // Store the {iv,ct} envelope as opaque bytes; the server never sees plaintext.
      const contentB64 = bytesToB64(new TextEncoder().encode(JSON.stringify(cipher)));
      const { id } = await vaultApi.putFile(contentB64);
      return { id, name: file.name, mime: file.type || "application/octet-stream", size: file.size };
    },

    readFile: async (ref) => {
      const key = get().key;
      if (!key) throw new Error("Vault is locked.");
      const { contentB64 } = await vaultApi.getFile(ref.id);
      const cipher = JSON.parse(new TextDecoder().decode(b64ToBytes(contentB64))) as Cipher;
      const plain = await decryptBytes(key, cipher);
      return new Blob([plain], { type: ref.mime });
    },
  };
});
