import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Coll, Filter, FindOpts, Store } from "./types.js";

function getPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[key] : undefined), obj);
}

function matchValue(actual: unknown, cond: unknown): boolean {
  if (cond === null) return actual == null;
  if (cond && typeof cond === "object" && !Array.isArray(cond)) {
    const c = cond as Record<string, unknown>;
    if ("$in" in c) return Array.isArray(c.$in) && (c.$in as unknown[]).includes(actual);
    if ("$nin" in c) return Array.isArray(c.$nin) && !(c.$nin as unknown[]).includes(actual);
    if ("$ne" in c) return actual !== c.$ne;
    if ("$exists" in c) return c.$exists ? actual !== undefined : actual === undefined;
    if ("$regex" in c) return typeof actual === "string" && new RegExp(String(c.$regex), String(c.$options ?? "")).test(actual);
  }
  if (Array.isArray(actual)) return actual.includes(cond);
  return actual === cond;
}

function matches(doc: Record<string, unknown>, filter: Filter): boolean {
  return Object.entries(filter).every(([key, cond]) => matchValue(getPath(doc, key), cond));
}

class MemoryColl<T extends { id: string }> implements Coll<T> {
  private map = new Map<string, T>();
  constructor(private onChange: () => void, seed?: T[]) {
    if (seed) for (const d of seed) this.map.set(d.id, d);
  }
  dump(): T[] {
    return [...this.map.values()];
  }
  async create(doc: Omit<T, "id"> & { id?: string }): Promise<T> {
    const id = doc.id ?? randomUUID();
    const full = { ...(doc as object), id } as T;
    this.map.set(id, full);
    this.onChange();
    return structuredClone(full);
  }
  async findById(id: string): Promise<T | null> {
    const d = this.map.get(id);
    return d ? structuredClone(d) : null;
  }
  async findOne(filter: Filter): Promise<T | null> {
    for (const d of this.map.values()) if (matches(d as Record<string, unknown>, filter)) return structuredClone(d);
    return null;
  }
  async find(filter: Filter = {}, opts: FindOpts = {}): Promise<T[]> {
    let out = [...this.map.values()].filter((d) => matches(d as Record<string, unknown>, filter));
    if (opts.sort) {
      const entries = Object.entries(opts.sort);
      out.sort((a, b) => {
        for (const [key, dir] of entries) {
          const av = getPath(a, key) as string | number | undefined;
          const bv = getPath(b, key) as string | number | undefined;
          if (av === bv) continue;
          if (av == null) return 1;
          if (bv == null) return -1;
          return (av < bv ? -1 : 1) * dir;
        }
        return 0;
      });
    }
    if (opts.skip) out = out.slice(opts.skip);
    if (opts.limit != null) out = out.slice(0, opts.limit);
    return out.map((d) => structuredClone(d));
  }
  async updateById(id: string, patch: Partial<T>): Promise<T | null> {
    const cur = this.map.get(id);
    if (!cur) return null;
    const next = { ...cur, ...patch, id } as T;
    this.map.set(id, next);
    this.onChange();
    return structuredClone(next);
  }
  async updateOne(filter: Filter, patch: Partial<T>): Promise<T | null> {
    for (const d of this.map.values()) if (matches(d as Record<string, unknown>, filter)) return this.updateById(d.id, patch);
    return null;
  }
  async deleteById(id: string): Promise<boolean> {
    const ok = this.map.delete(id);
    if (ok) this.onChange();
    return ok;
  }
  async count(filter: Filter = {}): Promise<number> {
    let n = 0;
    for (const d of this.map.values()) if (matches(d as Record<string, unknown>, filter)) n++;
    return n;
  }
}

const COLLECTIONS = ["users", "items", "skills", "collections", "apiKeys", "storageObjects", "uploadSessions"] as const;

/** In-memory store with debounced JSON persistence — runs with zero infra. */
export function createMemoryStore(dataDir: string): Store {
  const file = join(dataDir, "db.json");
  let disk: Record<string, unknown[]> = {};
  try {
    disk = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    disk = {};
  }

  let saveTimer: NodeJS.Timeout | null = null;
  const flush = () => {
    try {
      mkdirSync(dirname(file), { recursive: true });
      const snapshot: Record<string, unknown[]> = {};
      for (const name of COLLECTIONS) snapshot[name] = (store[name] as unknown as { dump: () => unknown[] }).dump();
      writeFileSync(file, JSON.stringify(snapshot));
    } catch {
      /* best effort */
    }
  };
  const persist = () => {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      flush();
    }, 150);
  };

  const store = {} as Record<string, MemoryColl<{ id: string }>> & Store;
  for (const name of COLLECTIONS) {
    (store as Record<string, unknown>)[name] = new MemoryColl(persist, (disk[name] as { id: string }[] | undefined) ?? []);
  }
  store.ping = async () => true;
  store.close = async () => {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    flush(); // write any pending changes so the last ≤150ms of writes survive a restart
  };
  return store;
}
