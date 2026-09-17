import type { Cipher } from "@/lib/vaultCrypto";
import { API_BASE, ApiError } from "./api";

/** The opaque manifest the server stores: plaintext KDF params + a verifier + the encrypted index. */
export interface VaultManifest {
  version: number;
  kdf: { salt: string; iterations: number };
  verifier: Cipher;
  index: Cipher;
}

async function vreq<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
    ...init,
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    let code: string | undefined;
    try {
      const b = await res.json();
      message = b?.error?.message ?? message;
      code = b?.error?.code;
    } catch {
      /* ignore */
    }
    throw new ApiError(message, code, undefined, res.status);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

/** All payloads here are already ciphertext — the server never sees plaintext or the key. */
export const vaultApi = {
  getManifest: () => vreq<{ exists: false } | VaultManifest>("/vault/manifest"),
  putManifest: (m: VaultManifest) => vreq<{ ok: boolean }>("/vault/manifest", { method: "PUT", body: JSON.stringify(m) }),
  putFile: (contentB64: string) => vreq<{ id: string }>("/vault/files", { method: "POST", body: JSON.stringify({ contentB64 }) }),
  getFile: (id: string) => vreq<{ contentB64: string }>(`/vault/files/${encodeURIComponent(id)}`),
  deleteFile: (id: string) => vreq<{ ok: boolean }>(`/vault/files/${encodeURIComponent(id)}`, { method: "DELETE" }),
};
