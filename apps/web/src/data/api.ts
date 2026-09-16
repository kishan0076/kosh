import type { Collection, Item, Skill, User } from "@kosh/shared";

/** Base URL of the Kosh API, e.g. "http://localhost:8788/api". Empty → mock mode. */
export const API_BASE: string = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "";
export const backendEnabled = API_BASE.length > 0;

/** An API error that keeps the server's machine-readable code + details (e.g. secret findings). */
export class ApiError extends Error {
  constructor(message: string, public code?: string, public details?: unknown, public status?: number) {
    super(message);
    this.name = "ApiError";
  }
}

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
    ...init,
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    let code: string | undefined;
    let details: unknown;
    try {
      const body = await res.json();
      message = body?.error?.message ?? message;
      code = body?.error?.code;
      details = body?.error?.details;
    } catch {
      /* ignore */
    }
    throw new ApiError(message, code, details, res.status);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface SkillDraftFile {
  path: string;
  mime: string;
  content?: string;
  bytesBase64?: string;
  sha256?: string;
  size?: number;
}

export interface ApiKeyPublic {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  lastUsedAt?: string;
  createdAt: string;
}

export interface PublishFileInput {
  path: string;
  content: string;
  encoding?: "utf-8" | "base64";
}
export interface PublishedRepo {
  owner: string;
  repo: string;
  htmlUrl: string;
  defaultBranch: string;
  commitSha: string;
  private: boolean;
}
export interface PublishRepoInput {
  name: string;
  description?: string;
  private?: boolean;
  commitMessage?: string;
  files: PublishFileInput[];
  allowSecrets?: boolean;
  token?: string;
  source?: "web" | "cli";
}

export type PublishPhase = "reading" | "uploading" | "creating" | "done";
export interface PublishProgress {
  phase: PublishPhase;
  /** 0–100; meaningful for reading/uploading, held at 100 while the server works. */
  pct: number;
}

/** Publish via XHR so we get real request-upload progress (fetch() can't report it). */
export function publishRepoWithProgress(
  input: PublishRepoInput,
  onUploadProgress: (pct: number) => void,
): Promise<{ item: Item; repo: PublishedRepo }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE}/repos/publish`);
    xhr.withCredentials = true;
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onUploadProgress(Math.min(100, Math.round((e.loaded / e.total) * 100)));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as { item: Item; repo: PublishedRepo });
        } catch {
          reject(new ApiError("Malformed response from the server."));
        }
        return;
      }
      let message = `Request failed (${xhr.status})`;
      let code: string | undefined;
      let details: unknown;
      try {
        const body = JSON.parse(xhr.responseText);
        message = body?.error?.message ?? message;
        code = body?.error?.code;
        details = body?.error?.details;
      } catch {
        /* ignore */
      }
      reject(new ApiError(message, code, details, xhr.status));
    };
    xhr.onerror = () => reject(new ApiError("Network error — check your connection and try again."));
    xhr.ontimeout = () => reject(new ApiError("The request timed out."));
    xhr.send(JSON.stringify(input));
  });
}

export interface UploadInput {
  path: string;
  mime: string;
  blob: Blob;
}
export interface UploadedRef {
  path: string;
  mime: string;
  sha256: string;
  size: number;
}

/** SHA-256 of a Blob via WebCrypto (matches the server's content-addressed keys). */
async function hashBlob(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Upload file bytes straight to storage (presigned R2, or the local PUT endpoint) and return
 *  content-addressed refs to finalize with — bytes never pass through the JSON API. (§6.2) */
export async function uploadObjects(inputs: UploadInput[]): Promise<UploadedRef[]> {
  const metas = await Promise.all(inputs.map(async (f) => ({ ...f, sha256: await hashBlob(f.blob), size: f.blob.size })));
  const { uploads } = await api.initUpload(metas.map((m) => ({ path: m.path, sha256: m.sha256, size: m.size, mime: m.mime })));
  // The server may skip disallowed files (binaries etc.); finalize only what it accepted.
  const byPath = new Map(uploads.map((u) => [u.path, u]));
  await Promise.all(
    metas.map(async (m) => {
      const u = byPath.get(m.path);
      if (!u || u.uploaded || !u.url) return; // skipped, or already stored (dedup)
      const res = await fetch(u.url, {
        method: "PUT",
        body: m.blob,
        headers: { "Content-Type": m.mime },
        credentials: u.local ? "include" : "omit", // presigned R2 URLs are pre-authorized
      });
      if (!res.ok) throw new Error(`Upload failed for ${m.path} (${res.status})`);
    }),
  );
  return metas.filter((m) => byPath.has(m.path)).map((m) => ({ path: m.path, mime: m.mime, sha256: m.sha256, size: m.size }));
}

export const api = {
  devLogin: (login: string, name?: string) => req<{ user: User }>("/auth/dev-login", { method: "POST", body: JSON.stringify({ login, name }) }),
  me: () => req<{ user: User }>("/me"),

  listItems: () => req<{ items: Item[]; total: number }>("/items?limit=500"),
  search: (q: string, limit = 25) => req<{ results: { item: Item; score: number }[]; total: number }>(`/search?q=${encodeURIComponent(q)}&limit=${limit}`),
  listTrash: () => req<{ items: Item[] }>("/trash"),
  listSkills: () => req<{ skills: Skill[] }>("/skills"),
  listCollections: () => req<{ collections: Collection[] }>("/collections"),

  createItem: (url: string, opts: { note?: string; tags?: string[]; collectionIds?: string[]; source?: string } = {}) =>
    req<{ item: Item; duplicate: boolean }>("/items", { method: "POST", body: JSON.stringify({ url, ...opts }) }),
  patchItem: (id: string, patch: Record<string, unknown>) => req<{ item: Item }>(`/items/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteItem: (id: string) => req<{ ok: boolean }>(`/items/${id}`, { method: "DELETE" }),
  restoreItem: (id: string) => req<{ item: Item }>(`/items/${id}/restore`, { method: "POST" }),
  purgeItem: (id: string) => req<{ ok: boolean }>(`/trash/${id}`, { method: "DELETE" }),
  refreshItem: (id: string) => req<{ ok: boolean }>(`/items/${id}/refresh`, { method: "POST" }),
  extractLinks: (id: string) => req<{ found: number; saved: number; skipped: number }>(`/items/${id}/extract-links`, { method: "POST" }),
  snapshotSkills: (id: string, dirs?: string[]) =>
    req<{ copied: number }>(`/items/${id}/snapshot-skills`, { method: "POST", body: JSON.stringify({ dirs }) }),

  createPrompt: (input: { title: string; body: string; tags?: string[] }) => req<{ item: Item }>("/prompts", { method: "POST", body: JSON.stringify(input) }),
  usePrompt: (id: string) => req<{ item: Item }>(`/prompts/${id}/use`, { method: "POST" }),

  initUpload: (files: { path: string; sha256: string; size: number; mime: string }[]) =>
    req<{ sessionId: string; uploads: { path: string; sha256: string; uploaded: boolean; url: string | null; local: boolean }[]; skipped: string[] }>("/uploads/init", {
      method: "POST",
      body: JSON.stringify({ files }),
    }),
  createSkill: (input: { name?: string; files: SkillDraftFile[]; tools?: string[]; note?: string }) =>
    req<{ skill: Skill; itemId?: string; changed: boolean }>("/skills", { method: "POST", body: JSON.stringify(input) }),
  addSkillVersion: (id: string, input: { name?: string; files: SkillDraftFile[]; tools?: string[]; note?: string }) =>
    req<{ skill: Skill; itemId?: string; changed: boolean }>(`/skills/${id}/versions`, { method: "POST", body: JSON.stringify(input) }),
  createFile: (input: { path: string; mime: string; content?: string; bytesBase64?: string; sha256?: string; size?: number }) =>
    req<{ item: Item }>("/files", { method: "POST", body: JSON.stringify(input) }),
  reviewSkill: (id: string) => req<{ skill: Skill }>(`/skills/${id}/review`, { method: "POST" }),
  keepCopy: (id: string) => req<{ skill: Skill }>(`/skills/${id}/keep-copy`, { method: "POST" }),
  patchSkill: (id: string, patch: Record<string, unknown>) => req<{ skill: Skill }>(`/skills/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),

  createCollection: (name: string) => req<{ collection: Collection }>("/collections", { method: "POST", body: JSON.stringify({ name }) }),

  publishRepo: (input: PublishRepoInput) => req<{ item: Item; repo: PublishedRepo }>("/repos/publish", { method: "POST", body: JSON.stringify(input) }),
  githubStatus: () => req<{ connected: boolean }>("/settings/github-token"),
  setGithubToken: (token: string) => req<{ connected: boolean; login: string; scopes: string[] }>("/settings/github-token", { method: "PUT", body: JSON.stringify({ token }) }),
  clearGithubToken: () => req<{ connected: boolean }>("/settings/github-token", { method: "DELETE" }),

  listApiKeys: () => req<{ apiKeys: ApiKeyPublic[] }>("/settings/api-keys"),
  // Returns the full plaintext key ONCE — the server only stores its hash, so it can never be shown again.
  createApiKey: (input: { name: string; scopes?: string[] }) =>
    req<{ apiKey: ApiKeyPublic; key: string }>("/settings/api-keys", { method: "POST", body: JSON.stringify(input) }),
  revokeApiKey: (id: string) => req<{ ok: boolean }>(`/settings/api-keys/${encodeURIComponent(id)}`, { method: "DELETE" }),

  renameTag: (from: string, to: string) => req("/tags/rename", { method: "POST", body: JSON.stringify({ from, to }) }),
  mergeTags: (from: string[], to: string) => req("/tags/merge", { method: "POST", body: JSON.stringify({ from, to }) }),
  deleteTag: (name: string) => req(`/tags/${encodeURIComponent(name)}`, { method: "DELETE" }),

  events: (onEvent: (e: { kind: string; item?: Item }) => void): (() => void) => {
    const es = new EventSource(`${API_BASE}/events`, { withCredentials: true });
    es.onmessage = (ev) => {
      try {
        onEvent(JSON.parse(ev.data));
      } catch {
        /* ignore */
      }
    };
    return () => es.close();
  },
};
