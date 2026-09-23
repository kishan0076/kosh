import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode, type RefObject } from "react";
import {
  ArrowUpDown,
  Bookmark,
  BookmarkPlus,
  Check,
  CheckSquare,
  ChevronRight,
  Copy,
  CornerUpRight,
  MinusSquare,
  Square,
  Download,
  ExternalLink,
  Filter,
  HardDrive,
  History,
  Info,
  LayoutGrid,
  List as ListIcon,
  Rows2,
  Rows3,
  Menu as MenuIcon,
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
import { Menu, MenuItem, MenuLabel, MenuSeparator, useBodyScrollLock } from "@/components/overlays";
import { driveApi } from "@/data/driveApi";
import { filterBucket, type DriveNode, type FilterKind } from "@/data/driveV2Api";
import { useDriveV2, type DriveView, type SortKey } from "@/data/driveV2";
import { useVirtualizer } from "@tanstack/react-virtual";
import { DriveContentSkeleton, DriveEmptyState, DriveErrorState, FileCard, FileRow, ListHeader, sortNodes, type ItemHandlers } from "@/components/drive-v2/items";
import { PageHeader } from "@/components/drive-v2/PageHeader";
import { DriveRail } from "@/components/drive-v2/DriveRail";
import { ContextMenu, type MenuAction } from "@/components/drive-v2/ContextMenu";
import { CreateFolderModal, DeleteConfirmModal, EmptyTrashModal, MoveToModal } from "@/components/drive-v2/modals";
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

/** Off-screen count chip used as the drag image for a multi-item drag. Plain DOM (drag images can't be
 *  React), styled with semantic tokens; appended off-screen, snapshotted by the browser, then removed. */
function makeDragGhost(count: number): HTMLElement {
  const el = document.createElement("div");
  el.style.cssText = "position:fixed;top:-9999px;left:-9999px;pointer-events:none;";
  el.className = "flex items-center gap-2 rounded-[10px] border border-primary bg-elevated px-3 py-2 text-[13px] font-medium text-foreground shadow-[var(--shadow-pop)]";
  const badge = document.createElement("span");
  badge.className = "grid h-6 min-w-[24px] place-items-center rounded-full bg-primary px-1.5 text-[12px] font-bold text-primary-foreground";
  badge.textContent = String(count);
  const label = document.createElement("span");
  label.textContent = count === 1 ? "1 item" : `${count} items`;
  el.append(badge, label);
  return el;
}

/* ── shell ── */
function Shell() {
  const view = useDriveV2((s) => s.view);
  const nodes = useDriveV2((s) => s.nodes);
  const prefs = useDriveV2((s) => s.prefs);
  const listLoading = useDriveV2((s) => s.listLoading);
  const refreshing = useDriveV2((s) => s.refreshing);
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
  // Subscribe to a derived boolean, NOT the uploads array — otherwise every XHR onProgress write
  // (many/sec during an upload) re-renders the whole Shell + grid. The tray subscribes to the array itself.
  const hasUploads = useDriveV2((s) => s.uploads.length > 0);
  const insightsOpen = useDriveV2((s) => s.insightsOpen);
  const activityOpen = useDriveV2((s) => s.activityOpen);

  const store = useDriveV2;
  const currentFolderId = useDriveV2((s) => s.path.at(-1)?.id ?? s.spaceId ?? "root");

  // Deep-linkable routing: mirror view/folder/overlay state to the URL and apply it back on Back/refresh.
  useDriveV2UrlSync();
  const paneKey = drivePaneKey({ view, insightsOpen, activityOpen });

  // Live two-way sync: poll changes.list while the module is open; resume promptly on refocus.
  useEffect(() => {
    store.getState().startSync();
    // Refocus reconciles without rebuilding a healthy push stream (see resumeSync) — no token re-mint /
    // new Drive watch on every tab switch.
    const onVis = () => { if (document.visibilityState === "visible") store.getState().resumeSync(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { document.removeEventListener("visibilitychange", onVis); store.getState().stopSync(); };
  }, [store]);

  const [menu, setMenu] = useState<{ ids: string[]; node: DriveNode; x: number; y: number } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Track the lg breakpoint so the inspector renders ONCE — docked as a third column on desktop, an
  // overlay drawer on narrow — instead of mounting two copies (one hidden per breakpoint).
  const [isLg, setIsLg] = useState(() => typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const on = () => setIsLg(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  const dockInspector = isLg && !!detailsId && !activityOpen && !insightsOpen;

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
  // id→size map so the inspector's selection total is O(selection), not O(selection × nodes) inline on
  // every Shell render (which fires on each sync tick).
  const sizeById = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of nodes) m.set(n.id, n.isFolder ? 0 : n.size ?? 0);
    return m;
  }, [nodes]);
  const detailsTotalBytes = useMemo(() => {
    let t = 0;
    for (const id of selection) t += sizeById.get(id) ?? 0;
    return t;
  }, [selection, sizeById]);


  // Route the two frequently-changing values the handlers read (visible order + selection) through refs,
  // so the `handlers` object below can be built ONCE (stable identity) and still see current values. A
  // stable handlers object is what lets the memoized FileRow/FileCard skip re-rendering on a sync tick.
  const orderedIdsRef = useRef(orderedIds);
  orderedIdsRef.current = orderedIds;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;

  /** Ids an action should target: the whole selection if the node is part of a multi-select, else just it. */
  const targetsFor = useCallback((node: DriveNode): string[] => {
    const sel = selectionRef.current;
    return sel.has(node.id) && sel.size > 1 ? [...sel] : [node.id];
  }, []);

  const handlers = useMemo<ItemHandlers>(() => ({
    onOpen: (node) => {
      if (node.isFolder) store.getState().openFolder(node);
      else store.getState().setPreview(node);
    },
    onClick: (node, e) => {
      const orderedIds = orderedIdsRef.current;
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
      if (!selectionRef.current.has(node.id)) store.getState().toggleSelect(node.id, {}, orderedIdsRef.current);
      setMenu({ ids: targetsFor(node), node, x: e.clientX, y: e.clientY });
    },
    onToggleStar: (node) => void store.getState().toggleStar(node.id),
    onToggleSelect: (node) => store.getState().toggleSelect(node.id, { meta: true }, orderedIdsRef.current),
    onMore: (node, e) => {
      if (!selectionRef.current.has(node.id)) store.getState().toggleSelect(node.id, {}, orderedIdsRef.current);
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      setMenu({ ids: targetsFor(node), node, x: r.left, y: r.bottom + 4 });
    },
    onRenameSubmit: (node, name) => { void store.getState().rename(node.id, name); setRenamingId(null); },
    onRenameCancel: () => setRenamingId(null),
    onDragStart: (node, e) => {
      const ids = targetsFor(node);
      setDragIds(e, ids);
      // For a multi-item drag, replace the single-row native ghost with a labeled count chip so it's
      // clear how many items are moving.
      if (ids.length > 1 && e.dataTransfer) {
        const ghost = makeDragGhost(ids.length);
        document.body.appendChild(ghost);
        e.dataTransfer.setDragImage(ghost, 14, 14);
        setTimeout(() => ghost.remove(), 0); // remove once the browser has snapshotted it
      }
    },
    onFolderDrop: (folder, ids) => void store.getState().move(ids, folder.id),
  }), [store, targetsFor]);

  // Keyboard shortcuts scoped to the content region.
  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a") { e.preventDefault(); void selectAllAcrossPages(); }
    else if (e.key === "Escape") { store.getState().clearSelection(); store.getState().loadDetails(null); }
    else if ((e.key === "Delete" || e.key === "Backspace") && selection.size) { e.preventDefault(); store.getState().openDialog({ kind: "delete", ids: [...selection], permanent: view === "trash" }); }
    else if (e.key === "F2" && selection.size === 1) { setRenamingId([...selection][0]!); }
  };

  const menuActions = menu ? buildMenuActions(menu.node, menu.ids, view, { setRenamingId, close: () => setMenu(null) }) : [];

  // One inspector element, placed either in the docked column (lg) or the overlay drawer (narrow).
  const inspectorEl = (
    <DriveDetails
      node={detailsNode}
      count={selection.size}
      totalBytes={detailsTotalBytes}
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
  );

  return (
    <div className="w-full lg:h-[calc(100dvh-7rem)] lg:overflow-hidden" onKeyDown={onKeyDown}>
      <input ref={fileInputRef} type="file" multiple hidden onChange={(e) => { void store.getState().uploadFiles(Array.from(e.target.files ?? [])); if (fileInputRef.current) fileInputRef.current.value = ""; }} />
      <div className={cn("grid gap-4 lg:h-full lg:min-h-0 lg:gap-6", dockInspector ? "lg:grid-cols-[auto_minmax(0,1fr)_360px]" : "lg:grid-cols-[auto_minmax(0,1fr)]")}>
        {/* Mobile: a compact bar with a hamburger that opens the rail as a drawer (the full rail below
            would otherwise bury the file list under the fold on a phone). */}
        <MobileDriveBar onOpenNav={() => setMobileNavOpen(true)} />
        {/* Desktop: the persistent sidebar rail. */}
        <div className="hidden lg:block lg:h-full lg:min-h-0">
          <DriveRail
            onNewFolder={() => store.getState().openDialog({ kind: "newFolder", parentId: currentFolderId })}
            onUpload={() => fileInputRef.current?.click()}
          />
        </div>
        <FadeSwap k={paneKey} className="min-w-0 lg:h-full lg:min-h-0">
          {activityOpen ? (
            <ActivityPanel onClose={() => store.getState().setActivity(false)} />
          ) : insightsOpen ? (
            <InsightsPanel onClose={() => store.getState().setInsights(false)} />
          ) : (
          <div className="flex min-w-0 flex-col lg:h-full lg:min-h-0">
            <PageHeader
              stats={headerStats}
              onNewFolder={() => store.getState().openDialog({ kind: "newFolder", parentId: currentFolderId })}
              onUpload={() => fileInputRef.current?.click()}
            />
            <DriveToolbar orderedIds={orderedIds} />
            {selection.size > 0 && <SelectionBar />}
            <MoreToLoadNotice />
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
              refreshing={refreshing}
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
        {/* Docked inspector (lg+): a non-modal third column, so browsing file-by-file isn't a
            click-scrim-click loop. On narrow screens the overlay drawer below is used instead. */}
        {dockInspector && (
          <aside className="hidden min-w-0 overflow-hidden rounded-[var(--radius-panel)] border border-border bg-surface lg:flex lg:h-full lg:min-h-0 lg:flex-col">
            {inspectorEl}
          </aside>
        )}
      </div>

      <MobileRailDrawer
        open={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
        onNewFolder={() => { setMobileNavOpen(false); store.getState().openDialog({ kind: "newFolder", parentId: currentFolderId }); }}
        onUpload={() => { setMobileNavOpen(false); fileInputRef.current?.click(); }}
      />

      <BulkProgress />

      {/* Inspector on narrow screens — an animated right drawer with a light scrim. On lg+ the docked
          column above is used instead (isLg gate ⇒ exactly one inspector instance mounts). */}
      {!isLg && (
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
                {inspectorEl}
              </motion.aside>
            </>
          )}
        </AnimatePresence>
      )}

      {hasUploads && <UploadTray />}

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} onUpload={() => fileInputRef.current?.click()} />
      {menu && <ContextMenu x={menu.x} y={menu.y} actions={menuActions} onClose={() => setMenu(null)} />}
      {dialog?.kind === "newFolder" && <CreateFolderModal parentId={dialog.parentId} onClose={() => store.getState().closeDialog()} />}
      {dialog?.kind === "delete" && <DeleteConfirmModal ids={dialog.ids} permanent={dialog.permanent} onClose={() => store.getState().closeDialog()} />}
      {dialog?.kind === "move" && <MoveToModal ids={dialog.ids} onClose={() => store.getState().closeDialog()} />}
      {dialog?.kind === "share" && <ShareModal node={dialog.node} onClose={() => store.getState().closeDialog()} />}
      {dialog?.kind === "rename-bulk" && <BulkRenameModal ids={dialog.ids} onClose={() => store.getState().closeDialog()} />}
      {dialog?.kind === "revisions" && <RevisionsModal node={dialog.node} onClose={() => store.getState().closeDialog()} />}
      {dialog?.kind === "empty-trash" && <EmptyTrashModal onClose={() => store.getState().closeDialog()} />}
      {previewNode && <PreviewOverlay node={previewNode} onClose={() => store.getState().setPreview(null)} />}
    </div>
  );
}

/* ── mobile top bar + rail drawer (shown below lg, where the full sidebar would bury the file list) ── */
function MobileDriveBar({ onOpenNav }: { onOpenNav: () => void }) {
  const accounts = useDriveV2((s) => s.accounts);
  const accountId = useDriveV2((s) => s.accountId);
  const spaceId = useDriveV2((s) => s.spaceId);
  const spaceName = useDriveV2((s) => s.spaceName);
  const account = accounts.find((a) => a.id === accountId);
  return (
    <div className="flex items-center gap-2.5 rounded-[var(--radius-panel)] border border-border bg-surface px-2.5 py-2 lg:hidden">
      <button onClick={onOpenNav} aria-label="Open navigation menu" className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-control)] border border-border text-muted transition-colors hover:bg-surface-2">
        <MenuIcon size={18} />
      </button>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-semibold leading-tight">{spaceId ? spaceName ?? "Shared drive" : account?.name ?? "Drive"}</div>
        <div className="truncate text-[11px] text-muted">{spaceId ? "Shared drive" : account?.email ?? ""}</div>
      </div>
    </div>
  );
}

function MobileRailDrawer({ open, onClose, onNewFolder, onUpload }: { open: boolean; onClose: () => void; onNewFolder: () => void; onUpload: () => void }) {
  useBodyScrollLock(open);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="rail-scrim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: DUR.base }}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[1px] lg:hidden"
          />
          <motion.div
            key="rail-panel"
            initial={{ x: "-100%" }}
            animate={{ x: 0 }}
            exit={{ x: "-100%" }}
            transition={{ duration: DUR.slow, ease: EASE.emphasized }}
            className="fixed inset-y-0 left-0 z-40 w-[84vw] max-w-[300px] p-2 lg:hidden"
          >
            <DriveRail variant="drawer" onNavigate={onClose} onNewFolder={onNewFolder} onUpload={onUpload} />
          </motion.div>
        </>
      )}
    </AnimatePresence>
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
    // Details works for folders too (a plain folder click navigates, so this is the way to inspect one).
    a.push({ label: "Details", icon: Info, onClick: () => void s.loadDetails(node.id) });
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
/** Honest "select all": drain every remaining page first, then select — but never select in a
 *  different view if the user navigated away mid-drain (loadAll took seconds over many pages). */
async function selectAllAcrossPages() {
  const ctx = () => { const x = useDriveV2.getState(); return `${x.accountId}|${x.spaceId ?? ""}|${x.view}|${x.path.at(-1)?.id ?? "root"}`; };
  const before = ctx();
  if (useDriveV2.getState().nextPageToken) await useDriveV2.getState().loadAll();
  if (ctx() !== before) return; // navigated during the drain — don't select in a different context
  useDriveV2.getState().selectAllLoaded();
}

/** Tri-state "Select all / Deselect all" over the currently visible items. */
function SelectAllToggle({ orderedIds }: { orderedIds: string[] }) {
  const selection = useDriveV2((s) => s.selection);
  const nextPageToken = useDriveV2((s) => s.nextPageToken);
  const loadingAll = useDriveV2((s) => s.loadingAll);
  const total = orderedIds.length;
  const sel = orderedIds.reduce((n, id) => n + (selection.has(id) ? 1 : 0), 0);
  const hasMore = !!nextPageToken;
  // "Everything" only when the whole view is loaded — if pages remain, stay indeterminate so the
  // control never claims a full selection it can't guarantee.
  const all = total > 0 && sel === total && !hasMore;
  const some = sel > 0 && !all;
  const Icon = all ? CheckSquare : some ? MinusSquare : Square;
  const label = all ? "Deselect all" : hasMore ? "Select all pages" : "Select all";
  // When more pages exist, drain them first so "select all" genuinely covers the whole view — never a
  // silent subset that a following bulk action would act on.
  const onClick = async () => {
    if (all) { useDriveV2.getState().clearSelection(); return; }
    await selectAllAcrossPages();
  };
  return (
    <button
      onClick={() => void onClick()}
      disabled={total === 0 || loadingAll}
      role="checkbox"
      aria-checked={all ? "true" : some ? "mixed" : "false"}
      className={cn(
        "inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-control)] border px-2.5 text-[13px] transition-colors hover:bg-surface-2 disabled:opacity-50",
        all || some ? "border-primary text-primary" : "border-border text-muted",
      )}
      title={all ? "Deselect all" : hasMore ? "Load every page, then select all" : "Select all"}
    >
      {loadingAll ? <Spinner size={14} /> : <Icon size={15} />} <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

/** A kind filter OR a value-sort (size/modified/type) over a paginated folder only sees the loaded
 *  page, so the result is incomplete/misleading — warn and offer to drain the rest. */
function MoreToLoadNotice() {
  const filterKind = useDriveV2((s) => s.prefs.filterKind);
  const sortKey = useDriveV2((s) => s.prefs.sortKey);
  const nextPageToken = useDriveV2((s) => s.nextPageToken);
  const loadingAll = useDriveV2((s) => s.loadingAll);
  const listLoading = useDriveV2((s) => s.listLoading);
  // A name sort is the browse default; sorting by size/modified/type implies "across everything",
  // where an incomplete ordering is actively wrong (e.g. "largest" showing only page 1's largest).
  const sortMatters = sortKey === "size" || sortKey === "modified" || sortKey === "kind";
  if (!nextPageToken || listLoading || (!filterKind && !sortMatters)) return null;
  const msg = filterKind
    ? "This filter only covers the items loaded so far — matches on later pages aren't shown yet."
    : "This sort only covers the items loaded so far — later pages aren't ordered in yet.";
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 rounded-[var(--radius-control)] border border-border bg-surface-2 px-3 py-2 text-[12.5px] text-muted">
      <Filter size={14} className="shrink-0 text-primary" />
      <span className="min-w-0 flex-1">{msg}</span>
      <Button variant="outline" size="sm" onClick={() => void useDriveV2.getState().loadAll()} disabled={loadingAll}>
        {loadingAll ? <Spinner size={13} /> : null} Load all
      </Button>
    </div>
  );
}

function DriveToolbar({ orderedIds }: { orderedIds: string[] }) {
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

      <SelectAllToggle orderedIds={orderedIds} />

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

      <div className="hidden h-9 items-center rounded-[var(--radius-control)] border border-border p-0.5 sm:flex">
        <button onClick={() => useDriveV2.getState().setDensity("comfortable")} className={cn("grid h-8 w-8 place-items-center rounded-[6px]", prefs.density === "comfortable" ? "bg-surface-2 text-foreground" : "text-muted")} aria-label="Comfortable density" aria-pressed={prefs.density === "comfortable"}><Rows2 size={15} /></button>
        <button onClick={() => useDriveV2.getState().setDensity("compact")} className={cn("grid h-8 w-8 place-items-center rounded-[6px]", prefs.density === "compact" ? "bg-surface-2 text-foreground" : "text-muted")} aria-label="Compact density" aria-pressed={prefs.density === "compact"}><Rows3 size={15} /></button>
      </div>
    </div>
  );
}

/* ── bulk-op progress bar (trash / restore / delete / move) ── */
function BulkProgress() {
  const op = useDriveV2((s) => s.bulkOp);
  if (!op) return null;
  const pct = op.indeterminate ? 100 : op.total > 0 ? Math.round((op.done / op.total) * 100) : 0;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4" aria-live="polite">
      <div className="pointer-events-auto w-full max-w-sm rounded-[var(--radius-card)] border border-border bg-elevated px-4 py-3 shadow-[var(--shadow-pop)]">
        <div className="mb-1.5 flex items-center justify-between text-[12.5px]">
          <span className="inline-flex items-center gap-1.5 font-medium"><Spinner size={13} className="text-primary" /> {op.label}…</span>
          {!op.indeterminate && <span className="tabular text-muted">{op.done} / {op.total}</span>}
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
          <div
            className={cn("h-full rounded-full bg-primary transition-[width] duration-200 ease-out", op.indeterminate && "motion-safe:animate-pulse")}
            style={{ width: `${pct}%` }}
          />
        </div>
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
    let raf = 0;
    let pending: MouseEvent | null = null;
    // The heavy part (DOM query + measure every rendered row) runs at most once per frame — mousemove
    // fires far more often than that, and doing the hit-test on each one janks the drag.
    function compute(e: MouseEvent) {
      const a = anchor.current;
      if (!a) return;
      const x = Math.min(a.x, e.clientX), y = Math.min(a.y, e.clientY);
      const w = Math.abs(e.clientX - a.x), h = Math.abs(e.clientY - a.y);
      if (w < 5 && h < 5) return; // still a click, not a drag
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
    function move(e: MouseEvent) {
      const a = anchor.current;
      if (!a) return;
      // preventDefault synchronously (once past the click threshold) so the browser doesn't start a
      // native text selection while we coalesce the hit-test into the next frame.
      if (Math.abs(e.clientX - a.x) >= 5 || Math.abs(e.clientY - a.y) >= 5) e.preventDefault();
      pending = e;
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; if (pending) compute(pending); });
    }
    function up() { anchor.current = null; setBox(null); if (raf) { cancelAnimationFrame(raf); raf = 0; } pending = null; }
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); if (raf) cancelAnimationFrame(raf); };
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
  view, visible, layout, selection, busyIds, renamingId, handlers, orderedIds, listLoading, refreshing, listError, onUpload, onDropFiles,
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
  refreshing: boolean;
  listError: string | null;
  onUpload: () => void;
  onDropFiles: (files: File[]) => void;
}) {
  const [drag, setDrag] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const canDrop = view === "myDrive";
  const marquee = useMarqueeSelect(scrollRef);

  // ── Keyboard focus cursor. Anchored to a node ID (not an index) so it survives live-sync reorders
  // and inserts. Focus lives on the focused gridcell (roving tabindex). Arrows move it, Enter opens,
  // Space toggles selection, Shift+Arrow selects a range, Ctrl/Cmd+Arrow moves without selecting.
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [focusNonce, setFocusNonce] = useState(0); // bump → scroll + DOM-focus the focused cell
  const [cols, setCols] = useState(1); // 1 for list; the grid reports its real column count
  const pendingKbFocusRef = useRef(false); // re-land focus after a keyboard-driven folder open
  useEffect(() => { if (layout === "list") setCols(1); }, [layout]);

  // Derive the cursor position from the anchored id; falls back to the first item when the id is gone
  // (navigation) so there is always a valid tab target without index drift.
  const focusIdx = Math.max(0, visible.findIndex((n) => n.id === focusedId));

  // After a keyboard Enter opens a folder, the old focused cell unmounts and the browser drops focus to
  // <body> — re-land it on the first cell of the freshly loaded listing so arrow nav keeps working.
  // Guarded by the ref so mouse navigation and live-sync never steal focus into the grid.
  useEffect(() => {
    if (!pendingKbFocusRef.current) return;
    pendingKbFocusRef.current = false;
    if (visible.length) { setFocusedId(visible[0]!.id); setFocusNonce((n) => n + 1); }
  }, [visible]);

  const moveFocus = (index: number, e: ReactKeyboardEvent) => {
    if (!visible.length) return;
    const next = Math.max(0, Math.min(index, visible.length - 1));
    e.preventDefault();
    setFocusedId(visible[next]!.id);
    setFocusNonce((n) => n + 1);
    if (e.ctrlKey || e.metaKey) return; // move the cursor only, keep the selection
    if (e.shiftKey) {
      // Range from the shared anchor (store.lastClickedId — set by click, plain arrow and Space) to the
      // new cursor; marqueeSelect REPLACES the selection, so the range both grows and shrinks. The
      // anchor is intentionally left unchanged so successive Shift+Arrows extend from the same origin.
      const anchorId = useDriveV2.getState().lastClickedId;
      const a = anchorId ? orderedIds.indexOf(anchorId) : -1;
      const from = a < 0 ? next : a;
      useDriveV2.getState().marqueeSelect(orderedIds.slice(Math.min(from, next), Math.max(from, next) + 1));
    } else {
      useDriveV2.getState().toggleSelect(visible[next]!.id, {}, orderedIds); // single-select; sets the anchor
    }
  };

  const onGridKeyDown = (e: ReactKeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (t.closest("input, textarea")) return; // inline rename input owns its keys
    if (t.getAttribute("role") !== "gridcell") return; // act only from the focused cell, never its inner buttons
    if (!visible.length) return;
    switch (e.key) {
      case "ArrowRight": moveFocus(focusIdx + 1, e); break;
      case "ArrowLeft": moveFocus(focusIdx - 1, e); break;
      case "ArrowDown": moveFocus(focusIdx + cols, e); break;
      case "ArrowUp": moveFocus(focusIdx - cols, e); break;
      case "Home": moveFocus(0, e); break;
      case "End": moveFocus(visible.length - 1, e); break;
      case "Enter": { const n = visible[focusIdx]; if (n) { e.preventDefault(); if (n.isFolder) pendingKbFocusRef.current = true; handlers.onOpen(n); } break; }
      case " ": case "Spacebar": { const n = visible[focusIdx]; if (n) { e.preventDefault(); useDriveV2.getState().toggleSelect(n.id, { meta: true }, orderedIds); } break; }
      default: break;
    }
  };

  const rowProps = (node: DriveNode, index: number, colIndex: number): ItemRowProps => ({
    node,
    index,
    colIndex,
    selected: selection.has(node.id),
    busy: busyIds.has(node.id),
    renaming: renamingId === node.id,
    focusable: index === focusIdx,
    onFocusItem: setFocusedId,
    ...handlers,
  });

  // The drop target wraps ALL states so external-file drag-and-drop upload works even in an empty
  // folder. It reacts ONLY to external files — internal node drags are handled by folder/breadcrumb
  // drop targets, so dragging within the grid never shows "Drop to upload".
  return (
    <div
      ref={scrollRef}
      onMouseDown={marquee.onMouseDown}
      onKeyDown={onGridKeyDown}
      onDragOver={canDrop ? (e) => { if (hasExternalFiles(e) && !hasDriveDrag(e)) { e.preventDefault(); setDrag(true); } } : undefined}
      onDragLeave={canDrop ? (e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrag(false); } : undefined}
      onDrop={canDrop ? (e) => { if (!hasExternalFiles(e) || hasDriveDrag(e)) return; e.preventDefault(); setDrag(false); const files = Array.from(e.dataTransfer.files); if (files.length) onDropFiles(files); } : undefined}
      className={cn("relative max-h-[calc(100dvh-13rem)] min-h-[360px] overflow-y-auto overflow-x-hidden rounded-[var(--radius-card)] lg:max-h-none lg:min-h-0 lg:flex-1", drag && "outline-2 -outline-offset-2 outline-dashed outline-primary")}
    >
      {marquee.box && <div className="pointer-events-none fixed z-30 rounded-[3px] border border-primary bg-primary/10" style={{ left: marquee.box.x, top: marquee.box.y, width: marquee.box.w, height: marquee.box.h }} />}
      {drag && <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center bg-primary-soft/40 text-[14px] font-semibold text-primary">Drop to upload here</div>}
      {/* Stale-while-revalidate: a thin top bar while a background refresh runs over a listing that stays
          visible — no full-skeleton flash. Indeterminate pulse; respects prefers-reduced-motion. */}
      {refreshing && !listLoading && (
        <div className="pointer-events-none sticky top-0 z-20 h-0.5 bg-primary motion-safe:animate-pulse" role="status" aria-label="Refreshing" />
      )}
      {listLoading ? (
        <DriveContentSkeleton layout={layout} />
      ) : listError ? (
        <DriveErrorState message={listError} onRetry={() => void useDriveV2.getState().load(true)} />
      ) : !visible.length ? (
        <DriveEmptyState view={view} onUpload={onUpload} />
      ) : layout === "list" ? (
        <VirtualList scrollRef={scrollRef} visible={visible} rowProps={rowProps} focusIdx={focusIdx} focusNonce={focusNonce} />
      ) : (
        <VirtualGrid scrollRef={scrollRef} visible={visible} rowProps={rowProps} focusIdx={focusIdx} focusNonce={focusNonce} onCols={setCols} />
      )}
    </div>
  );
}

type ItemRowProps = { node: DriveNode; index: number; colIndex: number; selected: boolean; busy: boolean; renaming: boolean; focusable: boolean; onFocusItem: (id: string) => void } & ItemHandlers;

type VirtualProps = {
  scrollRef: RefObject<HTMLDivElement | null>;
  visible: DriveNode[];
  rowProps: (n: DriveNode, index: number, colIndex: number) => ItemRowProps;
  focusIdx: number;
  focusNonce: number;
};

/** Move real DOM focus onto the focused cell (roving-tabindex cursor). Fires ONLY on an explicit
 *  keyboard move (focusNonce), never on resize/reflow, so layout changes don't yank focus back into
 *  the grid. Double-rAF so focus still lands when the target row is virtualized in a frame later. */
function useFocusScroll(scrollRef: RefObject<HTMLDivElement | null>, focusIdx: number, focusNonce: number) {
  useEffect(() => {
    if (!focusNonce) return; // don't steal focus on first mount, only on an explicit keyboard move
    const el = scrollRef.current;
    if (!el) return;
    let raf2 = 0;
    const focusTarget = () => (el.querySelector(`[data-idx="${focusIdx}"]`) as HTMLElement | null)?.focus();
    const raf1 = requestAnimationFrame(() => {
      const target = el.querySelector(`[data-idx="${focusIdx}"]`) as HTMLElement | null;
      if (target) target.focus();
      else raf2 = requestAnimationFrame(focusTarget); // row mounted only after the virtualizer re-rendered
    });
    return () => { cancelAnimationFrame(raf1); if (raf2) cancelAnimationFrame(raf2); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNonce]);
}

/** Virtualized list — only the visible rows are mounted, so 10k-item folders stay smooth. Exposed as a
 *  single-column ARIA grid (role=grid/row/gridcell) so per-item buttons are valid cell widgets. */
function VirtualList({ scrollRef, visible, rowProps, focusIdx, focusNonce }: VirtualProps) {
  const compact = useDriveV2((s) => s.prefs.density === "compact");
  const virt = useVirtualizer({ count: visible.length, getScrollElement: () => scrollRef.current, estimateSize: () => (compact ? 40 : 48), overscan: 12 });
  useEffect(() => { if (focusNonce) virt.scrollToIndex(focusIdx, { align: "auto" }); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [focusNonce]);
  useFocusScroll(scrollRef, focusIdx, focusNonce);
  return (
    <div>
      <ListHeader />
      <div role="grid" aria-multiselectable="true" aria-label="Files and folders" aria-rowcount={visible.length} aria-colcount={1} style={{ height: virt.getTotalSize(), position: "relative" }}>
        {virt.getVirtualItems().map((vi) => {
          const n = visible[vi.index]!;
          return (
            <div key={n.id} role="row" aria-rowindex={vi.index + 1} data-index={vi.index} ref={virt.measureElement} style={{ position: "absolute", top: 0, left: 0, right: 0, transform: `translateY(${vi.start}px)` }}>
              <FileRow {...rowProps(n, vi.index, 1)} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Virtualized responsive grid — columns from container width, rows virtualized. Exposed as a 2D ARIA
 *  grid (role=grid/row/gridcell) matching the Left/Right + Up/Down keyboard model. */
function VirtualGrid({ scrollRef, visible, rowProps, focusIdx, focusNonce, onCols }: VirtualProps & { onCols: (n: number) => void }) {
  const gridRef = useRef<HTMLDivElement>(null);
  const [cols, setCols] = useState(4);
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const compute = () => { const w = el.clientWidth; const min = 176, gap = 16; const c = Math.max(1, Math.floor((w + gap) / (min + gap))); setCols(c); onCols(c); };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [onCols]);
  const compact = useDriveV2((s) => s.prefs.density === "compact");
  const rows = Math.ceil(visible.length / cols);
  const virt = useVirtualizer({ count: rows, getScrollElement: () => scrollRef.current, estimateSize: () => (compact ? 176 : 208), overscan: 6, measureElement: (el) => el.getBoundingClientRect().height });
  const focusRow = Math.floor(focusIdx / cols);
  useEffect(() => { if (focusNonce) virt.scrollToIndex(focusRow, { align: "auto" }); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [focusNonce]);
  useFocusScroll(scrollRef, focusIdx, focusNonce);
  return (
    <div ref={gridRef} className="py-2">
      <div role="grid" aria-multiselectable="true" aria-label="Files and folders" aria-rowcount={rows} aria-colcount={cols} style={{ height: virt.getTotalSize(), position: "relative" }}>
        {virt.getVirtualItems().map((vr) => {
          const items = visible.slice(vr.index * cols, vr.index * cols + cols);
          return (
            <div
              key={vr.key}
              role="row"
              aria-rowindex={vr.index + 1}
              data-index={vr.index}
              ref={virt.measureElement}
              style={{ position: "absolute", top: 0, left: 0, right: 0, transform: `translateY(${vr.start}px)`, display: "grid", gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: "16px", paddingBottom: "16px" }}
            >
              {items.map((n, i) => <FileCard key={n.id} {...rowProps(n, vr.index * cols + i, i + 1)} />)}
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
