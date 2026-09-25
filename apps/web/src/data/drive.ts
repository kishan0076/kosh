import { create } from "zustand";
import { uid } from "@/lib/ids";
import {
  CanceledError,
  PausedError,
  driveApi,
  resumableUpload,
  type DriveAccount,
  type DriveFolder,
  type DriveQuota,
  type DriveUploadRecord,
  type ResumableControl,
} from "./driveApi";

export type DriveItemStatus = "queued" | "duplicate" | "uploading" | "paused" | "completed" | "failed" | "canceled";

export interface DriveQueueItem {
  id: string;
  file: File;
  name: string;
  relPath: string; // for bulk folder uploads (e.g. "project/src/app.ts"); === name for single files
  mimeType: string;
  size: number;
  status: DriveItemStatus;
  uploaded: number; // bytes
  error?: string;
  driveFileId?: string;
  webViewLink?: string;
  duplicate?: boolean; // a same-named file already exists in the destination
  sessionPending?: boolean; // "uploading" but the session/offset request hasn't answered yet (Resume/Retry in flight)
  destFolderId: string; // folder chosen when the file was added
  destPath: string; // human-readable breadcrumb for history
}

interface DriveState {
  status: "loading" | "ready" | "error";
  error: string | null;
  configured: boolean;

  accounts: DriveAccount[];
  accountId: string | null;

  path: DriveFolder[]; // breadcrumb below the implicit root
  folders: DriveFolder[]; // children of the current folder
  foldersLoading: boolean;
  foldersError: string | null; // last listFolders failure, shown inline with a Retry (cleared on success)
  quota: DriveQuota | null;
  quotaLoaded: boolean; // first about() answered (ok or not) — the Storage card shows a skeleton until then
  history: DriveUploadRecord[];
  historyLoaded: boolean; // same for the Recent uploads list

  queue: DriveQueueItem[];

  init: () => Promise<void>;
  refreshAccounts: () => Promise<void>;
  selectAccount: (id: string) => Promise<void>;
  disconnect: (id: string) => Promise<void>;

  openFolder: (folder: DriveFolder) => Promise<void>;
  breadcrumbTo: (index: number) => Promise<void>; // -1 → root
  loadFolders: () => Promise<void>;
  makeFolder: (name: string) => Promise<void>;
  loadQuota: () => Promise<void>;
  loadHistory: () => Promise<void>;

  addFiles: (entries: { file: File; relPath?: string }[]) => void;
  checkDuplicates: () => Promise<void>;
  startUploads: () => Promise<void>;
  pauseItem: (id: string) => void;
  resumeItem: (id: string) => void;
  cancelItem: (id: string) => void;
  retryItem: (id: string) => void;
  retryFailed: () => void;
  removeItem: (id: string) => void;
  clearFinished: () => void;
  skipDuplicates: () => void;
}

/* ── module-level state that must not trigger re-renders ── */
const controls = new Map<string, ResumableControl>(); // per-item pause/cancel flags
const resumes = new Map<string, { sessionUri: string; uploaded: number }>(); // resume points
const lastEmit = new Map<string, number>(); // progress-throttle timestamps
// Folder-creation memo for the active batch, keyed by full path. Caches the IN-FLIGHT promise (not the
// resolved id) so concurrent uploads into the same new sub-folder share ONE createFolder call instead
// of racing and creating duplicate Drive folders. Reset when the queue fully drains.
let folderCache: Map<string, Promise<string>> | null = null;
let tokenCache: { accountId: string; token: string; exp: number } | null = null;
let activeCount = 0;
const CONCURRENCY = 3;
// Progress writes re-render the whole queue; phones get half the tick rate (3 concurrent uploads at
// 120ms is ~25 list renders/s on a low-end Android).
const PROGRESS_THROTTLE_MS = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches ? 250 : 120;

const currentFolderId = (path: DriveFolder[]) => (path.length ? path[path.length - 1]!.id : "root");
const pathString = (path: DriveFolder[]) => "My Drive" + path.map((f) => ` / ${f.name}`).join("");

export const useDrive = create<DriveState>((set, get) => {
  async function ensureToken(accountId: string): Promise<string> {
    if (tokenCache && tokenCache.accountId === accountId && tokenCache.exp > Date.now() + 60_000) return tokenCache.token;
    const { accessToken, expiresIn } = await driveApi.mintToken(accountId);
    tokenCache = { accountId, token: accessToken, exp: Date.now() + expiresIn * 1000 };
    return accessToken;
  }
  function freshToken(accountId: string): Promise<string> {
    tokenCache = null;
    return ensureToken(accountId);
  }

  function patchItem(id: string, patch: Partial<DriveQueueItem>) {
    set((s) => ({ queue: s.queue.map((it) => (it.id === id ? { ...it, ...patch } : it)) }));
  }

  function emitProgress(id: string, uploaded: number, size: number) {
    const now = Date.now();
    if (uploaded < size && now - (lastEmit.get(id) ?? 0) < PROGRESS_THROTTLE_MS) return; // throttle mid-flight writes
    lastEmit.set(id, now);
    patchItem(id, { uploaded });
  }

  /** Recreate a nested folder path under baseId, memoized (by in-flight promise) within one batch. */
  async function ensureFolderPath(accountId: string, baseId: string, parts: string[]): Promise<string> {
    const cache = (folderCache ??= new Map());
    let parentId = baseId;
    let key = baseId;
    for (const part of parts) {
      key += "/" + part;
      let p = cache.get(key);
      if (!p) {
        p = driveApi.createFolder(accountId, part, parentId).then((r) => r.folder.id);
        p.catch(() => cache.delete(key)); // don't let a transient failure poison the memo
        cache.set(key, p);
      }
      parentId = await p;
    }
    return parentId;
  }

  async function runItem(item: DriveQueueItem, accountId: string) {
    activeCount++;
    try {
      // Resolve the destination folder (create sub-folders for bulk uploads). On resume the session
      // URI already points at the right folder, so skip folder creation to avoid an orphan duplicate.
      const resuming = resumes.has(item.id);
      const dirParts = item.relPath.split("/").slice(0, -1);
      const targetFolderId = !resuming && dirParts.length ? await ensureFolderPath(accountId, item.destFolderId, dirParts) : item.destFolderId;

      const control = controls.get(item.id)!;
      const token = await ensureToken(accountId);
      patchItem(item.id, { status: "uploading", error: undefined });

      // The first progress callback means the session (or the resume-offset query) answered.
      let sessionSettled = false;
      const result = await resumableUpload({
        accessToken: token,
        file: item.file,
        name: item.name,
        mimeType: item.mimeType,
        folderId: targetFolderId,
        control,
        onProgress: (b) => {
          if (!sessionSettled) {
            sessionSettled = true;
            lastEmit.set(item.id, Date.now());
            patchItem(item.id, { uploaded: b, sessionPending: false });
            return;
          }
          emitProgress(item.id, b, item.size);
        },
        getFreshToken: () => freshToken(accountId),
        resumeFrom: resumes.get(item.id),
      });

      resumes.delete(item.id);
      patchItem(item.id, { status: "completed", uploaded: item.size, sessionPending: false, driveFileId: result.id, webViewLink: result.webViewLink });
      driveApi
        .recordUpload({
          accountId,
          fileName: item.name,
          mimeType: item.mimeType,
          size: item.size,
          driveFileId: result.id,
          folderId: targetFolderId,
          folderPath: dirParts.length ? `${item.destPath} / ${dirParts.join(" / ")}` : item.destPath,
          webViewLink: result.webViewLink,
          status: "completed",
        })
        .catch(() => {});
    } catch (err) {
      if (err instanceof PausedError) {
        resumes.set(item.id, { sessionUri: err.sessionUri, uploaded: err.uploaded });
        patchItem(item.id, { status: "paused", sessionPending: false });
      } else if (err instanceof CanceledError) {
        resumes.delete(item.id);
        patchItem(item.id, { status: "canceled", sessionPending: false });
      } else {
        const message = err instanceof Error ? err.message : "Upload failed.";
        patchItem(item.id, { status: "failed", error: message, sessionPending: false });
        driveApi.recordUpload({ accountId, fileName: item.name, mimeType: item.mimeType, size: item.size, status: "failed", error: message, folderPath: item.destPath }).catch(() => {});
      }
    } finally {
      activeCount--;
      pump();
    }
  }

  /** Start queued items up to the concurrency cap. */
  function pump() {
    const accountId = get().accountId;
    if (!accountId) return;
    while (activeCount < CONCURRENCY) {
      const next = get().queue.find((it) => it.status === "queued");
      if (!next) break;
      const control: ResumableControl = { paused: false, canceled: false };
      controls.set(next.id, control);
      patchItem(next.id, { status: "uploading", sessionPending: true });
      void runItem(next, accountId);
    }
    // Refresh usage + history once the batch drains, and reset the per-batch folder memo.
    if (activeCount === 0 && !get().queue.some((it) => it.status === "queued" || it.status === "uploading")) {
      folderCache = null;
      void get().loadQuota();
      void get().loadHistory();
    }
  }

  return {
    status: "loading",
    error: null,
    configured: false,
    accounts: [],
    accountId: null,
    path: [],
    folders: [],
    foldersLoading: false,
    foldersError: null,
    quota: null,
    quotaLoaded: false,
    history: [],
    historyLoaded: false,
    queue: [],

    init: async () => {
      set({ status: "loading", error: null });
      try {
        const { accounts, configured } = await driveApi.listAccounts();
        set({ accounts, configured, status: "ready" });
        if (accounts.length && !get().accountId) await get().selectAccount(accounts[0]!.id);
      } catch (err) {
        set({ status: "error", error: err instanceof Error ? err.message : "Couldn't reach the Drive service." });
      }
    },

    refreshAccounts: async () => {
      try {
        const { accounts, configured } = await driveApi.listAccounts();
        set({ accounts, configured });
        if (accounts.length && !get().accountId) await get().selectAccount(accounts[0]!.id);
        if (!accounts.length) set({ accountId: null, folders: [], path: [], quota: null, quotaLoaded: false });
      } catch {
        /* keep prior state */
      }
    },

    selectAccount: async (id) => {
      tokenCache = null;
      set({ accountId: id, path: [], folders: [], foldersError: null, quota: null, quotaLoaded: false });
      await Promise.all([get().loadFolders(), get().loadQuota(), get().loadHistory()]);
    },

    disconnect: async (id) => {
      await driveApi.deleteAccount(id);
      if (get().accountId === id) {
        tokenCache = null;
        set({ accountId: null, folders: [], path: [], quota: null, quotaLoaded: false });
      }
      await get().refreshAccounts();
    },

    openFolder: async (folder) => {
      set((s) => ({ path: [...s.path, folder] }));
      await get().loadFolders();
    },
    breadcrumbTo: async (index) => {
      set((s) => ({ path: index < 0 ? [] : s.path.slice(0, index + 1) }));
      await get().loadFolders();
    },

    loadFolders: async () => {
      const accountId = get().accountId;
      if (!accountId) return;
      set({ foldersLoading: true, foldersError: null });
      try {
        const { folders } = await driveApi.listFolders(accountId, currentFolderId(get().path));
        set({ folders, foldersLoading: false });
      } catch (err) {
        set({ folders: [], foldersLoading: false, foldersError: err instanceof Error ? err.message : "Couldn't list folders." });
      }
    },

    makeFolder: async (name) => {
      const accountId = get().accountId;
      const trimmed = name.trim();
      if (!accountId || !trimmed) return;
      await driveApi.createFolder(accountId, trimmed, currentFolderId(get().path));
      await get().loadFolders();
    },

    loadQuota: async () => {
      const accountId = get().accountId;
      if (!accountId) return;
      try {
        const { quota } = await driveApi.about(accountId);
        set({ quota, quotaLoaded: true });
      } catch {
        set({ quotaLoaded: true }); // non-fatal: the card just shows nothing instead of a skeleton forever
      }
    },

    loadHistory: async () => {
      try {
        const { uploads } = await driveApi.listUploads();
        set({ history: uploads, historyLoaded: true });
      } catch {
        set({ historyLoaded: true }); // non-fatal
      }
    },

    addFiles: (entries) => {
      const destFolderId = currentFolderId(get().path);
      const destPath = pathString(get().path);
      const items: DriveQueueItem[] = entries.map(({ file, relPath }) => {
        const rel = relPath || (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
        return {
          id: uid("d"),
          file,
          name: file.name,
          relPath: rel,
          mimeType: file.type || "application/octet-stream",
          size: file.size,
          status: "queued",
          uploaded: 0,
          destFolderId,
          destPath,
        };
      });
      set((s) => ({ queue: [...items, ...s.queue] }));
    },

    checkDuplicates: async () => {
      const accountId = get().accountId;
      if (!accountId) return;
      const pending = get().queue.filter((it) => it.status === "queued");
      // Group by destination folder, since duplicates are per-folder.
      const byFolder = new Map<string, DriveQueueItem[]>();
      for (const it of pending) {
        const arr = byFolder.get(it.destFolderId) ?? [];
        arr.push(it);
        byFolder.set(it.destFolderId, arr);
      }
      for (const [folderId, group] of byFolder) {
        // Only top-level files land directly in the destination; nested files go into new sub-folders.
        const topLevel = group.filter((it) => !it.relPath.includes("/"));
        if (!topLevel.length) continue;
        try {
          const { duplicates } = await driveApi.duplicates(accountId, folderId, topLevel.map((it) => it.name));
          const dupNames = new Set(duplicates.map((d) => d.name));
          for (const it of topLevel) if (dupNames.has(it.name)) patchItem(it.id, { duplicate: true });
        } catch {
          /* non-fatal — duplicate detection is best-effort */
        }
      }
    },

    startUploads: async () => {
      if (!get().accountId) return;
      pump();
    },

    pauseItem: (id) => {
      const c = controls.get(id);
      if (c) c.paused = true; // the in-flight loop throws PausedError and frees the slot
    },
    resumeItem: (id) => {
      const item = get().queue.find((it) => it.id === id);
      if (!item || (item.status !== "paused" && item.status !== "failed" && item.status !== "canceled")) return;
      const c = controls.get(id);
      if (c) {
        c.paused = false;
        c.canceled = false;
      }
      patchItem(id, { status: "queued", error: undefined });
      pump();
    },
    cancelItem: (id) => {
      const c = controls.get(id);
      if (c) c.canceled = true;
      const item = get().queue.find((it) => it.id === id);
      if (item && (item.status === "queued" || item.status === "paused")) {
        resumes.delete(id);
        patchItem(id, { status: "canceled" });
      }
    },
    retryItem: (id) => {
      resumes.delete(id); // a fresh attempt from scratch
      const c = controls.get(id);
      if (c) {
        c.paused = false;
        c.canceled = false;
      }
      patchItem(id, { status: "queued", uploaded: 0, error: undefined });
      pump();
    },
    retryFailed: () => {
      for (const it of get().queue) if (it.status === "failed") get().retryItem(it.id);
    },
    removeItem: (id) => {
      controls.delete(id);
      resumes.delete(id);
      lastEmit.delete(id);
      set((s) => ({ queue: s.queue.filter((it) => it.id !== id) }));
    },
    clearFinished: () => {
      // Free the module-level maps for every row we drop, so they don't grow unbounded over a session.
      for (const it of get().queue) {
        if (it.status === "completed" || it.status === "canceled") {
          controls.delete(it.id);
          resumes.delete(it.id);
          lastEmit.delete(it.id);
        }
      }
      set((s) => ({ queue: s.queue.filter((it) => it.status !== "completed" && it.status !== "canceled") }));
    },
    skipDuplicates: () => {
      for (const it of get().queue) if (it.duplicate && it.status === "queued") get().cancelItem(it.id);
    },
  };
});
