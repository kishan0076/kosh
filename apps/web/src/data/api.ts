import type { Collection, Item, Skill, User } from "@kosh/shared";

/** Base URL of the Kosh API, e.g. "http://localhost:8788/api". Empty → mock mode. */
export const API_BASE: string = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "";
export const backendEnabled = API_BASE.length > 0;

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
    ...init,
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      message = body?.error?.message ?? message;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface SkillDraftFile {
  path: string;
  mime: string;
  content?: string;
  bytesBase64?: string;
}

export const api = {
  devLogin: (login: string, name?: string) => req<{ user: User }>("/auth/dev-login", { method: "POST", body: JSON.stringify({ login, name }) }),
  me: () => req<{ user: User }>("/me"),

  listItems: () => req<{ items: Item[]; total: number }>("/items?limit=500"),
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
    req<{ copied: { name: string; path: string; skillId?: string }[] }>(`/items/${id}/snapshot-skills`, { method: "POST", body: JSON.stringify({ dirs }) }),

  createPrompt: (input: { title: string; body: string; tags?: string[] }) => req<{ item: Item }>("/prompts", { method: "POST", body: JSON.stringify(input) }),
  usePrompt: (id: string) => req<{ item: Item }>(`/prompts/${id}/use`, { method: "POST" }),

  createSkill: (input: { name?: string; files: SkillDraftFile[]; tools?: string[]; note?: string }) =>
    req<{ skill: Skill; itemId?: string; changed: boolean }>("/skills", { method: "POST", body: JSON.stringify(input) }),
  createFile: (input: { path: string; mime: string; content?: string; bytesBase64?: string }) => req<{ item: Item }>("/files", { method: "POST", body: JSON.stringify(input) }),
  reviewSkill: (id: string) => req<{ skill: Skill }>(`/skills/${id}/review`, { method: "POST" }),
  keepCopy: (id: string) => req<{ skill: Skill }>(`/skills/${id}/keep-copy`, { method: "POST" }),
  patchSkill: (id: string, patch: Record<string, unknown>) => req<{ skill: Skill }>(`/skills/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),

  createCollection: (name: string) => req<{ collection: Collection }>("/collections", { method: "POST", body: JSON.stringify({ name }) }),

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
