import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode, type RefObject } from "react";
import {
  ArrowUpDown,
  Bookmark,
  BookmarkPlus,
  Check,
  ChevronRight,
  Copy,
  CornerUpRight,
  Download,
  ExternalLink,
  Filter,
  HardDrive,
  History,
  LayoutGrid,
  List as ListIcon,
  Pencil,
  Plug,
  RefreshCw,
  RotateCcw,
  Search,
  Share2,
  Star,
  Trash2,
  Type,
  X,
} from "lucide-react";
import { formatBytes } from "@kosh/shared";
import { cn } from "@/lib/cn";
import { useData } from "@/data/store";
import { Button, Progress, Spinner } from "@/components/ui";
import { Menu, MenuItem, MenuLabel, MenuSeparator } from "@/components/overlays";
import { driveApi } from "@/data/driveApi";
import { filterBucket, type DriveNode, type FilterKind } from "@/data/driveV2Api";
import { useDriveV2, type DriveView, type SortKey } from "@/data/driveV2";
import { useVirtualizer } from "@tanstack/react-virtual";
import { DriveContentSkeleton, DriveEmptyState, DriveErrorState, FileCard, FileRow, ListHeader, sortNodes, type ItemHandlers } from "@/components/drive-v2/items";
import { PageHeader } from "@/components/drive-v2/PageHeader";
import { DriveRail } from "@/components/drive-v2/DriveRail";
import { ContextMenu, type MenuAction } from "@/components/drive-v2/ContextMenu";
import { CreateFolderModal, DeleteConfirmModal, MoveToModal } from "@/components/drive-v2/modals";
import { ShareModal } from "@/components/drive-v2/ShareModal";
import { BulkRenameModal } from "@/components/drive-v2/BulkRenameModal";
import { InsightsPanel } from "@/components/drive-v2/InsightsPanel";
import { ActivityPanel } from "@/components/drive-v2/ActivityPanel";
import { RevisionsModal } from "@/components/drive-v2/RevisionsModal";
import { DriveDetails, PreviewOverlay } from "@/components/drive-v2/DriveDetails";
import { CommandPalette } from "@/components/drive-v2/CommandPalette";
import { hasDriveDrag, hasExternalFiles, setDragIds } from "@/components/drive-v2/dnd";
import { drivePaneKey, useDriveV2UrlSync } from "@/data/driveV2Url";
import { FadeSwap } from "@/components/motion";
import { AnimatePresence, motion } from "motion/react";
import { DUR, EASE } from "@/lib/motion";
import { ago } from "@/lib/time";

const SAVED_KEY = "kosh.driveV2.savedSearches";

export function DriveV2() {
  const backend = useData((s) => s.backend);
  const status = useDriveV2((s) => s.status);
  const configured = useDriveV2((s) => s.configured);
  const scopeOk = useDriveV2((s) => s.scopeOk);
  const accounts = useDriveV2((s) => s.accounts);
  const accountId = useDriveV2((s) => s.accountId);
  const init = useDriveV2((s) => s.init);

  useEffect(() => {
    if (backend) void init();
  }, [backend, init]);

  if (!backend) return <Gate icon={HardDrive} title="Drive needs the backend" body="Run the API and set VITE_API_URL to use the Drive control center." />;
  if (status === "loading") return <div className="grid min-h-[50vh] w-full place-items-center"><Spinner size={26} className="text-primary" /></div>;
  if (status === "error") return <Gate icon={HardDrive} title="Couldn't reach Drive" body="The Drive service didn't respond. Check the API and retry." action={<Button variant="primary" onClick={() => init()}>Retry</Button>} />;
  if (!configured) return <ScopeGate reason="not-configured" />;
  if (!accounts.length) return <ScopeGate reason="no-account" />;
  if (!accountId || !scopeOk) return <ScopeGate reason="reconnect" />;
  return <Shell />;
}

/* ── gates ── */
function Gate({ icon: Icon, title, body, action }: { icon: typeof HardDrive; title: string; body: string; action?: ReactNode }) {
  return (
    <div className="mx-auto grid min-h-[55vh] w-full max-w-lg place-items-center">
      <div className="w-full rounded-[var(--radius-card)] border border-border bg-surface px-6 py-10 text-center">
        <span className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-primary-soft text-primary"><Icon size={26} /></span>
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="mx-auto mt-1.5 max-w-sm text-[13px] text-muted">{body}</p>
        {action && <div className="mt-5 flex justify-center">{action}</div>}
      </div>
    </div>
  );
}

function ScopeGate({ reason }: { reason: "not-configured" | "no-account" | "reconnect" }) {
  const copy = {
    "not-configured": { title: "Full Drive access required", body: "The Drive control center needs full Drive access. Ask an admin to set GOOGLE_DRIVE_FULL_ACCESS=1 on the server, then reconnect your account.", cta: null },
    "no-account": { title: "Connect a Google account", body: "Sign in with Google to manage your Drive files and folders here.", cta: "Sign in with Google" },
    reconnect: { title: "Reconnect for full access", body: "This account is connected with limited access and can't see your existing files. Reconnect to grant full Drive access.", cta: "Reconnect Google" },
  }[reason];
  return (
    <Gate
      icon={Plug}
      title={copy.title}
      body={copy.body}
      action={copy.cta ? <a href={driveApi.connectUrl("drive-v2")}><Button variant="primary"><Plug size={15} /> {copy.cta}</Button></a> : undefined}
    />
  );
}

/* ── shell ── */
function Shell() {
  const view = useDriveV2((s) => s.view);
  const nodes = useDriveV2((s) => s.nodes);
  const prefs = useDriveV2((s) => s.prefs);
  const listLoading = useDriveV2((s) => s.listLoading);
  const listError = useDriveV2((s) => s.listError);
  const loadingMore = useDriveV2((s) => s.loadingMore);
  const nextPageToken = useDriveV2((s) => s.nextPageToken);
  const selection = useDriveV2((s) => s.selection);
  const busyIds = useDriveV2((s) => s.busyIds);
  const detailsId = useDriveV2((s) => s.detailsId);
  const detailsNode = useDriveV2((s) => s.detailsNode);
  const detailsLoading = useDriveV2((s) => s.detailsLoading);
  const previewNode = useDriveV2((s) => s.previewNode);
  const dialog = useDriveV2((s) => s.dialog);
  const uploads = useDriveV2((s) => s.uploads);
  const insightsOpen = useDriveV2((s) => s.insightsOpen);
  const activityOpen = useDriveV2((s) => s.activityOpen);

  const store = useDriveV2;
  const currentFolderId = useDriveV2((s) => s.path.at(-1)?.id ?? s.spaceId ?? "root");

  // Deep-linkable routing: mirror view/folder/overlay state to the URL and apply it back on Back/refresh.
  useDriveV2UrlSync();
  const paneKey = drivePaneKey({ view, insightsOpen, activityOpen });

  // Live two-way sync: poll changes.list while the module is open; resume promptly on refocus.
  useEffect(() => {
    const start = store.getState().startSync;
    start();
    const onVis = () => { if (document.visibilityState === "visible") start(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { document.removeEventListener("visibilitychange", onVis); store.getState().stopSync(); };
  }, [store]);

  const [menu, setMenu] = useState<{ ids: string[]; node: DriveNode; x: number; y: number } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Global ⌘K / Ctrl+K opens the command palette.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPaletteOpen((v) => !v); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const visible = useMemo(() => {
    const filtered = prefs.filterKind ? nodes.filter((n) => filterBucket(n) === prefs.filterKind) : nodes;
    return sortNodes(filtered, prefs.sortKey, prefs.sortDir);
  }, [nodes, prefs]);
  const orderedIds = useMemo(() => visible.map((n) => n.id), [visible]);
  const headerStats = useMemo(
    () => ({
      count: visible.length,
      bytes: visible.reduce((a, n) => a + (n.isFolder ? 0 : n.size ?? 0), 0),
      folders: visible.filter((n) => n.isFolder).length,
    }),
    [visible],
  );


  /** Ids an action should target: the whole selection if the node is part of a multi-select, else just it. */
  const targetsFor = useCallback((node: DriveNode): string[] => (selection.has(node.id) && selection.size > 1 ? [...selection] : [node.id]), [selection]);

  const handlers: ItemHandlers = {
    onOpen: (node) => {
      if (node.isFolder) store.getState().openFolder(node);
      else store.getState().setPreview(node);
    },
    onClick: (node, e) => {
      // Modifier-click always extends/toggles the selection (multi-select) — never opens.
      if (e.shiftKey || e.metaKey || e.ctrlKey) {
        store.getState().toggleSelect(node.id, { shift: e.shiftKey, meta: e.metaKey || e.ctrlKey }, orderedIds);
        return;
      }
      // A plain single click opens a folder directly (no details drawer, no double-click needed).
      // Use the checkbox disc, right-click, or ⌘/Shift-click to select a folder instead.
      if (node.isFolder) {
        store.getState().openFolder(node);
        return;
      }
      // Files: select + open the details drawer, as before.
      store.getState().toggleSelect(node.id, {}, orderedIds);
      void store.getState().loadDetails(node.id);
    },
    onContext: (node, e) => {
      e.preventDefault();
      if (!selection.has(node.id)) store.getState().toggleSelect(node.id, {}, orderedIds);
      setMenu({ ids: targetsFor(node), node, x: e.clientX, y: e.clientY });
    },
    onToggleStar: (node) => void store.getState().toggleStar(node.id),
    onToggleSelect: (node) => store.getState().toggleSelect(node.id, { meta: true }, orderedIds),
    onMore: (node, e) => {
      if (!selection.has(node.id)) store.getState().toggleSelect(node.id, {}, orderedIds);
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      setMenu({ ids: targetsFor(node), node, x: r.left, y: r.bottom + 4 });
    },
    onRenameSubmit: (node, name) => { void store.getState().rename(node.id, name); setRenamingId(null); },
    onRenameCancel: () => setRenamingId(null),
    onDragStart: (node, e) => setDragIds(e, targetsFor(node)),
    onFolderDrop: (folder, ids) => void store.getState().move(ids, folder.id),
  };

  // Keyboard shortcuts scoped to the content region.
  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a") { e.preventDefault(); store.getState().selectAll(orderedIds); }
    else if (e.key === "Escape") { store.getState().clearSelection(); store.getState().loadDetails(null); }
    else if ((e.key === "Delete" || e.key === "Backspace") && selection.size) { e.preventDefault(); store.getState().openDialog({ kind: "delete", ids: [...selection], permanent: view === "trash" }); }
    else if (e.key === "F2" && selection.size === 1) { setRenamingId([...selection][0]!); }
  };

  const menuActions = menu ? buildMenuActions(menu.node, menu.ids, view, { setRenamingId, close: () => setMenu(null) }) : [];

  return (
    <div className="w-full" onKeyDown={onKeyDown}>
      <input ref={fileInputRef} type="file" multiple hidden onChange={(e) => { void store.getState().uploadFiles(Array.from(e.target.files ?? [])); if (fileInputRef.current) fileInputRef.current.value = ""; }} />
      <div className="grid gap-6 lg:grid-cols-[auto_minmax(0,1fr)] lg:items-start">
        <DriveRail
          onNewFolder={() => store.getState().openDialog({ kind: "newFolder", parentId: currentFolderId })}
          onUpload={() => fileInputRef.current?.click()}
        />
        <FadeSwap k={paneKey} className="min-w-0">
          {activityOpen ? (
            <ActivityPanel onClose={() => store.getState().setActivity(false)} />
          ) : insightsOpen ? (
            <InsightsPanel onClose={() => store.getState().setInsights(false)} />
          ) : (
          <div className="flex min-w-0 flex-col">
            <PageHeader
              stats={headerStats}
              onNewFolder={() => store.getState().openDialog({ kind: "newFolder", parentId: currentFolderId })}
              onUpload={() => fileInputRef.current?.click()}
            />
            <DriveToolbar />
            {selection.size > 0 && <SelectionBar />}
            <DriveContentArea
              view={view}
              visible={visible}
              layout={prefs.layout}
              selection={selection}
              busyIds={busyIds}
              renamingId={renamingId}
              handlers={handlers}
              orderedIds={orderedIds}
              listLoading={listLoading}
              listError={listError}
              onUpload={() => fileInputRef.current?.click()}
              onDropFiles={(files) => void store.getState().uploadFiles(files)}
            />
            {nextPageToken && !listLoading && (
              <div className="p-3 text-center">
                <Button variant="ghost" size="sm" onClick={() => void store.getState().loadMore()} disabled={loadingMore}>
                  {loadingMore ? <Spinner size={14} /> : <ChevronRight size={14} className="rotate-90" />} Load more
                </Button>
              </div>
            )}
          </div>
          )}
        </FadeSwap>
      </div>

      {/* Inspector — an animated right drawer with a light scrim. */}
      <AnimatePresence>
        {detailsId && (
          <>
            <motion.div
              key="inspector-scrim"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: DUR.base }}
              onClick={() => void store.getState().loadDetails(null)}
              className="fixed inset-0 z-40 bg-black/25 backdrop-blur-[1px]"
            />
            <motion.aside
              key="inspector-panel"
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ duration: DUR.slow, ease: EASE.emphasized }}
              className="fixed inset-y-0 right-0 z-40 flex w-[88vw] max-w-[380px] flex-col border-l border-border bg-surface shadow-[var(--shadow-pop)]"
            >
              <DriveDetails
                node={detailsNode}
                count={selection.size}
                totalBytes={[...selection].reduce((a, id) => a + (nodes.find((n) => n.id === id)?.size ?? 0), 0)}
                loading={detailsLoading}
                onClose={() => void store.getState().loadDetails(null)}
                onRename={(n) => setRenamingId(n.id)}
                onStar={(n) => void store.getState().toggleStar(n.id)}
                onMove={(n) => store.getState().openDialog({ kind: "move", ids: [n.id] })}
                onTrash={(n) => store.getState().openDialog({ kind: "delete", ids: [n.id], permanent: view === "trash" })}
                onPreview={(n) => store.getState().setPreview(n)}
                onShare={(n) => store.getState().openDialog({ kind: "share", node: n })}
                onUpdateMeta={(n, patch) => void store.getState().updateMeta(n.id, patch)}
              />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {uploads.length > 0 && <UploadTray />}

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} onUpload={() => fileInputRef.current?.click()} />
      {menu && <ContextMenu x={menu.x} y={menu.y} actions={menuActions} onClose={() => setMenu(null)} />}
      {dialog?.kind === "newFolder" && <CreateFolderModal parentId={dialog.parentId} onClose={() => store.getState().closeDialog()} />}
      {dialog?.kind === "delete" && <DeleteConfirmModal ids={dialog.ids} permanent={dialog.permanent} onClose={() => store.getState().closeDialog()} />}
      {dialog?.kind === "move" && <MoveToModal ids={dialog.ids} onClose={() => store.getState().closeDialog()} />}
      {dialog?.kind === "share" && <ShareModal node={dialog.node} onClose={() => store.getState().closeDialog()} />}
      {dialog?.kind === "rename-bulk" && <BulkRenameModal ids={dialog.ids} onClose={() => store.getState().closeDialog()} />}
      {dialog?.kind === "revisions" && <RevisionsModal node={dialog.node} onClose={() => store.getState().closeDialog()} />}
      {previewNode && <PreviewOverlay node={previewNode} onClose={() => store.getState().setPreview(null)} />}
    </div>
  );
}

/* ── context-menu actions ── */
function buildMenuActions(node: DriveNode, ids: string[], view: DriveView, ctx: { setRenamingId: (id: string) => void; close: () => void }): MenuAction[] {
  const s = useDriveV2.getState();
  const many = ids.length > 1;
  if (view === "trash") {
    return [
      { label: many ? `Restore ${ids.length}` : "Restore", icon: RotateCcw, onClick: () => void s.restore(ids) },
      { label: many ? `Delete ${ids.length} forever` : "Delete forever", icon: Trash2, danger: true, separatorBefore: true, onClick: () => s.openDialog({ kind: "delete", ids, permanent: true }) },
    ];
  }
  const a: MenuAction[] = [];
  if (!many) {
    if (node.isFolder) a.push({ label: "Open", icon: CornerUpRight, onClick: () => s.openFolder(node) });
    else a.push({ label: "Preview", icon: ExternalLink, onClick: () => s.setPreview(node) });
    if (node.webViewLink) a.push({ label: "Open in Drive", icon: ExternalLink, onClick: () => window.open(node.webViewLink, "_blank", "noopener") });
    if (node.webContentLink) a.push({ label: "Download", icon: Download, onClick: () => window.open(node.webContentLink, "_blank", "noopener") });
    if (node.capabilities?.canRename !== false) a.push({ label: "Rename", icon: Pencil, shortcut: "F2", onClick: () => ctx.setRenamingId(node.id) });
    if (node.capabilities?.canShare !== false) a.push({ label: "Share…", icon: Share2, onClick: () => s.openDialog({ kind: "share", node }) });
    if (node.isFolder) a.push({ label: "Make a copy", icon: Copy, onClick: () => void s.copyFolder(node.id) });
    else {
      if (node.capabilities?.canCopy !== false) a.push({ label: "Make a copy", icon: Copy, onClick: () => void s.copy(node.id) });
      a.push({ label: "Version history", icon: History, onClick: () => s.openDialog({ kind: "revisions", node }) });
    }
  }
  a.push({ label: many ? `Star ${ids.length}` : node.starred ? "Unstar" : "Star", icon: Star, onClick: () => void s.toggleStarMany(ids) });
  if (many) a.push({ label: `Bulk rename ${ids.length}`, icon: Type, onClick: () => s.openDialog({ kind: "rename-bulk", ids }) });
  a.push({ label: "Move to…", icon: CornerUpRight, onClick: () => s.openDialog({ kind: "move", ids }) });
  a.push({ label: many ? `Move ${ids.length} to trash` : "Move to trash", icon: Trash2, danger: true, separatorBefore: true, onClick: () => s.openDialog({ kind: "delete", ids, permanent: false }) });
  return a;
}

/* ── live-sync status pill ── */
function SyncPill() {
  const sync = useDriveV2((s) => s.sync);
  const setActivity = useDriveV2((s) => s.setActivity);
  const [, force] = useState(0);
  // Keep the "synced x ago" label fresh without a store write.
  useEffect(() => { const t = window.setInterval(() => force((n) => n + 1), 20_000); return () => window.clearInterval(t); }, []);

  const label =
    sync.status === "syncing" ? "Syncing…" :
    sync.status === "error" ? "Sync error" :
    sync.status === "off" ? "Sync off" :
    sync.via === "push" ? "Live" :
    sync.lastAt ? `Synced ${ago(new Date(sync.lastAt).toISOString())}` : "Live";
  const dot =
    sync.status === "error" ? "bg-danger" :
    sync.status === "syncing" ? "bg-primary" :
    sync.status === "live" ? "bg-ok" : "bg-faint";

  return (
    <button
      onClick={() => setActivity(true)}
      title={sync.via === "push" ? "Live push sync with Google Drive — open activity" : "Live two-way sync with Google Drive — open activity"}
      className="inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-control)] border border-border px-2.5 text-[12px] text-muted hover:bg-surface-2"
    >
      {sync.status === "syncing" ? <RefreshCw size={13} className="animate-spin text-primary" /> : <span className={cn("h-1.5 w-1.5 rounded-full", dot)} />}
      <span className="hidden md:inline">{label}</span>
    </button>
  );
}

/* ── toolbar (utility strip on the borderless canvas) ── */
function DriveToolbar() {
  const view = useDriveV2((s) => s.view);
  const prefs = useDriveV2((s) => s.prefs);
  const searchQuery = useDriveV2((s) => s.searchQuery);
  const [q, setQ] = useState(searchQuery);
  const [saved, setSaved] = useState<{ query: string }[]>(() => { try { return JSON.parse(localStorage.getItem(SAVED_KEY) || "[]"); } catch { return []; } });
  const persistSaved = (next: { query: string }[]) => { setSaved(next); try { localStorage.setItem(SAVED_KEY, JSON.stringify(next)); } catch { /* private mode */ } };
  const saveCurrent = () => { const query = q.trim(); if (!query || saved.some((s) => s.query === query)) return; persistSaved([{ query }, ...saved].slice(0, 20)); };

  useEffect(() => setQ(searchQuery), [searchQuery]);
  // Debounced search.
  useEffect(() => {
    if (view !== "search" && q === "") return;
    const t = window.setTimeout(() => {
      if (q.trim()) useDriveV2.getState().runSearch(q.trim());
      else if (view === "search") useDriveV2.getState().clearSearch();
    }, 250);
    return () => window.clearTimeout(t);
  }, [q, view]);

  const SORTS: { k: SortKey; label: string }[] = [{ k: "name", label: "Name" }, { k: "modified", label: "Last modified" }, { k: "size", label: "Size" }, { k: "kind", label: "Type" }];
  const FILTERS: { k: FilterKind | null; label: string }[] = [
    { k: null, label: "All items" }, { k: "folder", label: "Folders" }, { k: "doc", label: "Documents" }, { k: "image", label: "Images" }, { k: "video", label: "Videos" }, { k: "pdf", label: "PDFs" }, { k: "audio", label: "Audio" }, { k: "archive", label: "Archives" },
  ];

  return (
    <div className="sticky top-0 z-20 flex flex-wrap items-center gap-2 border-b border-border bg-background/80 py-2 backdrop-blur">
      <label className="mr-auto flex h-9 min-w-0 flex-1 items-center gap-2 rounded-[var(--radius-control)] border border-border bg-surface-2 px-2.5 focus-within:border-primary focus-within:ring-focus sm:max-w-sm">
        <Search size={15} className="shrink-0 text-muted" />
        <span className="hidden shrink-0 rounded-[var(--radius-chip)] bg-surface-3 px-1.5 py-0.5 text-[10.5px] capitalize text-muted sm:inline">{view === "myDrive" ? "My Drive" : view === "search" ? "results" : view}</span>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search Drive… (⌘K)" className="min-w-0 flex-1 bg-transparent text-[13px] outline-none" />
        {q && <button onClick={() => setQ("")} aria-label="Clear search"><X size={14} className="text-faint hover:text-foreground" /></button>}
      </label>

      <SyncPill />

      <Menu align="end" width={240} trigger={({ toggle, ref }) => (
        <button ref={ref} onClick={toggle} className="grid h-9 w-9 place-items-center rounded-[var(--radius-control)] border border-border text-muted hover:bg-surface-2" aria-label="Saved searches"><Bookmark size={15} /></button>
      )}>
        <MenuLabel>Saved searches</MenuLabel>
        {saved.length === 0 && <div className="px-2.5 py-2 text-[12.5px] text-muted">No saved searches yet.</div>}
        {saved.map((sv) => (
          <div key={sv.query} className="flex items-center gap-1 pr-1">
            <button onClick={() => setQ(sv.query)} className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] hover:bg-surface-2"><Search size={13} className="shrink-0 text-muted" /><span className="min-w-0 flex-1 truncate">{sv.query}</span></button>
            <button onClick={() => persistSaved(saved.filter((x) => x.query !== sv.query))} className="shrink-0 rounded p-1 text-faint hover:text-danger" aria-label="Remove"><X size={13} /></button>
          </div>
        ))}
        <MenuSeparator />
        <MenuItem icon={BookmarkPlus} disabled={!q.trim()} onClick={saveCurrent}>Save current search</MenuItem>
      </Menu>

      <Menu align="end" width={200} trigger={({ toggle, ref }) => (
        <button ref={ref} onClick={toggle} className="inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-control)] border border-border px-2.5 text-[13px] text-muted hover:bg-surface-2"><ArrowUpDown size={15} /> Sort</button>
      )}>
        <MenuLabel>Sort by</MenuLabel>
        {SORTS.map((s) => (
          <MenuItem key={s.k} icon={prefs.sortKey === s.k ? Check : undefined} onClick={() => useDriveV2.getState().setSort(s.k)}>
            {s.label}{prefs.sortKey === s.k ? ` (${prefs.sortDir === "asc" ? "A→Z" : "Z→A"})` : ""}
          </MenuItem>
        ))}
      </Menu>

      <Menu align="end" width={190} trigger={({ toggle, ref }) => (
        <button ref={ref} onClick={toggle} className={cn("inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-control)] border px-2.5 text-[13px] hover:bg-surface-2", prefs.filterKind ? "border-primary text-primary" : "border-border text-muted")}><Filter size={15} /> Filter</button>
      )}>
        <MenuLabel>Show</MenuLabel>
        {FILTERS.map((f) => (
          <MenuItem key={f.label} icon={prefs.filterKind === f.k ? Check : undefined} onClick={() => useDriveV2.getState().setFilter(f.k)}>{f.label}</MenuItem>
        ))}
      </Menu>

      <div className="flex h-9 items-center rounded-[var(--radius-control)] border border-border p-0.5">
        <button onClick={() => useDriveV2.getState().setLayout("grid")} className={cn("grid h-8 w-8 place-items-center rounded-[6px]", prefs.layout === "grid" ? "bg-surface-2 text-foreground" : "text-muted")} aria-label="Grid view"><LayoutGrid size={15} /></button>
        <button onClick={() => useDriveV2.getState().setLayout("list")} className={cn("grid h-8 w-8 place-items-center rounded-[6px]", prefs.layout === "list" ? "bg-surface-2 text-foreground" : "text-muted")} aria-label="List view"><ListIcon size={15} /></button>
      </div>
    </div>
  );
}

/* ── selection action bar ── */
function SelectionBar() {
  const selection = useDriveV2((s) => s.selection);
  const view = useDriveV2((s) => s.view);
  const s = useDriveV2.getState;
  const ids = [...selection];
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border bg-primary-soft/50 px-3 py-2 text-[13px]">
      <button onClick={() => s().clearSelection()} className="grid h-7 w-7 place-items-center rounded-md text-muted hover:bg-surface-2" aria-label="Clear selection"><X size={15} /></button>
      <span className="font-medium">{ids.length} selected</span>
      <div className="ml-auto flex items-center gap-1.5">
        {view === "trash" ? (
          <>
            <Button variant="ghost" size="sm" onClick={() => void s().restore(ids)}><RotateCcw size={14} /> Restore</Button>
            <Button variant="ghost" size="sm" className="text-danger" onClick={() => s().openDialog({ kind: "delete", ids, permanent: true })}><Trash2 size={14} /> Delete forever</Button>
          </>
        ) : (
          <>
            <Button variant="ghost" size="sm" onClick={() => void s().toggleStarMany(ids)}><Star size={14} /> Star</Button>
            {ids.length > 1 && <Button variant="ghost" size="sm" onClick={() => s().openDialog({ kind: "rename-bulk", ids })}><Type size={14} /> Rename</Button>}
            <Button variant="ghost" size="sm" onClick={() => s().openDialog({ kind: "move", ids })}><CornerUpRight size={14} /> Move</Button>
            <Button variant="ghost" size="sm" className="text-danger" onClick={() => s().openDialog({ kind: "delete", ids, permanent: false })}><Trash2 size={14} /> Trash</Button>
          </>
        )}
      </div>
    </div>
  );
}

/* ── rubber-band (marquee) selection over the visible items ── */
function useMarqueeSelect(scrollRef: RefObject<HTMLDivElement | null>) {
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const anchor = useRef<{ x: number; y: number; base: string[]; add: boolean } | null>(null);

  useEffect(() => {
    function move(e: MouseEvent) {
      const a = anchor.current;
      if (!a) return;
      const x = Math.min(a.x, e.clientX), y = Math.min(a.y, e.clientY);
      const w = Math.abs(e.clientX - a.x), h = Math.abs(e.clientY - a.y);
      if (w < 5 && h < 5) return; // still a click, not a drag
      e.preventDefault();
      setBox({ x, y, w, h });
      const sel = { left: x, top: y, right: x + w, bottom: y + h };
      const hits: string[] = [];
      // Only rendered (virtualized) rows are hit — off-screen items can't be marquee-selected.
      scrollRef.current?.querySelectorAll<HTMLElement>("[data-node-id]").forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.left < sel.right && r.right > sel.left && r.top < sel.bottom && r.bottom > sel.top) {
          const id = el.getAttribute("data-node-id");
          if (id) hits.push(id);
        }
      });
      useDriveV2.getState().marqueeSelect(a.add ? [...new Set([...a.base, ...hits])] : hits);
    }
    function up() { anchor.current = null; setBox(null); }
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
  }, [scrollRef]);

  const onMouseDown = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const t = e.target as HTMLElement;
    // Ignore drags that begin on an item card/row or any interactive control.
    if (t.closest("[data-node-id]") || t.closest("button") || t.closest("a") || t.closest("input") || t.closest("textarea")) return;
    const add = e.shiftKey || e.metaKey || e.ctrlKey;
    // Don't clear the selection yet — a plain click on empty space (or a scrollbar drag) must not wipe
    // it. The clear happens implicitly once the drag crosses the threshold (marqueeSelect replaces it).
    anchor.current = { x: e.clientX, y: e.clientY, base: add ? [...useDriveV2.getState().selection] : [], add };
  };

  return { box, onMouseDown };
}

/* ── content area (grid/list + states + drop) ── */
function DriveContentArea({
  view, visible, layout, selection, busyIds, renamingId, handlers, listLoading, listError, onUpload, onDropFiles,
}: {
  view: DriveView;
  visible: DriveNode[];
  layout: "grid" | "list";
  selection: Set<string>;
  busyIds: Set<string>;
  renamingId: string | null;
  handlers: ItemHandlers;
  orderedIds: string[];
  listLoading: boolean;
  listError: string | null;
  onUpload: () => void;
  onDropFiles: (files: File[]) => void;
}) {
  const [drag, setDrag] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const canDrop = view === "myDrive";
  const rowProps = (node: DriveNode): ItemRowProps => ({ node, selected: selection.has(node.id), busy: busyIds.has(node.id), renaming: renamingId === node.id, ...handlers });
  const marquee = useMarqueeSelect(scrollRef);

  // The drop target wraps ALL states so external-file drag-and-drop upload works even in an empty
  // folder. It reacts ONLY to external files — internal node drags are handled by folder/breadcrumb
  // drop targets, so dragging within the grid never shows "Drop to upload".
  return (
    <div
      ref={scrollRef}
      onMouseDown={marquee.onMouseDown}
      onDragOver={canDrop ? (e) => { if (hasExternalFiles(e) && !hasDriveDrag(e)) { e.preventDefault(); setDrag(true); } } : undefined}
      onDragLeave={canDrop ? (e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrag(false); } : undefined}
      onDrop={canDrop ? (e) => { if (!hasExternalFiles(e) || hasDriveDrag(e)) return; e.preventDefault(); setDrag(false); const files = Array.from(e.dataTransfer.files); if (files.length) onDropFiles(files); } : undefined}
      className={cn("relative min-h-[360px] overflow-y-auto overflow-x-hidden rounded-[var(--radius-card)] lg:h-[calc(100dvh-15rem)]", drag && "outline-2 -outline-offset-2 outline-dashed outline-primary")}
    >
      {marquee.box && <div className="pointer-events-none fixed z-30 rounded-[3px] border border-primary bg-primary/10" style={{ left: marquee.box.x, top: marquee.box.y, width: marquee.box.w, height: marquee.box.h }} />}
      {drag && <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center bg-primary-soft/40 text-[14px] font-semibold text-primary">Drop to upload here</div>}
      {listLoading ? (
        <DriveContentSkeleton layout={layout} />
      ) : listError ? (
        <DriveErrorState message={listError} onRetry={() => void useDriveV2.getState().load(true)} />
      ) : !visible.length ? (
        <DriveEmptyState view={view} onUpload={onUpload} />
      ) : layout === "list" ? (
        <VirtualList scrollRef={scrollRef} visible={visible} rowProps={rowProps} />
      ) : (
        <VirtualGrid scrollRef={scrollRef} visible={visible} rowProps={rowProps} />
      )}
    </div>
  );
}

type ItemRowProps = { node: DriveNode; selected: boolean; busy: boolean; renaming: boolean } & ItemHandlers;

/** Virtualized list — only the visible rows are mounted, so 10k-item folders stay smooth. */
function VirtualList({ scrollRef, visible, rowProps }: { scrollRef: RefObject<HTMLDivElement | null>; visible: DriveNode[]; rowProps: (n: DriveNode) => ItemRowProps }) {
  const virt = useVirtualizer({ count: visible.length, getScrollElement: () => scrollRef.current, estimateSize: () => 48, overscan: 12 });
  return (
    <div>
      <ListHeader />
      <div style={{ height: virt.getTotalSize(), position: "relative" }}>
        {virt.getVirtualItems().map((vi) => {
          const n = visible[vi.index]!;
          return (
            <div key={n.id} data-index={vi.index} ref={virt.measureElement} style={{ position: "absolute", top: 0, left: 0, right: 0, transform: `translateY(${vi.start}px)` }}>
              <FileRow {...rowProps(n)} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Virtualized responsive grid — columns from container width, rows virtualized. */
function VirtualGrid({ scrollRef, visible, rowProps }: { scrollRef: RefObject<HTMLDivElement | null>; visible: DriveNode[]; rowProps: (n: DriveNode) => ItemRowProps }) {
  const gridRef = useRef<HTMLDivElement>(null);
  const [cols, setCols] = useState(4);
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const compute = () => { const w = el.clientWidth; const min = 176, gap = 16; setCols(Math.max(1, Math.floor((w + gap) / (min + gap)))); };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const rows = Math.ceil(visible.length / cols);
  const virt = useVirtualizer({ count: rows, getScrollElement: () => scrollRef.current, estimateSize: () => 208, overscan: 6, measureElement: (el) => el.getBoundingClientRect().height });
  return (
    <div ref={gridRef} className="py-2">
      <div style={{ height: virt.getTotalSize(), position: "relative" }}>
        {virt.getVirtualItems().map((vr) => {
          const items = visible.slice(vr.index * cols, vr.index * cols + cols);
          return (
            <div
              key={vr.key}
              data-index={vr.index}
              ref={virt.measureElement}
              style={{ position: "absolute", top: 0, left: 0, right: 0, transform: `translateY(${vr.start}px)`, display: "grid", gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: "16px", paddingBottom: "16px" }}
            >
              {items.map((n) => <FileCard key={n.id} {...rowProps(n)} />)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── upload tray (per-file + aggregate real-time progress) ── */
function UploadTray() {
  const uploads = useDriveV2((s) => s.uploads);
  const [open, setOpen] = useState(true);
  const active = uploads.filter((u) => u.status === "uploading");
  const done = uploads.filter((u) => u.status === "done").length;
  // Aggregate progress across everything in the tray (uploaded bytes / total bytes).
  const totalBytes = uploads.reduce((a, u) => a + u.size, 0);
  const doneBytes = uploads.reduce((a, u) => a + (u.status === "done" ? u.size : u.uploaded), 0);
  const aggPct = totalBytes ? Math.round((doneBytes / totalBytes) * 100) : 0;

  return (
    <div className="fixed bottom-4 right-4 z-40 w-80 overflow-hidden rounded-[var(--radius-card)] border border-border bg-elevated shadow-[var(--shadow-pop)]">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 border-b border-border px-3.5 py-2.5 text-[13px] font-semibold">
        {active.length > 0 ? <Spinner size={14} className="text-primary" /> : <Check size={15} className="text-ok" />}
        <span className="flex-1 text-left">{active.length > 0 ? `Uploading ${active.length}…` : `${done} upload${done === 1 ? "" : "s"} complete`}</span>
        <ChevronRight size={15} className={cn("text-muted transition-transform", open && "rotate-90")} />
      </button>
      {active.length > 0 && (
        <div className="border-b border-border px-3.5 py-2">
          <Progress value={aggPct} />
          <div className="mt-1 flex justify-between text-[11px] text-muted">
            <span>{formatBytes(doneBytes)} of {formatBytes(totalBytes)}</span>
            <span>{aggPct}%</span>
          </div>
        </div>
      )}
      {open && (
        <div className="max-h-64 overflow-y-auto">
          {uploads.slice(0, 30).map((u) => (
            <div key={u.id} className="flex items-center gap-2.5 border-b border-border px-3.5 py-2 last:border-0">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12.5px] font-medium">{u.name}</div>
                {u.status === "uploading" ? (
                  <>
                    <Progress value={u.size ? Math.round((u.uploaded / u.size) * 100) : 0} className="mt-1" />
                    <div className="mt-0.5 text-[10.5px] text-faint">{formatBytes(u.uploaded)} / {formatBytes(u.size)}</div>
                  </>
                ) : (
                  <div className={cn("text-[11px]", u.status === "done" ? "text-ok" : u.status === "error" ? "text-danger" : "text-muted")}>{u.status === "done" ? formatBytes(u.size) + " · Done" : u.status === "error" ? u.error ?? "Failed" : "Canceled"}</div>
                )}
              </div>
              {u.status === "done" && <Check size={15} className="shrink-0 text-ok" />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
