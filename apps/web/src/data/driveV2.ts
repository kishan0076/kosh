import { create } from "zustand";
import { uid } from "@/lib/ids";
import { driveApi, resumableUpload, type DriveAccount, type DriveQuota, type ResumableControl } from "./driveApi";
import { driveV2Api, hasFullDrive, type DriveChange, type DriveNode, type SearchParams, type SharedDrive } from "./driveV2Api";
import { useUi, type Toast } from "./ui";

/** Push a toast without a React hook (store actions run outside components). */
function pushToast(t: Omit<Toast, "id">): void {
  useUi.getState().toast(t);
}
function toastErr(message: string): void {
  useUi.getState().toast({ message, tone: "danger" });
}

export type DriveView = "myDrive" | "recent" | "starred" | "trash" | "shared" | "search";
export type Layout = "grid" | "list";
export type SortKey = "name" | "modified" | "size" | "kind";
export type SortDir = "asc" | "desc";
export type FilterKind = "folder" | "doc" | "image" | "video" | "pdf" | "audio" | "archive";

export type Dialog =
  | { kind: "newFolder"; parentId: string }
  | { kind: "delete"; ids: string[]; permanent: boolean }
  | { kind: "move"; ids: string[] }
  | { kind: "share"; node: DriveNode }
  | { kind: "rename-bulk"; ids: string[] }
  | { kind: "revisions"; node: DriveNode }
  | null;

export interface UploadTask {
  id: string;
  name: string;
  size: number;
  uploaded: number;
  status: "uploading" | "done" | "error" | "canceled";
  error?: string;
}

interface ViewPrefs {
  layout: Layout;
  sortKey: SortKey;
  sortDir: SortDir;
  filterKind: FilterKind | null;
}

/** Live-sync status shown in the toolbar. */
export type SyncStatus = "off" | "live" | "syncing" | "error";
export interface SyncState {
  status: SyncStatus;
  lastAt: number | null; // ms epoch of the last successful poll
  applied: number; // running count of changes applied this session
}

/** One entry in the activity/changes timeline (exportable as an audit log). */
export interface ActivityEntry {
  fileId: string;
  name: string;
  action: "edited" | "created" | "trashed" | "removed";
  time: string; // ISO
  isFolder: boolean;
}

interface DriveV2State {
  status: "loading" | "ready" | "error";
  error: string | null;
  configured: boolean;
  fullAccess: boolean;

  accounts: DriveAccount[];
  accountId: string | null;
  scopeOk: boolean;

  view: DriveView;
  path: { id: string; name: string }[];

  nodes: DriveNode[];
  nextPageToken?: string;
  listLoading: boolean;
  loadingMore: boolean;
  listError: string | null;

  prefs: ViewPrefs;
  searchQuery: string;
  searchStarredOnly: boolean;

  selection: Set<string>;
  lastClickedId: string | null;

  detailsId: string | null;
  detailsNode: DriveNode | null;
  detailsLoading: boolean;
  previewNode: DriveNode | null;

  quota: DriveQuota | null;
  busyIds: Set<string>;
  dialog: Dialog;
  uploads: UploadTask[];
  insightsOpen: boolean;
  setInsights: (v: boolean) => void;

  // Shared Drives (spaces): null spaceId = My Drive.
  spaces: SharedDrive[];
  spaceId: string | null;
  spaceName: string | null;

  // Live two-way sync (changes.list polling) + activity timeline.
  sync: SyncState;
  activity: ActivityEntry[];
  activityOpen: boolean;
  setActivity: (v: boolean) => void;
  clearActivity: () => void;

  init: () => Promise<void>;
  selectAccount: (id: string) => Promise<void>;
  selectSpace: (id: string | null) => Promise<void>;
  startSync: () => void;
  stopSync: () => void;
  reconnectUrl: () => string;

  setView: (v: DriveView) => void;
  openFolder: (node: DriveNode) => void;
  loadPath: (folderId: string, name?: string) => Promise<void>;
  breadcrumbTo: (index: number) => void;
  goRoot: () => void;

  load: (force?: boolean) => Promise<void>;
  loadMore: () => Promise<void>;
  loadQuota: () => Promise<void>;
  loadDetails: (id: string | null) => Promise<void>;

  setLayout: (l: Layout) => void;
  setSort: (key: SortKey) => void;
  setFilter: (k: FilterKind | null) => void;
  runSearch: (text: string) => void;
  setSearchStarred: (v: boolean) => void;
  clearSearch: () => void;

  toggleSelect: (id: string, mods: { shift?: boolean; meta?: boolean }, orderedIds: string[]) => void;
  selectAll: (orderedIds: string[]) => void;
  marqueeSelect: (ids: string[]) => void;
  clearSelection: () => void;

  openDialog: (d: Dialog) => void;
  closeDialog: () => void;
  setPreview: (node: DriveNode | null) => void;

  createFolder: (input: { name: string; parentId: string; folderColorRgb?: string; description?: string }) => Promise<void>;
  rename: (id: string, name: string) => Promise<void>;
  toggleStar: (id: string) => Promise<void>;
  trash: (ids: string[]) => Promise<void>;
  restore: (ids: string[]) => Promise<void>;
  deletePermanent: (ids: string[]) => Promise<void>;
  move: (ids: string[], destId: string) => Promise<void>;
  copy: (id: string) => Promise<void>;
  copyFolder: (id: string) => Promise<void>;
  updateMeta: (id: string, patch: { description?: string; folderColorRgb?: string }) => Promise<void>;
  emptyTrash: () => Promise<void>;
  uploadFiles: (files: File[]) => Promise<void>;
  downloadRevision: (fileId: string, revId: string, filename: string) => Promise<void>;
}

/* ── module-level (no re-render) ── */
const CACHE_TTL = 30_000;
const folderCache = new Map<string, { nodes: DriveNode[]; nextPageToken?: string; ts: number }>();
let tokenCache: { accountId: string; token: string; exp: number } | null = null;
let loadSeq = 0; // bumped on every navigation/load so slow mutations never clobber newer views
const uploadControls = new Map<string, ResumableControl>();

/* Live-sync controller (module-level so it survives re-renders; driven by the page's mount effect). */
const SYNC_INTERVAL = 12_000; // poll cadence when the tab is visible
const ACTIVITY_CAP = 200;
let syncActive = false;
let syncTimer: ReturnType<typeof setTimeout> | null = null;
let syncToken: string | null = null; // changes.list page token ("where we are")
let syncGen = 0; // bumped on account/space switch + stop; a stale in-flight poll must not write state
let syncInFlight = false; // re-entrancy guard so a refocus can't run two concurrent polls

const PREFS_KEY = "kosh.driveV2.prefs";
const DEFAULT_PREFS: ViewPrefs = { layout: "grid", sortKey: "name", sortDir: "asc", filterKind: null };
function loadPrefs(): ViewPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? { ...DEFAULT_PREFS, ...JSON.parse(raw) } : DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
}
function savePrefs(p: ViewPrefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* private mode — ignore */
  }
}

/** The folder currently browsed: the deepest breadcrumb, else the space root (Shared Drive id or "root"). */
const currentFolderId = (path: { id: string }[], spaceId: string | null = null) => path.at(-1)?.id ?? spaceId ?? "root";

/** Map `type:` operator values to a Drive mime filter. */
const TYPE_MAP: Record<string, { exact?: string; contains?: string }> = {
  pdf: { exact: "application/pdf" },
  image: { contains: "image/" },
  video: { contains: "video/" },
  audio: { contains: "audio/" },
  doc: { contains: "document" },
  sheet: { contains: "spreadsheet" },
  slide: { contains: "presentation" },
  zip: { contains: "zip" },
  folder: { exact: "application/vnd.google-apps.folder" },
};

/** Parse a search box query with operators (type: owner: before: after: is:starred) into API params. */
export function parseSearch(query: string, ownerMe?: string): SearchParams {
  const params: SearchParams = {};
  const free: string[] = [];
  const toDate = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00` : v);
  for (const tok of query.trim().split(/\s+/).filter(Boolean)) {
    const m = tok.match(/^(\w+):(.+)$/);
    if (!m) { free.push(tok); continue; }
    const key = m[1]!.toLowerCase();
    const val = m[2]!;
    if (key === "type") {
      const mt = TYPE_MAP[val.toLowerCase()];
      if (mt?.exact) params.mimeType = mt.exact;
      else if (mt?.contains) params.mimeContains = mt.contains;
      else free.push(tok);
    } else if (key === "owner") params.owner = val.toLowerCase() === "me" ? ownerMe ?? "me" : val;
    else if (key === "before") params.before = toDate(val);
    else if (key === "after") params.after = toDate(val);
    else if (key === "is" && val.toLowerCase() === "starred") params.starred = true;
    else if (key === "starred") params.starred = val === "true";
    else free.push(tok);
  }
  if (free.length) params.text = free.join(" ");
  return params;
}

export const useDriveV2 = create<DriveV2State>((set, get) => {
  async function ensureToken(accountId: string): Promise<string> {
    if (tokenCache && tokenCache.accountId === accountId && tokenCache.exp > Date.now() + 60_000) return tokenCache.token;
    const { accessToken, expiresIn } = await driveApi.mintToken(accountId);
    tokenCache = { accountId, token: accessToken, exp: Date.now() + expiresIn * 1000 };
    return accessToken;
  }

  function selectedAccount(): DriveAccount | undefined {
    return get().accounts.find((a) => a.id === get().accountId);
  }
  function computeScopeOk(): boolean {
    return get().fullAccess && hasFullDrive(selectedAccount()?.scope);
  }

  function cacheKey(view: DriveView, folderId: string): string {
    return `${get().accountId}:${get().spaceId ?? ""}:${view}:${view === "myDrive" ? folderId : ""}`;
  }

  /** Fetch the current view's first page, cache-first for My Drive. */
  async function load(force = false): Promise<void> {
    const { accountId, view, path, searchQuery, searchStarredOnly, spaceId } = get();
    if (!accountId || !get().scopeOk) return;
    const folderId = currentFolderId(path, spaceId);
    const driveId = spaceId ?? undefined;
    const key = cacheKey(view, folderId);
    const myseq = ++loadSeq;

    // Cache only My Drive folders (time-sensitive views are always refetched).
    if (!force && view === "myDrive") {
      const cached = folderCache.get(key);
      if (cached && Date.now() - cached.ts < CACHE_TTL) {
        set({ nodes: cached.nodes, nextPageToken: cached.nextPageToken, listLoading: false, listError: null });
        return;
      }
    }
    set({ listLoading: true, listError: null });
    try {
      let result;
      if (view === "myDrive") result = await driveV2Api.list(accountId, folderId, { driveId });
      else if (view === "recent") result = await driveV2Api.recent(accountId, { driveId });
      else if (view === "starred") result = await driveV2Api.starred(accountId, { driveId });
      else if (view === "trash") result = await driveV2Api.trash(accountId, { driveId });
      else if (view === "shared") result = await driveV2Api.sharedWithMe(accountId);
      else {
        const p = parseSearch(searchQuery, selectedAccount()?.email);
        if (searchStarredOnly) p.starred = true;
        p.driveId = driveId;
        result = await driveV2Api.search(accountId, p);
      }
      if (myseq !== loadSeq) return; // superseded by a newer navigation
      set({ nodes: result.files, nextPageToken: result.nextPageToken, listLoading: false });
      if (view === "myDrive") folderCache.set(key, { nodes: result.files, nextPageToken: result.nextPageToken, ts: Date.now() });
    } catch (err) {
      if (myseq !== loadSeq) return;
      set({ listLoading: false, listError: err instanceof Error ? err.message : "Couldn't load your Drive." });
    }
  }

  /** Snapshot → optimistic patch → call → reconcile/rollback, guarded by loadSeq. */
  async function mutate(
    ids: string[],
    optimistic: (nodes: DriveNode[]) => DriveNode[],
    call: () => Promise<void>,
    opts: { refreshQuota?: boolean; invalidate?: string[]; onError?: (msg: string) => void } = {},
  ): Promise<boolean> {
    const before = get().nodes;
    const seq = loadSeq;
    set((s) => ({ nodes: optimistic(s.nodes), busyIds: new Set([...s.busyIds, ...ids]) }));
    try {
      await call();
      // Invalidate affected caches so the next visit is authoritative.
      for (const k of opts.invalidate ?? []) folderCache.delete(k);
      if (opts.refreshQuota) void get().loadQuota();
      set((s) => ({ busyIds: withoutIds(s.busyIds, ids) }));
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "That action failed.";
      // Roll back only if the view hasn't moved on.
      if (seq === loadSeq) set((s) => ({ nodes: before, busyIds: withoutIds(s.busyIds, ids) }));
      else set((s) => ({ busyIds: withoutIds(s.busyIds, ids) }));
      (opts.onError ?? ((m) => toastErr(m)))(msg);
      return false;
    }
  }

  function invalidateFolderViews() {
    // Drop the time-sensitive caches (recent/starred/trash aren't cached, so this clears My Drive dirs).
    for (const k of [...folderCache.keys()]) if (k.startsWith(`${get().accountId}:`) && k.includes(":myDrive:")) folderCache.delete(k);
  }

  /** Fetch the account's Shared Drives for the space picker (non-fatal — many accounts have none). */
  async function loadSpaces(): Promise<void> {
    const accountId = get().accountId;
    if (!accountId || !get().scopeOk) return;
    try {
      const { drives } = await driveV2Api.drives(accountId);
      if (get().accountId === accountId) set({ spaces: drives });
    } catch {
      /* Shared Drives are optional — ignore (e.g. consumer accounts return none). */
    }
  }

  /** Fold a batch of Drive changes into the live view + the activity timeline (two-way sync). */
  function applyChanges(changes: DriveChange[]): void {
    if (!changes.length) return;
    const entries: ActivityEntry[] = [];
    set((s) => {
      let nodes = s.nodes;
      let detailsNode = s.detailsNode;
      const folderId = currentFolderId(s.path, s.spaceId);
      const now = new Date().toISOString();
      for (const c of changes) {
        const idx = nodes.findIndex((n) => n.id === c.fileId);
        const known = nodes[idx];
        const gone = c.removed || c.file?.trashed;
        // Node mutation is view-scoped; the activity log records EVERY change in the corpus.
        if (gone) {
          if (idx !== -1 && s.view !== "trash") nodes = nodes.filter((n) => n.id !== c.fileId);
          if (detailsNode?.id === c.fileId) detailsNode = null;
          entries.push({ fileId: c.fileId, name: known?.name ?? c.file?.name ?? "A file", action: c.removed ? "removed" : "trashed", time: c.time ?? now, isFolder: known?.isFolder ?? c.file?.isFolder ?? false });
        } else if (c.file) {
          const isNewChild = idx === -1 && s.view === "myDrive" && (c.file.parents ?? []).includes(folderId);
          if (idx !== -1) nodes = nodes.map((n) => (n.id === c.fileId ? c.file! : n)); // external edit → reflect it
          else if (isNewChild) nodes = [c.file, ...nodes]; // a new child of the folder we're looking at
          if (detailsNode?.id === c.fileId) detailsNode = c.file;
          entries.push({ fileId: c.fileId, name: c.file.name, action: isNewChild ? "created" : "edited", time: c.time ?? now, isFolder: c.file.isFolder });
        }
      }
      const activity = entries.length ? [...entries.reverse(), ...s.activity].slice(0, ACTIVITY_CAP) : s.activity;
      return { nodes, detailsNode, activity };
    });
    invalidateFolderViews(); // next navigation refetches authoritative state
  }

  /** One sync poll: (re)establish a page token if needed, else fetch+apply changes and advance it. */
  async function syncTick(): Promise<void> {
    if (syncInFlight) return; // a poll is already running; it reschedules itself when done
    const gen = syncGen; // capture the corpus generation; discard writes if it changes mid-flight
    const { accountId, scopeOk, spaceId } = get();
    const visible = typeof document === "undefined" || document.visibilityState === "visible";
    let nextDelay = SYNC_INTERVAL;
    if (syncActive && accountId && scopeOk && visible) {
      syncInFlight = true;
      try {
        if (!syncToken) {
          // First tick after start / account / space switch — anchor at "now".
          const { startPageToken } = await driveV2Api.changesStart(accountId, spaceId ?? undefined);
          if (gen === syncGen) {
            syncToken = startPageToken;
            set((s) => ({ sync: { status: "live", lastAt: Date.now(), applied: s.sync.applied } }));
          }
        } else {
          set((s) => ({ sync: { ...s.sync, status: "syncing" } }));
          const { changes, newStartPageToken, nextPageToken } = await driveV2Api.changes(accountId, syncToken, spaceId ?? undefined);
          // Account/space switched mid-flight → this batch + token belong to the old corpus. Drop them.
          if (gen === syncGen) {
            applyChanges(changes);
            syncToken = nextPageToken ?? newStartPageToken ?? syncToken;
            set((s) => ({ sync: { status: "live", lastAt: Date.now(), applied: s.sync.applied + changes.length } }));
            if (nextPageToken) nextDelay = 300; // more pages queued — drain promptly
          }
        }
      } catch {
        if (gen === syncGen) set((s) => ({ sync: { ...s.sync, status: "error" } }));
      } finally {
        syncInFlight = false;
      }
    }
    scheduleSync(nextDelay);
  }

  function scheduleSync(delay: number): void {
    if (!syncActive) return;
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(() => void syncTick(), delay);
  }

  return {
    status: "loading",
    error: null,
    configured: false,
    fullAccess: false,
    accounts: [],
    accountId: null,
    scopeOk: false,
    view: "myDrive",
    path: [],
    nodes: [],
    nextPageToken: undefined,
    listLoading: false,
    loadingMore: false,
    listError: null,
    prefs: loadPrefs(),
    searchQuery: "",
    searchStarredOnly: false,
    selection: new Set(),
    lastClickedId: null,
    detailsId: null,
    detailsNode: null,
    detailsLoading: false,
    previewNode: null,
    quota: null,
    busyIds: new Set(),
    dialog: null,
    uploads: [],
    insightsOpen: false,
    setInsights: (v) => set(v ? { insightsOpen: true, activityOpen: false } : { insightsOpen: false }),

    spaces: [],
    spaceId: null,
    spaceName: null,
    sync: { status: "off", lastAt: null, applied: 0 },
    activity: [],
    activityOpen: false,
    setActivity: (v) => set(v ? { activityOpen: true, insightsOpen: false } : { activityOpen: false }),
    clearActivity: () => set({ activity: [] }),

    init: async () => {
      set({ status: "loading", error: null });
      try {
        const [cfg, acc] = await Promise.all([driveApi.config(), driveApi.listAccounts()]);
        set({ configured: cfg.configured, fullAccess: cfg.fullAccess, accounts: acc.accounts, status: "ready" });
        const first = acc.accounts[0];
        if (first) {
          set({ accountId: first.id });
          set({ scopeOk: computeScopeOk() });
          if (get().scopeOk) await Promise.all([load(), get().loadQuota(), loadSpaces()]);
        }
      } catch (err) {
        set({ status: "error", error: err instanceof Error ? err.message : "Couldn't reach the Drive service." });
      }
    },

    selectAccount: async (id) => {
      tokenCache = null;
      syncToken = null; syncGen++; // new corpus → re-anchor sync; invalidate any in-flight poll
      set({ accountId: id, path: [], view: "myDrive", nodes: [], selection: new Set(), detailsId: null, detailsNode: null, quota: null, insightsOpen: false, spaces: [], spaceId: null, spaceName: null, activity: [] });
      set({ scopeOk: computeScopeOk() });
      if (get().scopeOk) await Promise.all([load(true), get().loadQuota(), loadSpaces()]);
    },

    selectSpace: async (id) => {
      syncToken = null; syncGen++; // switching spaces re-anchors the change feed; invalidate in-flight poll
      const space = id ? get().spaces.find((d) => d.id === id) ?? null : null;
      set({ spaceId: id, spaceName: space?.name ?? null, path: [], view: "myDrive", nodes: [], selection: new Set(), detailsId: null, detailsNode: null, insightsOpen: false, activityOpen: false });
      await load(true);
    },

    startSync: () => {
      if (!get().accountId || !get().scopeOk) { set({ sync: { status: "off", lastAt: null, applied: 0 } }); return; }
      syncActive = true;
      set((s) => ({ sync: { ...s.sync, status: s.sync.status === "off" ? "syncing" : s.sync.status } }));
      scheduleSync(0); // kick immediately (first tick anchors the page token)
    },
    stopSync: () => {
      syncActive = false;
      syncGen++; // any in-flight poll must discard its writes
      if (syncTimer) { clearTimeout(syncTimer); syncTimer = null; }
      set((s) => ({ sync: { ...s.sync, status: "off" } }));
    },

    reconnectUrl: () => driveApi.connectUrl(),

    setView: (v) => {
      set({ insightsOpen: false, activityOpen: false });
      if (v === get().view && v !== "search") return;
      // path is preserved across views so returning to My Drive restores the last folder.
      set({ view: v, selection: new Set(), detailsId: null, detailsNode: null });
      if (v !== "search") set({ searchQuery: "" });
      void load();
    },

    openFolder: (node) => {
      set({ insightsOpen: false });
      // In-hierarchy (My Drive) navigation just pushes; opening a folder from another view
      // (Recent/Search/Starred) hydrates the breadcrumb from the server so it's correct.
      if (get().view === "myDrive") {
        set((s) => ({ path: [...s.path, { id: node.id, name: node.name }], selection: new Set(), detailsId: null }));
        void load();
      } else {
        set({ view: "myDrive", selection: new Set(), detailsId: null });
        void get().loadPath(node.id, node.name);
      }
    },

    loadPath: async (folderId, name) => {
      const accountId = get().accountId;
      if (!accountId) return;
      set({ view: "myDrive" });
      try {
        const { path } = await driveV2Api.path(accountId, folderId);
        set({ path });
      } catch {
        // Breadcrumb hydration failed — keep the user INSIDE the folder they opened (with its name if
        // we have it) instead of silently dumping them back at My Drive root.
        set({ path: folderId === "root" ? [] : [{ id: folderId, name: name ?? "Folder" }] });
      }
      void load(true);
    },
    breadcrumbTo: (index) => {
      set((s) => ({ path: s.path.slice(0, index + 1), selection: new Set() }));
      void load();
    },
    goRoot: () => {
      set({ path: [], selection: new Set() });
      void load();
    },

    load,
    loadMore: async () => {
      const { accountId, view, path, nextPageToken, searchQuery, searchStarredOnly, loadingMore, spaceId } = get();
      if (!accountId || !nextPageToken || loadingMore) return;
      set({ loadingMore: true });
      const seq = loadSeq;
      const driveId = spaceId ?? undefined;
      try {
        let result;
        const folderId = currentFolderId(path, spaceId);
        if (view === "myDrive") result = await driveV2Api.list(accountId, folderId, { pageToken: nextPageToken, driveId });
        else if (view === "recent") result = await driveV2Api.recent(accountId, { pageToken: nextPageToken, driveId });
        else if (view === "starred") result = await driveV2Api.starred(accountId, { pageToken: nextPageToken, driveId });
        else if (view === "trash") result = await driveV2Api.trash(accountId, { pageToken: nextPageToken, driveId });
        else if (view === "shared") result = await driveV2Api.sharedWithMe(accountId, { pageToken: nextPageToken });
        else {
          const p = parseSearch(searchQuery, selectedAccount()?.email);
          if (searchStarredOnly) p.starred = true;
          p.pageToken = nextPageToken;
          p.driveId = driveId;
          result = await driveV2Api.search(accountId, p);
        }
        if (seq !== loadSeq) { set({ loadingMore: false }); return; } // superseded — still clear the flag
        set((s) => ({ nodes: [...s.nodes, ...result.files], nextPageToken: result.nextPageToken, loadingMore: false }));
      } catch {
        set({ loadingMore: false });
      }
    },

    loadQuota: async () => {
      const accountId = get().accountId;
      if (!accountId) return;
      try {
        const { quota } = await driveApi.about(accountId);
        set({ quota });
      } catch {
        /* non-fatal */
      }
    },

    loadDetails: async (id) => {
      if (!id) {
        set({ detailsId: null, detailsNode: null });
        return;
      }
      const accountId = get().accountId;
      if (!accountId) return;
      const local = get().nodes.find((n) => n.id === id) ?? null;
      set({ detailsId: id, detailsNode: local, detailsLoading: true });
      try {
        const { file } = await driveV2Api.getFile(accountId, id);
        if (get().detailsId === id) set({ detailsNode: file, detailsLoading: false });
      } catch {
        set({ detailsLoading: false });
      }
    },

    setLayout: (l) => set((s) => { const prefs = { ...s.prefs, layout: l }; savePrefs(prefs); return { prefs }; }),
    setSort: (key) =>
      set((s) => {
        const sortDir: SortDir = s.prefs.sortKey === key && s.prefs.sortDir === "asc" ? "desc" : "asc";
        const prefs = { ...s.prefs, sortKey: key, sortDir };
        savePrefs(prefs);
        return { prefs };
      }),
    setFilter: (k) => set((s) => { const prefs = { ...s.prefs, filterKind: k }; savePrefs(prefs); return { prefs }; }),

    runSearch: (text) => {
      set({ searchQuery: text, view: "search" });
      void load(true);
    },
    setSearchStarred: (v) => {
      set({ searchStarredOnly: v });
      if (get().view === "search") void load(true);
    },
    clearSearch: () => {
      set({ searchQuery: "", view: "myDrive" });
      void load();
    },

    toggleSelect: (id, mods, orderedIds) => {
      set((s) => {
        const next = new Set(s.selection);
        if (mods.shift && s.lastClickedId) {
          const a = orderedIds.indexOf(s.lastClickedId);
          const b = orderedIds.indexOf(id);
          if (a !== -1 && b !== -1) {
            const [lo, hi] = a < b ? [a, b] : [b, a];
            for (let i = lo; i <= hi; i++) next.add(orderedIds[i]!);
            return { selection: next };
          }
        }
        if (mods.meta) {
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return { selection: next, lastClickedId: id };
        }
        return { selection: new Set([id]), lastClickedId: id };
      });
    },
    selectAll: (orderedIds) => set({ selection: new Set(orderedIds) }),
    marqueeSelect: (ids) => set({ selection: new Set(ids) }),
    clearSelection: () => set({ selection: new Set() }),

    openDialog: (d) => set({ dialog: d }),
    closeDialog: () => set({ dialog: null }),
    setPreview: (node) => set({ previewNode: node }),

    createFolder: async (input) => {
      const accountId = get().accountId;
      if (!accountId) return;
      const tmpId = uid("tmp");
      const placeholder: DriveNode = { id: tmpId, name: input.name, mimeType: "application/vnd.google-apps.folder", isFolder: true, folderColorRgb: input.folderColorRgb, description: input.description, capabilities: {} };
      const seq = loadSeq;
      set((s) => ({ nodes: [placeholder, ...s.nodes] }));
      try {
        const { file } = await driveV2Api.createFolder(accountId, input);
        invalidateFolderViews();
        if (seq === loadSeq) set((s) => ({ nodes: s.nodes.map((n) => (n.id === tmpId ? file : n)) }));
      } catch (err) {
        if (seq === loadSeq) set((s) => ({ nodes: s.nodes.filter((n) => n.id !== tmpId) }));
        toastErr(err instanceof Error ? err.message : "Couldn't create the folder.");
        throw err;
      }
    },

    rename: async (id, name) => {
      const accountId = get().accountId;
      if (!accountId) return;
      await mutate([id], (nodes) => nodes.map((n) => (n.id === id ? { ...n, name } : n)), async () => {
        const { file } = await driveV2Api.rename(accountId, id, name);
        set((s) => ({ nodes: s.nodes.map((n) => (n.id === id ? file : n)), detailsNode: s.detailsId === id ? file : s.detailsNode }));
        invalidateFolderViews(); // else re-navigating within the 30s cache TTL shows the old name
      });
    },

    toggleStar: async (id) => {
      const accountId = get().accountId;
      if (!accountId) return;
      const node = get().nodes.find((n) => n.id === id);
      const starred = !node?.starred;
      await mutate(
        [id],
        (nodes) => nodes.map((n) => (n.id === id ? { ...n, starred } : n)).filter((n) => (get().view === "starred" && !starred ? n.id !== id : true)),
        async () => {
          await driveV2Api.setStar(accountId, id, starred);
          invalidateFolderViews(); // keep the cached folder in sync with the star change
        },
      );
    },

    trash: async (ids) => {
      const accountId = get().accountId;
      if (!accountId) return;
      const ok = await bulk(ids, (id) => driveV2Api.setTrash(accountId, id, true), (nodes, done) => nodes.filter((n) => !done.has(n.id)));
      invalidateFolderViews();
      set({ selection: new Set() });
      if (ok.done.length) {
        pushToast({ message: `Moved ${ok.done.length} item${ok.done.length === 1 ? "" : "s"} to trash`, tone: "default", action: { label: "Undo", onClick: () => void get().restore(ok.done) } });
      }
      if (ok.failed.length) toastErr(`${ok.failed.length} item${ok.failed.length === 1 ? "" : "s"} couldn't be moved to trash.`);
    },

    restore: async (ids) => {
      const accountId = get().accountId;
      if (!accountId) return;
      const ok = await bulk(ids, (id) => driveV2Api.setTrash(accountId, id, false), (nodes, done) => nodes.filter((n) => !done.has(n.id)));
      invalidateFolderViews();
      set({ selection: new Set() });
      if (get().view === "trash") void load(true);
      if (ok.done.length) pushToast({ message: `Restored ${ok.done.length} item${ok.done.length === 1 ? "" : "s"}`, tone: "ok" });
      if (ok.failed.length) toastErr(`${ok.failed.length} couldn't be restored.`);
    },

    deletePermanent: async (ids) => {
      const accountId = get().accountId;
      if (!accountId) return;
      const ok = await bulk(ids, (id) => driveV2Api.deletePermanent(accountId, id), (nodes, done) => nodes.filter((n) => !done.has(n.id)));
      set({ selection: new Set() });
      void get().loadQuota();
      if (ok.done.length) pushToast({ message: `Permanently deleted ${ok.done.length} item${ok.done.length === 1 ? "" : "s"}`, tone: "default" });
      if (ok.failed.length) toastErr(`${ok.failed.length} couldn't be deleted.`);
    },

    move: async (ids, destId) => {
      const accountId = get().accountId;
      if (!accountId) return;
      // Skip items already in the destination — otherwise a same-folder "move" (e.g. dropping onto the
      // current folder's breadcrumb) would optimistically remove them from the view for no reason.
      const snapshot = get().nodes;
      const targets = ids.filter((id) => !(snapshot.find((n) => n.id === id)?.parents ?? []).includes(destId));
      if (!targets.length) {
        set({ selection: new Set() });
        return;
      }
      // Detach from each item's REAL parents (not the current view folder) — otherwise a move from
      // Recent/Starred/Search leaves the file in its original folder (duplicated across two parents).
      const ok = await bulk(
        targets,
        (id) => {
          const removeParents = (snapshot.find((n) => n.id === id)?.parents ?? []).filter((p) => p !== destId);
          return driveV2Api.move(accountId, id, [destId], removeParents);
        },
        (nodes, done) => nodes.filter((n) => !done.has(n.id)),
      );
      invalidateFolderViews();
      set({ selection: new Set() });
      if (ok.done.length) pushToast({ message: `Moved ${ok.done.length} item${ok.done.length === 1 ? "" : "s"}`, tone: "ok" });
      if (ok.failed.length) toastErr(`${ok.failed.length} couldn't be moved.`);
    },

    copy: async (id) => {
      const accountId = get().accountId;
      if (!accountId) return;
      await mutate([id], (nodes) => nodes, async () => {
        const { file } = await driveV2Api.copy(accountId, id, {});
        invalidateFolderViews();
        set((s) => ({ nodes: [file, ...s.nodes] }));
      }, { refreshQuota: true });
      pushToast({ message: "Copy created", tone: "ok" });
    },

    copyFolder: async (id) => {
      const accountId = get().accountId;
      if (!accountId) return;
      const src = get().nodes.find((n) => n.id === id);
      if (!src) return;
      const destParent = currentFolderId(get().path, get().spaceId);
      pushToast({ message: `Copying “${src.name}”…`, tone: "default" });
      let ops = 0;
      const CAP = 500; // safety ceiling so a huge tree can't run away
      async function copyInto(srcFolderId: string, destFolderId: string): Promise<void> {
        let pageToken: string | undefined;
        do {
          const res = await driveV2Api.list(accountId!, srcFolderId, { pageToken });
          for (const child of res.files) {
            if (ops >= CAP) return;
            ops++;
            if (child.isFolder) {
              const { file } = await driveV2Api.createFolder(accountId!, { name: child.name, parentId: destFolderId });
              await copyInto(child.id, file.id);
            } else {
              await driveV2Api.copy(accountId!, child.id, { parents: [destFolderId] });
            }
          }
          pageToken = res.nextPageToken;
        } while (pageToken && ops < CAP);
      }
      try {
        const { file: root } = await driveV2Api.createFolder(accountId, { name: `Copy of ${src.name}`, parentId: destParent });
        await copyInto(src.id, root.id);
        invalidateFolderViews();
        if (get().view === "myDrive") void load(true);
        void get().loadQuota();
        pushToast({ message: ops >= CAP ? `Copied ${CAP}+ items (stopped at the limit)` : `Copied “${src.name}”`, tone: ops >= CAP ? "warn" : "ok" });
      } catch (err) {
        toastErr(err instanceof Error ? err.message : "Couldn't copy the folder.");
      }
    },

    updateMeta: async (id, patch) => {
      const accountId = get().accountId;
      if (!accountId) return;
      // Patch the open details panel optimistically too — otherwise saved notes flicker back to the
      // old value until the server responds. Rolled back with the nodes on failure.
      const beforeDetails = get().detailsNode;
      if (get().detailsId === id && beforeDetails) set({ detailsNode: { ...beforeDetails, ...patch } });
      await mutate(
        [id],
        (nodes) => nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)),
        async () => {
          const { file } = await driveV2Api.updateMeta(accountId, id, patch);
          set((s) => ({ nodes: s.nodes.map((n) => (n.id === id ? file : n)), detailsNode: s.detailsId === id ? file : s.detailsNode }));
          invalidateFolderViews();
        },
        { onError: (m) => { if (get().detailsId === id) set({ detailsNode: beforeDetails }); toastErr(m); } },
      );
    },

    emptyTrash: async () => {
      const accountId = get().accountId;
      if (!accountId) return;
      try {
        await driveV2Api.emptyTrash(accountId);
        set({ nodes: [], selection: new Set() });
        void get().loadQuota();
        pushToast({ message: "Trash emptied", tone: "default" });
      } catch (err) {
        toastErr(err instanceof Error ? err.message : "Couldn't empty trash.");
      }
    },

    uploadFiles: async (files) => {
      const accountId = get().accountId;
      if (!accountId || !files.length) return;
      const folderId = currentFolderId(get().path, get().spaceId);
      const token = await ensureToken(accountId).catch(() => null);
      if (!token) {
        toastErr("Couldn't start the upload — reconnect the account.");
        return;
      }
      for (const file of files) {
        const id = uid("up");
        const control: ResumableControl = { paused: false, canceled: false };
        uploadControls.set(id, control);
        set((s) => ({ uploads: [{ id, name: file.name, size: file.size, uploaded: 0, status: "uploading" }, ...s.uploads] }));
        try {
          await resumableUpload({
            accessToken: token,
            file,
            name: file.name,
            mimeType: file.type || "application/octet-stream",
            folderId,
            control,
            onProgress: (b) => set((s) => ({ uploads: s.uploads.map((u) => (u.id === id ? { ...u, uploaded: b } : u)) })),
            getFreshToken: () => ensureToken(accountId),
          });
          set((s) => ({ uploads: s.uploads.map((u) => (u.id === id ? { ...u, uploaded: u.size, status: "done" } : u)) }));
        } catch (err) {
          set((s) => ({ uploads: s.uploads.map((u) => (u.id === id ? { ...u, status: "error", error: err instanceof Error ? err.message : "Upload failed" } : u)) }));
        } finally {
          uploadControls.delete(id);
        }
      }
      invalidateFolderViews();
      void get().loadQuota();
      if (get().view === "myDrive") void load(true);
    },

    downloadRevision: async (fileId, revId, filename) => {
      const accountId = get().accountId;
      if (!accountId) return;
      try {
        // Bytes fetched browser→Google directly with a short-lived token (same path as uploads) —
        // the revision content never proxies through the API.
        const token = await ensureToken(accountId);
        const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/revisions/${encodeURIComponent(revId)}?alt=media&supportsAllDrives=true`;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) throw new Error(`Download failed (${res.status})`);
        const blob = await res.blob();
        const objectUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = objectUrl;
        a.download = filename || "version";
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(objectUrl);
        pushToast({ message: "Version downloaded", tone: "ok" });
      } catch {
        toastErr("Couldn't download that version. Google-native docs (Docs/Sheets/Slides) keep history in Drive itself.");
      }
    },
  };
});

/* ── helpers ── */
function withoutIds(set: Set<string>, ids: string[]): Set<string> {
  const next = new Set(set);
  for (const id of ids) next.delete(id);
  return next;
}

/** Run per-id calls at bounded concurrency; remove succeeded ids optimistically, keep failures. */
async function bulk(
  ids: string[],
  call: (id: string) => Promise<unknown>,
  apply: (nodes: DriveNode[], done: Set<string>) => DriveNode[],
): Promise<{ done: string[]; failed: string[] }> {
  const store = useDriveV2;
  const done: string[] = [];
  const failed: string[] = [];
  store.setState((s) => ({ busyIds: new Set([...s.busyIds, ...ids]) }));
  const LIMIT = 4;
  let i = 0;
  async function worker() {
    while (i < ids.length) {
      const id = ids[i++]!;
      try {
        await call(id);
        done.push(id);
      } catch {
        failed.push(id);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(LIMIT, ids.length) }, worker));
  const doneSet = new Set(done);
  // Apply removals for the succeeded ids to the current nodes, then clear busy.
  store.setState((s) => ({ nodes: apply(s.nodes, doneSet), busyIds: withoutIds(s.busyIds, ids) }));
  return { done, failed };
}

