import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type InputHTMLAttributes, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import {
  ArrowUpDown,
  Bookmark,
  BookmarkPlus,
  Check,
  CheckSquare,
  ChevronRight,
  Command,
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
  Tag,
  LayoutGrid,
  List as ListIcon,
  Rows2,
  Rows3,
  Menu as MenuIcon,
  Palette,
  Pause,
  Pencil,
  Play,
  Plug,
  RefreshCw,
  RotateCcw,
  Search,
  Share2,
  Sparkles,
  Star,
  Trash2,
  Type,
  X,
} from "lucide-react";
import { formatBytes, parseTags, driveExportFormats } from "@kosh/shared";
import { cn } from "@/lib/cn";
import { useData } from "@/data/store";
import { Button, Progress, Spinner } from "@/components/ui";
import { PageSkeleton } from "@/components/PageSkeleton";
import { useBottomStack } from "@/components/Toaster";
import { Menu, MenuItem, MenuLabel, MenuSeparator, Modal, useBodyScrollLock } from "@/components/overlays";
import { PHONE_QUERY, useMediaQuery } from "@/lib/useMediaQuery";
import { startConnect } from "@/lib/connect";
import { filterBucket, type DriveNode, type FilterKind } from "@/data/driveV2Api";
import { useDriveV2, type DriveView, type SortKey } from "@/data/driveV2";
import { useVirtualizer } from "@tanstack/react-virtual";
import { DriveContentSkeleton, DriveEmptyState, DriveErrorState, FileCard, FileRow, ListHeader, sortNodes, type ItemHandlers } from "@/components/drive-v2/items";
import { PageHeader } from "@/components/drive-v2/PageHeader";
import { DriveRail } from "@/components/drive-v2/DriveRail";
import { ContextMenu, type MenuAction } from "@/components/drive-v2/ContextMenu";
import { ChangeFolderColorModal, CreateFolderModal, DeleteConfirmModal, EmptyTrashModal, MoveToModal } from "@/components/drive-v2/modals";
import { ShareModal } from "@/components/drive-v2/ShareModal";
import { BulkRenameModal } from "@/components/drive-v2/BulkRenameModal";
import { InsightsPanel } from "@/components/drive-v2/InsightsPanel";
import { ActivityPanel, ACTION_META } from "@/components/drive-v2/ActivityPanel";
import { RevisionsModal } from "@/components/drive-v2/RevisionsModal";
import { CleanupModal } from "@/components/drive-v2/CleanupModal";
import { DriveDetails, PreviewOverlay } from "@/components/drive-v2/DriveDetails";
import { CommandPalette } from "@/components/drive-v2/CommandPalette";
import { hasDriveDrag, hasExternalFiles, setDragIds } from "@/components/drive-v2/dnd";
import { captureDropEntries, fileListToUploadItems, walkDropEntries } from "@/lib/dropUpload";
import { drivePaneKey, useDriveV2UrlSync } from "@/data/driveV2Url";
import { Collapse, FadeSwap } from "@/components/motion";
import { AnimatePresence, motion } from "motion/react";
import { DUR, EASE, slideUp } from "@/lib/motion";
import { ago } from "@/lib/time";

// `webkitdirectory` turns a file <input> into a folder picker; it isn't in React's input types, so it's
// declared here once and spread onto the hidden folder input. `directory` is the (unprefixed) alias.
const DIRECTORY_INPUT_PROPS = { webkitdirectory: "", directory: "" } as unknown as InputHTMLAttributes<HTMLInputElement>;

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
  // The shell's silhouette (header + card grid) while accounts/config load — no full-viewport spinner.
  if (status === "loading") return <PageSkeleton variant="cards" />;
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
      action={copy.cta ? <Button variant="primary" onClick={() => { void startConnect("google", "drive-v2"); }}><Plug size={15} /> {copy.cta}</Button> : undefined}
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
    store.getState().clearUnread(); // entering Drive in the foreground clears any stale background badge
    // Refocus reconciles without rebuilding a healthy push stream (see resumeSync) — no token re-mint /
    // new Drive watch on every tab switch — and clears the "changed while you were away" badge.
    const onVis = () => { if (document.visibilityState === "visible") { store.getState().resumeSync(); store.getState().clearUnread(); } };
    document.addEventListener("visibilitychange", onVis);
    return () => { document.removeEventListener("visibilitychange", onVis); store.getState().stopSync(); };
  }, [store]);

  // Tab-title badge + optional desktop notification for changes that arrive while the tab is hidden.
  const unread = useDriveV2((s) => s.unread);
  const baseTitleRef = useRef<string>("");
  const prevUnreadRef = useRef(0);
  // Capture the pristine page title once, stripped of any stale "(n) " badge, before the badge effect runs.
  useEffect(() => { baseTitleRef.current = (document.title || "Kosh").replace(/^\(\d+\)\s*/, ""); }, []);
  useEffect(() => {
    const base = baseTitleRef.current || (document.title || "Kosh").replace(/^\(\d+\)\s*/, "");
    document.title = unread > 0 ? `(${unread}) ${base}` : base;
    const prev = prevUnreadRef.current;
    prevUnreadRef.current = unread;
    // Only act when the count GROWS (new arrivals), and only if the user opted in.
    if (unread > prev) {
      const s = store.getState();
      if (s.notifyDesktop && typeof Notification !== "undefined") {
        if (Notification.permission === "granted") {
          if (document.hidden) {
            const delta = unread - prev;
            const latest = s.activity[0];
            const body = latest
              ? `${latest.name} ${ACTION_META[latest.action]?.verb ?? "changed"}${delta > 1 ? ` · +${delta - 1} more` : ""}`
              : `${delta} change${delta === 1 ? "" : "s"} in your Drive`;
            try {
              // One coalescing tag so repeated pings replace rather than stack; click returns to this tab.
              const n = new Notification("Kosh · Drive", { body, tag: "kosh-drive-changes" });
              n.onclick = () => { try { window.focus(); } catch { /* ignore */ } n.close(); };
            } catch { /* notifications unavailable */ }
          }
        } else {
          // Permission was revoked in browser settings after opt-in — reconcile the toggle so it isn't lying.
          void s.setNotifyDesktop(false);
        }
      }
    }
    return () => { document.title = base; };
  }, [unread, store]);

  const [menu, setMenu] = useState<{ ids: string[]; node: DriveNode; x: number; y: number } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  // External drop: read a folder tree (files + subfolders) via the entry API and upload it preserving
  // structure; fall back to a flat file upload when the browser has no entry API. Entries + the file
  // snapshot are captured synchronously (the drop event clears dataTransfer once it returns) before the
  // async tree walk.
  const onDropTransfer = useCallback((dt: DataTransfer) => {
    const entries = captureDropEntries(dt);
    const files = Array.from(dt.files);
    void (async () => {
      if (entries && entries.length) {
        const items = await walkDropEntries(entries);
        if (items.length) void store.getState().uploadDropped(items);
      } else if (files.length) {
        void store.getState().uploadFiles(files);
      }
    })();
  }, [store]);

  // The inspector always opens as a slide-in drawer (a right panel on desktop/tablet, a bottom sheet on
  // phones) rather than reflowing the grid into a third column — one instance, portaled to <body>.
  const phone = useMediaQuery(PHONE_QUERY);

  // Global ⌘K / Ctrl+K opens the command palette; "?" opens the shortcuts sheet.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // stopPropagation so the global shell ⌘K handler (AppShell) doesn't ALSO fire and stack a second palette.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); e.stopPropagation(); setPaletteOpen((v) => !v); return; }
      // "?" (Shift+/) — but never while typing in a field or with a modifier held.
      if (e.key === "?" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const t = e.target as HTMLElement | null;
        if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
        e.preventDefault();
        setShortcutsOpen((v) => !v);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const filterTag = useDriveV2((s) => s.filterTag);
  const visible = useMemo(() => {
    let filtered = prefs.filterKind ? nodes.filter((n) => filterBucket(n) === prefs.filterKind) : nodes;
    if (filterTag) filtered = filtered.filter((n) => parseTags(n).includes(filterTag));
    return sortNodes(filtered, prefs.sortKey, prefs.sortDir);
    // Depend on the specific fields that affect order — not the whole prefs object, so a density/layout
    // toggle doesn't force a full re-filter + re-sort of a large folder.
  }, [nodes, prefs.filterKind, prefs.sortKey, prefs.sortDir, filterTag]);
  const orderedIds = useMemo(() => visible.map((n) => n.id), [visible]);
  const headerStats = useMemo(
    () => ({
      count: visible.length,
      bytes: visible.reduce((a, n) => a + (n.isFolder ? 0 : n.size ?? 0), 0),
      folders: visible.filter((n) => n.isFolder).length,
    }),
    [visible],
  );
  // The inspector's selection total, via an id→size map so it's O(nodes + selection) rather than
  // O(selection × nodes) inline on every render. Skips all work when nothing is selected, so an
  // actively-syncing large folder with no selection doesn't rebuild a map each tick.
  const detailsTotalBytes = useMemo(() => {
    if (!selection.size) return 0;
    const sizeById = new Map<string, number>();
    for (const n of nodes) sizeById.set(n.id, n.isFolder ? 0 : n.size ?? 0);
    let t = 0;
    for (const id of selection) t += sizeById.get(id) ?? 0;
    return t;
  }, [nodes, selection]);


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
    // Portaled dialogs/menus still bubble through the React tree: the Escape that closes them must not
    // also clear the selection they were opened for.
    if (e.target instanceof Element && e.target.closest("[role=dialog],[role=menu]")) return;
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
      onSetTags={(n, tags) => void store.getState().setTags(n.id, tags)}
      onDownload={(n) => void store.getState().downloadNode(n.id)}
    />
  );

  return (
    <div data-drive-shell className="w-full lg:h-[calc(100dvh-7rem)] lg:overflow-hidden" onKeyDown={onKeyDown}>
      <input ref={fileInputRef} type="file" multiple hidden onChange={(e) => { void store.getState().uploadFiles(Array.from(e.target.files ?? [])); if (fileInputRef.current) fileInputRef.current.value = ""; }} />
      {/* Folder picker (webkitdirectory): files come back with webkitRelativePath, so structure is preserved. */}
      <input
        ref={folderInputRef}
        type="file"
        multiple
        hidden
        {...DIRECTORY_INPUT_PROPS}
        onChange={(e) => {
          const items = fileListToUploadItems(e.target.files ?? []);
          if (items.length) void store.getState().uploadDropped(items);
          if (folderInputRef.current) folderInputRef.current.value = "";
        }}
      />
      {/* `grid-cols-1` pins the phone track to minmax(0,1fr): without it the implicit `auto` track sizes
          to the widest unbreakable child (a long e-mail in the mobile bar) and the whole page scrolls sideways.
          The inspector is an overlay drawer (below), so the grid stays two columns regardless. */}
      <div className="grid grid-cols-1 gap-4 lg:h-full lg:min-h-0 lg:gap-6 lg:grid-cols-[auto_minmax(0,1fr)]">
        {/* Mobile: a compact bar with a hamburger that opens the rail as a drawer (the full rail below
            would otherwise bury the file list under the fold on a phone). */}
        <MobileDriveBar onOpenNav={() => setMobileNavOpen(true)} onOpenPalette={() => setPaletteOpen(true)} />
        {/* Desktop: the persistent sidebar rail. */}
        <div className="hidden lg:block lg:h-full lg:min-h-0">
          <DriveRail
            onNewFolder={() => store.getState().openDialog({ kind: "newFolder", parentId: currentFolderId })}
            onUpload={() => fileInputRef.current?.click()}
            onUploadFolder={() => folderInputRef.current?.click()}
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
            {/* One sticky block: the toolbar and the selection bar stay together under the topbar while
                the list scrolls, so the bulk actions never scroll away. */}
            <div className="sticky top-0 z-20">
              <DriveToolbar orderedIds={orderedIds} />
              <Collapse open={selection.size > 0}><SelectionBar /></Collapse>
            </div>
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
              onDropTransfer={onDropTransfer}
            />
            {nextPageToken && !listLoading && (
              <div className="p-3 text-center">
                <Button variant="ghost" size="sm" onClick={() => void store.getState().loadMore()} loading={loadingMore}>
                  <ChevronRight size={14} className="rotate-90" /> Load more
                </Button>
              </div>
            )}
          </div>
          )}
        </FadeSwap>
      </div>

      <MobileRailDrawer
        open={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
        onNewFolder={() => { setMobileNavOpen(false); store.getState().openDialog({ kind: "newFolder", parentId: currentFolderId }); }}
        onUpload={() => { setMobileNavOpen(false); fileInputRef.current?.click(); }}
        onUploadFolder={() => { setMobileNavOpen(false); folderInputRef.current?.click(); }}
      />

      {/* The inspector is a slide-in drawer at every size — a right panel on desktop/tablet, a bottom
          sheet on phones — both with a scrim and safe-area padding. Portaled to <body>, like
          Modal/ContextMenu: the route transition transforms the page for a moment, and a transformed
          ancestor would drag every `fixed` layer along with it. */}
      {createPortal(
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
                className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[1px]"
              />
              <motion.aside
                key={phone ? "inspector-sheet" : "inspector-panel"}
                initial={phone ? { y: "100%" } : { x: "100%" }}
                animate={phone ? { y: 0 } : { x: 0 }}
                exit={phone ? { y: "100%" } : { x: "100%" }}
                transition={{ duration: DUR.slow, ease: EASE.emphasized }}
                className={cn(
                  "fixed z-40 flex flex-col border-border bg-surface shadow-[var(--shadow-pop)]",
                  phone
                    ? "inset-x-0 bottom-0 top-[calc(var(--safe-top)+2.5rem)] rounded-t-[var(--radius-panel)] border-t pb-safe"
                    : "inset-y-0 right-0 w-[92vw] max-w-[420px] border-l pb-safe pt-safe",
                )}
              >
                {phone && (
                  <div className="flex shrink-0 justify-center pt-2" aria-hidden>
                    <span className="h-1 w-9 rounded-full bg-border-strong" />
                  </div>
                )}
                {inspectorEl}
              </motion.aside>
            </>
          )}
        </AnimatePresence>,
        document.body,
      )}

      {/* Bottom-anchored layers stack in one column (bulk-op progress above the upload tray) so neither
          hides the other; the stack's height is published as --bottom-stack for the Toaster. */}
      {createPortal(
        <BottomStack>
          <BulkProgress />
          {hasUploads && <UploadTray />}
        </BottomStack>,
        document.body,
      )}

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} onUpload={() => fileInputRef.current?.click()} />
      <ShortcutsSheet open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      {menu && <ContextMenu x={menu.x} y={menu.y} actions={menuActions} onClose={() => setMenu(null)} />}
      {dialog?.kind === "newFolder" && <CreateFolderModal parentId={dialog.parentId} onClose={() => store.getState().closeDialog()} />}
      {dialog?.kind === "delete" && <DeleteConfirmModal ids={dialog.ids} permanent={dialog.permanent} onClose={() => store.getState().closeDialog()} />}
      {dialog?.kind === "move" && <MoveToModal ids={dialog.ids} onClose={() => store.getState().closeDialog()} />}
      {dialog?.kind === "share" && <ShareModal node={dialog.node} onClose={() => store.getState().closeDialog()} />}
      {dialog?.kind === "rename-bulk" && <BulkRenameModal ids={dialog.ids} onClose={() => store.getState().closeDialog()} />}
      {dialog?.kind === "revisions" && <RevisionsModal node={dialog.node} onClose={() => store.getState().closeDialog()} />}
      {dialog?.kind === "folderColor" && <ChangeFolderColorModal node={dialog.node} onClose={() => store.getState().closeDialog()} />}
      {dialog?.kind === "empty-trash" && <EmptyTrashModal onClose={() => store.getState().closeDialog()} />}
      {dialog?.kind === "cleanup" && <CleanupModal onClose={() => store.getState().closeDialog()} />}
      {previewNode && <PreviewOverlay node={previewNode} list={visible} onClose={() => store.getState().setPreview(null)} />}
    </div>
  );
}

/* ── mobile top bar + rail drawer (shown below lg, where the full sidebar would bury the file list) ── */
function MobileDriveBar({ onOpenNav, onOpenPalette }: { onOpenNav: () => void; onOpenPalette: () => void }) {
  const accounts = useDriveV2((s) => s.accounts);
  const accountId = useDriveV2((s) => s.accountId);
  const spaceId = useDriveV2((s) => s.spaceId);
  const spaceName = useDriveV2((s) => s.spaceName);
  const account = accounts.find((a) => a.id === accountId);
  return (
    // `min-w-0` lets the truncated name/e-mail actually shrink instead of widening the grid track.
    <div className="flex min-w-0 items-center gap-2.5 rounded-[var(--radius-panel)] border border-border bg-surface px-2.5 py-2 lg:hidden">
      <Button variant="outline" size="icon" onClick={onOpenNav} aria-label="Open navigation menu" className="shrink-0 text-muted">
        <MenuIcon size={18} />
      </Button>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-semibold leading-tight">{spaceId ? spaceName ?? "Shared drive" : account?.name ?? "Drive"}</div>
        <div className="truncate text-[11px] text-muted">{spaceId ? "Shared drive" : account?.email ?? ""}</div>
      </div>
      {/* The ⌘K palette (search + selection actions) has no keyboard on a phone — give it a button. */}
      <Button variant="ghost" size="icon" onClick={onOpenPalette} aria-label="Command palette" className="shrink-0">
        <Command size={17} />
      </Button>
    </div>
  );
}

function MobileRailDrawer({ open, onClose, onNewFolder, onUpload, onUploadFolder }: { open: boolean; onClose: () => void; onNewFolder: () => void; onUpload: () => void; onUploadFolder?: () => void }) {
  useBodyScrollLock(open);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  // Portaled to <body> so the page transition's transform can't displace the fixed drawer.
  return createPortal(
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
            className="fixed inset-y-0 left-0 z-40 w-[84vw] max-w-[300px] p-2 pb-[calc(0.5rem+var(--safe-bottom))] pt-[calc(0.5rem+var(--safe-top))] lg:hidden"
          >
            <DriveRail variant="drawer" onNavigate={onClose} onNewFolder={onNewFolder} onUpload={onUpload} onUploadFolder={onUploadFolder} />
            {/* An explicit close control (the scrim alone is not discoverable); sits on the drawer's edge. */}
            <Button variant="secondary" size="icon" onClick={onClose} aria-label="Close menu" className="absolute -right-12 top-[calc(0.75rem+var(--safe-top))] shadow-[var(--shadow-pop)]">
              <X size={18} />
            </Button>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body,
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
    if (!node.isFolder) {
      // Binary files download via the OAuth token (alt=media); native Google docs are exported to a
      // chosen format (files.export) — they have no downloadable bytes.
      const exportFmts = driveExportFormats(node.mimeType);
      if (exportFmts.length) {
        for (const f of exportFmts) a.push({ label: `Export as ${f.label}`, icon: Download, onClick: () => void s.exportNode(node.id, f.mimeType, f.ext) });
      } else {
        a.push({ label: "Download", icon: Download, onClick: () => void s.downloadNode(node.id) });
      }
    }
    if (node.capabilities?.canRename !== false) a.push({ label: "Rename", icon: Pencil, shortcut: "F2", onClick: () => ctx.setRenamingId(node.id) });
    // Change folder color after creation — the full Google Drive palette, applied in place.
    if (node.isFolder && node.capabilities?.canEdit !== false) a.push({ label: "Change color…", icon: Palette, onClick: () => s.openDialog({ kind: "folderColor", node }) });
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

/** Human direction label for the active sort — reads naturally per key (Newest/Largest/A→Z). */
function sortDirLabel(key: SortKey, dir: "asc" | "desc"): string {
  if (key === "created" || key === "modified") return dir === "desc" ? "Newest" : "Oldest";
  if (key === "size") return dir === "desc" ? "Largest" : "Smallest";
  return dir === "asc" ? "A→Z" : "Z→A";
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
      aria-label={`${label} — open activity`}
      title={sync.via === "push" ? "Live push sync with Google Drive — open activity" : "Live two-way sync with Google Drive — open activity"}
      className={cn(TOOL_BTN, "min-w-9 justify-center gap-1.5 px-2.5 text-[12px] text-muted [@media(pointer:coarse)]:min-w-10")}
    >
      {sync.status === "syncing" ? <RefreshCw size={13} className="animate-spin text-primary" /> : <span className={cn("h-1.5 w-1.5 rounded-full", dot)} />}
      <span className="hidden md:inline">{label}</span>
    </button>
  );
}

/* ── toolbar (utility strip on the borderless canvas) ── */
// Raw toolbar controls: 36px on desktop, the 40px floor on touch screens, press feedback on tap.
const TOOL_BTN = "pressable inline-flex h-9 shrink-0 items-center rounded-[var(--radius-control)] border border-border transition-colors hover:bg-surface-2 [@media(pointer:coarse)]:h-10";
const TOOL_ICON_BTN = cn(TOOL_BTN, "w-9 justify-center text-muted [@media(pointer:coarse)]:w-10");
// A half of a segmented toggle (grid/list, density): fills the 36/40px frame minus its 2px padding.
const SEG_BTN = "pressable grid h-8 w-8 place-items-center rounded-[6px] [@media(pointer:coarse)]:h-9 [@media(pointer:coarse)]:w-10";

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
        TOOL_BTN,
        "gap-1.5 px-2.5 text-[13px] disabled:opacity-50",
        all || some ? "border-primary text-primary" : "text-muted",
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
  // Sorting by a value (size/modified/created/type) implies "across everything", where an incomplete
  // ordering is actively wrong (e.g. "largest" or "newest" showing only page 1's). A name sort is the
  // one that reads fine page-by-page. (My Drive is fetched already server-ordered, so page 1 does hold
  // the true top items there — but recent/starred/search etc. are not, so still offer "Load all".)
  const sortMatters = sortKey === "size" || sortKey === "modified" || sortKey === "kind" || sortKey === "created";
  if (!nextPageToken || listLoading || (!filterKind && !sortMatters)) return null;
  const msg = filterKind
    ? "This filter only covers the items loaded so far — matches on later pages aren't shown yet."
    : "This sort only covers the items loaded so far — later pages aren't ordered in yet.";
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 rounded-[var(--radius-control)] border border-border bg-surface-2 px-3 py-2 text-[12.5px] text-muted">
      <Filter size={14} className="shrink-0 text-primary" />
      <span className="min-w-0 flex-1">{msg}</span>
      <Button variant="outline" size="sm" onClick={() => void useDriveV2.getState().loadAll()} loading={loadingAll}>
        Load all
      </Button>
    </div>
  );
}

function DriveToolbar({ orderedIds }: { orderedIds: string[] }) {
  const view = useDriveV2((s) => s.view);
  const prefs = useDriveV2((s) => s.prefs);
  const searchQuery = useDriveV2((s) => s.searchQuery);
  const collections = useDriveV2((s) => s.collections);
  const aiEnabled = useDriveV2((s) => s.aiEnabled);
  const aiSearchBusy = useDriveV2((s) => s.aiSearchBusy);
  const aiSearchNote = useDriveV2((s) => s.aiSearchNote);
  const phone = useMediaQuery(PHONE_QUERY);
  const [q, setQ] = useState(searchQuery);

  useEffect(() => setQ(searchQuery), [searchQuery]);
  // Debounced search.
  useEffect(() => {
    if (view !== "search" && q === "") return;
    // Already showing results for exactly this query (e.g. a collection just set searchQuery) — don't
    // fire an identical second search.
    if (view === "search" && q.trim() === useDriveV2.getState().searchQuery) return;
    const t = window.setTimeout(() => {
      if (q.trim()) useDriveV2.getState().runSearch(q.trim());
      else if (view === "search") useDriveV2.getState().clearSearch();
    }, 250);
    return () => window.clearTimeout(t);
  }, [q, view]);

  const SORTS: { k: SortKey; label: string }[] = [{ k: "created", label: "Recently uploaded" }, { k: "modified", label: "Last modified" }, { k: "name", label: "Name" }, { k: "size", label: "Size" }, { k: "kind", label: "Type" }];
  const FILTERS: { k: FilterKind | null; label: string }[] = [
    { k: null, label: "All items" }, { k: "folder", label: "Folders" }, { k: "doc", label: "Documents" }, { k: "image", label: "Images" }, { k: "video", label: "Videos" }, { k: "pdf", label: "PDFs" }, { k: "audio", label: "Audio" }, { k: "archive", label: "Archives" },
  ];

  return (
    // The block above is sticky (Shell); this strip only paints the frosted background.
    <div className="flex flex-wrap items-center gap-2 border-b border-border bg-background/80 py-2 backdrop-blur">
      {/* Phones: the search field takes its own full-width row (it used to shrink to an icon next to
          five fixed controls); from sm it shares the row and grows to fill. */}
      <label className="flex h-9 min-w-[160px] basis-full items-center gap-2 rounded-[var(--radius-control)] border border-border bg-surface-2 px-2.5 focus-within:border-primary focus-within:ring-focus sm:mr-auto sm:min-w-0 sm:basis-auto sm:flex-1 sm:max-w-sm [@media(pointer:coarse)]:h-10">
        <Search size={15} className="shrink-0 text-muted" />
        <span className="hidden shrink-0 rounded-[var(--radius-chip)] bg-surface-3 px-1.5 py-0.5 text-[11px] capitalize text-muted sm:inline">{view === "myDrive" ? "My Drive" : view === "search" ? "results" : view}</span>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={phone ? (aiEnabled ? "Search or ask AI…" : "Search Drive…") : aiEnabled ? "Search or ask AI… (⌘K)" : "Search Drive… (⌘K)"}
          // 16px on phones: iOS Safari zooms into any smaller focused field and stays zoomed.
          className="min-w-0 flex-1 self-stretch bg-transparent text-base outline-none sm:text-[13px]"
        />
        {aiEnabled && q.trim() && (
          aiSearchBusy ? (
            <Spinner size={14} className="shrink-0 text-primary" />
          ) : (
            <button
              onClick={() => void useDriveV2.getState().aiSearch(q.trim())}
              aria-label="Search with AI"
              title="Interpret this with AI"
              className="pressable -my-2 grid h-9 w-9 shrink-0 place-items-center text-primary transition-opacity hover:opacity-70 [@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:w-10"
            ><Sparkles size={15} /></button>
          )
        )}
        {q && <button onClick={() => setQ("")} aria-label="Clear search" className="pressable -my-2 -mr-2 grid h-9 w-9 shrink-0 place-items-center [@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:w-10"><X size={14} className="text-faint hover:text-foreground" /></button>}
      </label>

      {/* Phones: the controls are one sideways-scrolling row under the search field (three wrapped
          rows of sticky toolbar ate the screen); from sm the wrapper dissolves (`contents`) and the
          controls wrap in the strip as before. */}
      <div className="flex min-w-0 basis-full items-center gap-2 overflow-x-auto pb-px [scrollbar-width:none] sm:contents [&::-webkit-scrollbar]:hidden">
      <SyncPill />

      <Menu align="end" width={248} trigger={({ toggle, ref }) => (
        <button ref={ref} onClick={toggle} className={TOOL_ICON_BTN} aria-label="Smart collections"><Bookmark size={15} /></button>
      )}>
        <MenuLabel>Collections</MenuLabel>
        {collections.length === 0 && <div className="px-2.5 py-2 text-[12.5px] text-muted">No collections yet. Search, then save it.</div>}
        {collections.map((c) => (
          <div key={c.id} className="flex items-center gap-1 pr-1">
            <button onClick={() => useDriveV2.getState().openCollection(c)} className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] hover:bg-surface-2" title={c.query}><Bookmark size={13} className="shrink-0 text-muted" /><span className="min-w-0 flex-1 truncate">{c.name}</span></button>
            <button onClick={() => useDriveV2.getState().removeCollection(c.id)} className="shrink-0 rounded p-1 text-faint hover:text-danger" aria-label="Remove collection"><X size={13} /></button>
          </div>
        ))}
        <MenuSeparator />
        <MenuItem icon={BookmarkPlus} disabled={!q.trim()} onClick={() => useDriveV2.getState().saveCollection(q.trim(), q.trim())}>Save current search</MenuItem>
      </Menu>

      <SelectAllToggle orderedIds={orderedIds} />

      <Menu align="end" width={200} trigger={({ toggle, ref }) => (
        <button ref={ref} onClick={toggle} className={cn(TOOL_BTN, "gap-1.5 px-2.5 text-[13px] text-muted")}><ArrowUpDown size={15} /> Sort</button>
      )}>
        <MenuLabel>Sort by</MenuLabel>
        {SORTS.map((s) => (
          <MenuItem key={s.k} icon={prefs.sortKey === s.k ? Check : undefined} onClick={() => useDriveV2.getState().setSort(s.k)}>
            {s.label}{prefs.sortKey === s.k ? ` (${sortDirLabel(s.k, prefs.sortDir)})` : ""}
          </MenuItem>
        ))}
      </Menu>

      <Menu align="end" width={190} trigger={({ toggle, ref }) => (
        <button ref={ref} onClick={toggle} className={cn(TOOL_BTN, "gap-1.5 px-2.5 text-[13px]", prefs.filterKind ? "border-primary text-primary" : "text-muted")}><Filter size={15} /> Filter</button>
      )}>
        <MenuLabel>Show</MenuLabel>
        {FILTERS.map((f) => (
          <MenuItem key={f.label} icon={prefs.filterKind === f.k ? Check : undefined} onClick={() => useDriveV2.getState().setFilter(f.k)}>{f.label}</MenuItem>
        ))}
      </Menu>

      <TagFilter />

      <div className="flex h-9 shrink-0 items-center rounded-[var(--radius-control)] border border-border p-0.5 [@media(pointer:coarse)]:h-10">
        <button onClick={() => useDriveV2.getState().setLayout("grid")} className={cn(SEG_BTN, prefs.layout === "grid" ? "bg-surface-2 text-foreground" : "text-muted")} aria-label="Grid view" aria-pressed={prefs.layout === "grid"}><LayoutGrid size={15} /></button>
        <button onClick={() => useDriveV2.getState().setLayout("list")} className={cn(SEG_BTN, prefs.layout === "list" ? "bg-surface-2 text-foreground" : "text-muted")} aria-label="List view" aria-pressed={prefs.layout === "list"}><ListIcon size={15} /></button>
      </div>

      <div className="hidden h-9 shrink-0 items-center rounded-[var(--radius-control)] border border-border p-0.5 sm:flex [@media(pointer:coarse)]:h-10">
        <button onClick={() => useDriveV2.getState().setDensity("comfortable")} className={cn(SEG_BTN, prefs.density === "comfortable" ? "bg-surface-2 text-foreground" : "text-muted")} aria-label="Comfortable density" aria-pressed={prefs.density === "comfortable"}><Rows2 size={15} /></button>
        <button onClick={() => useDriveV2.getState().setDensity("compact")} className={cn(SEG_BTN, prefs.density === "compact" ? "bg-surface-2 text-foreground" : "text-muted")} aria-label="Compact density" aria-pressed={prefs.density === "compact"}><Rows3 size={15} /></button>
      </div>
      </div>

      {aiSearchNote && view === "search" && (
        <div className="flex basis-full items-center gap-1.5 text-[11.5px] text-muted" aria-live="polite">
          <Sparkles size={12} className="shrink-0 text-primary" />
          <span className="min-w-0 truncate">{aiSearchNote}</span>
        </div>
      )}
    </div>
  );
}

/* ── keyboard shortcuts cheat sheet (opened with "?") ── */
const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform || "");
const MOD = IS_MAC ? "⌘" : "Ctrl";
const SHORTCUTS: { keys: string; label: string }[] = [
  { keys: `${MOD} K`, label: "Command palette (search + actions on the selection)" },
  { keys: `${MOD} A`, label: "Select everything in the view" },
  { keys: "↑ ↓ ← → / h j k l", label: "Move the focus cursor" },
  { keys: "Enter", label: "Open the focused folder or preview the file" },
  { keys: "Space", label: "Toggle selection of the focused item" },
  { keys: "F2", label: "Rename the selected item" },
  { keys: "Del / ⌫", label: "Move selection to trash (delete forever in Trash)" },
  { keys: "Esc", label: "Clear the selection / close the inspector" },
  { keys: "?", label: "Show this shortcuts sheet" },
];
function ShortcutsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} className="max-w-md">
      <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
        <h2 className="font-display text-[15px] font-semibold">Keyboard shortcuts</h2>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close"><X size={16} /></Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <dl className="flex flex-col gap-2">
          {SHORTCUTS.map((s) => (
            <div key={s.label} className="flex items-center justify-between gap-4">
              <dt className="text-[13px] text-muted">{s.label}</dt>
              <dd className="shrink-0"><kbd className="rounded-[var(--radius-chip)] border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-foreground">{s.keys}</kbd></dd>
            </div>
          ))}
        </dl>
      </div>
    </Modal>
  );
}

/* ── tag filter (client-side over the loaded view, like the kind filter) ── */
function TagFilter() {
  const nodes = useDriveV2((s) => s.nodes);
  const filterTag = useDriveV2((s) => s.filterTag);
  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const n of nodes) for (const t of parseTags(n)) set.add(t);
    if (filterTag) set.add(filterTag); // keep the active tag listed even if it's off the loaded pages
    return [...set].sort();
  }, [nodes, filterTag]);
  if (!allTags.length) return null;
  return (
    <Menu align="end" width={220} trigger={({ toggle, ref }) => (
      <button ref={ref} onClick={toggle} className={cn(TOOL_BTN, "gap-1.5 px-2.5 text-[13px]", filterTag ? "border-primary text-primary" : "text-muted")}>
        <Tag size={15} /> {filterTag ? `#${filterTag}` : "Tags"}
      </button>
    )}>
      <MenuLabel>Filter by tag (loaded items)</MenuLabel>
      {filterTag && <MenuItem icon={X} onClick={() => useDriveV2.getState().setFilterTag(null)}>Clear tag filter</MenuItem>}
      {allTags.map((t) => (
        <MenuItem key={t} icon={filterTag === t ? Check : undefined} onClick={() => useDriveV2.getState().setFilterTag(filterTag === t ? null : t)}>{t}</MenuItem>
      ))}
    </Menu>
  );
}

/* ── bulk-op progress bar (trash / restore / delete / move) ── */
/** Slides up into the bottom stack while an op runs and fades out when it's done. */
function BulkProgress() {
  const op = useDriveV2((s) => s.bulkOp);
  const pct = op ? (op.indeterminate ? 100 : op.total > 0 ? Math.round((op.done / op.total) * 100) : 0) : 0;
  return (
    <AnimatePresence>
      {op && (
        <motion.div
          key="bulk-op"
          variants={slideUp}
          initial="hidden"
          animate="show"
          exit="exit"
          aria-live="polite"
          className="pointer-events-auto w-full rounded-[var(--radius-card)] border border-border bg-elevated px-4 py-3 shadow-[var(--shadow-pop)] sm:w-80"
        >
          <div className="mb-1.5 flex items-center justify-between text-[12.5px]">
            <span className="inline-flex items-center gap-1.5 font-medium"><Spinner size={13} className="text-primary" /> {op.label}…</span>
            {!op.indeterminate && <span className="tabular text-muted">{op.done} / {op.total}</span>}
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
            {op.indeterminate ? (
              <div className="progress-indeterminate h-full w-2/5 rounded-full bg-primary" />
            ) : (
              <div className="h-full rounded-full bg-primary transition-[width] duration-[var(--motion-base)] ease-out" style={{ width: `${pct}%` }} />
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** The column of bottom-anchored cards (bulk progress, upload tray). Sits above the home indicator and
 *  publishes its height as `--bottom-stack` on <html> so the Toaster can rise above it. */
function BottomStack({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useBottomStack(ref);
  return (
    <div ref={ref} className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-stretch gap-2 px-4 pb-[calc(1rem+var(--safe-bottom))] sm:items-end">
      {children}
    </div>
  );
}

/* ── selection action bar ── */
function SelectionBar() {
  const selection = useDriveV2((s) => s.selection);
  const view = useDriveV2((s) => s.view);
  const nodes = useDriveV2((s) => s.nodes);
  const s = useDriveV2.getState;
  // The bar collapses out AFTER the selection is cleared — keep the last non-empty ids through the exit
  // animation so it never flashes "0 selected" on its way out.
  const lastIds = useRef<string[]>([]);
  if (selection.size) lastIds.current = [...selection];
  const ids = lastIds.current;
  // Total size of the selection — the aggregate inspector only exists in the docked lg+ column, so on
  // phones this line is the one place to read it.
  const totalBytes = useMemo(() => {
    let t = 0;
    for (const n of nodes) if (selection.has(n.id) && !n.isFolder) t += n.size ?? 0;
    return t;
  }, [nodes, selection]);
  return (
    <div className="flex items-center gap-2 border-b border-border bg-primary-soft/50 px-2 py-1.5 text-[13px] backdrop-blur sm:px-3">
      <Button variant="ghost" size="icon-sm" className="shrink-0" onClick={() => s().clearSelection()} aria-label="Clear selection"><X size={15} /></Button>
      <span className="shrink-0 font-medium">{ids.length} selected</span>
      {totalBytes > 0 && <span className="hidden shrink-0 font-mono text-[11.5px] tabular text-muted min-[400px]:inline">· {formatBytes(totalBytes)}</span>}
      {/* The actions scroll sideways on phones (Move/Trash used to be cut off past the right edge). */}
      <div className="ml-auto flex min-w-0 items-center gap-1 overflow-x-auto [scrollbar-width:none] sm:flex-none [&::-webkit-scrollbar]:hidden">
        {view === "trash" ? (
          <>
            <Button variant="ghost" size="sm" className="shrink-0" onClick={() => void s().restore(ids)}><RotateCcw size={14} /> Restore</Button>
            <Button variant="ghost" size="sm" className="shrink-0 text-danger" onClick={() => s().openDialog({ kind: "delete", ids, permanent: true })}><Trash2 size={14} /> Delete forever</Button>
          </>
        ) : (
          <>
            <Button variant="ghost" size="sm" className="shrink-0" onClick={() => void s().toggleStarMany(ids)}><Star size={14} /> Star</Button>
            <Button variant="ghost" size="sm" className="shrink-0" onClick={() => (ids.length === 1 ? void s().downloadNode(ids[0]!) : void s().downloadZip(ids))}><Download size={14} /> Download</Button>
            {ids.length > 1 && <Button variant="ghost" size="sm" className="shrink-0" onClick={() => s().openDialog({ kind: "rename-bulk", ids })}><Type size={14} /> Rename</Button>}
            <Button variant="ghost" size="sm" className="shrink-0" onClick={() => s().openDialog({ kind: "move", ids })}><CornerUpRight size={14} /> Move</Button>
            <Button variant="ghost" size="sm" className="shrink-0 text-danger" onClick={() => s().openDialog({ kind: "delete", ids, permanent: false })}><Trash2 size={14} /> Trash</Button>
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
      if (![x, y, w, h].every(Number.isFinite)) return; // a synthetic event without coordinates — never style `left: NaN`
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
    function up() {
      if (pending && anchor.current) compute(pending); // flush the last frame so a fast drag+release doesn't drop items covered only in the final move
      anchor.current = null;
      setBox(null);
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      pending = null;
    }
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
  view, visible, layout, selection, busyIds, renamingId, handlers, orderedIds, listLoading, refreshing, listError, onUpload, onDropTransfer,
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
  onDropTransfer: (dt: DataTransfer) => void;
}) {
  const [drag, setDrag] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const canDrop = view === "myDrive";
  const marquee = useMarqueeSelect(scrollRef);
  const filterTag = useDriveV2((s) => s.filterTag);
  // Below lg the page (`main`) is the only scroller: the list virtualizes against it (with a scroll
  // margin for everything above the rows) instead of living in a nested max-height box — no scroll
  // trap, and "Load more" sits in normal flow right under the rows. On lg the content div scrolls.
  const isLg = useMediaQuery("(min-width: 1024px)");
  const getScrollEl = useCallback(
    () => (isLg ? scrollRef.current : (scrollRef.current?.closest("main") as HTMLElement | null) ?? scrollRef.current),
    [isLg],
  );

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
      case "ArrowRight": case "l": moveFocus(focusIdx + 1, e); break;
      case "ArrowLeft": case "h": moveFocus(focusIdx - 1, e); break;
      case "ArrowDown": case "j": moveFocus(focusIdx + cols, e); break; // vim-style row nav
      case "ArrowUp": case "k": moveFocus(focusIdx - cols, e); break;
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
      onDrop={canDrop ? (e) => { if (!hasExternalFiles(e) || hasDriveDrag(e)) return; e.preventDefault(); setDrag(false); onDropTransfer(e.dataTransfer); } : undefined}
      // `overflow-x-clip` (not hidden) below lg: it clips without turning the div into a scroll box.
      className={cn("relative min-h-[360px] overflow-x-clip rounded-[var(--radius-card)] lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:overflow-x-hidden", drag && "outline-2 -outline-offset-2 outline-dashed outline-primary")}
    >
      {marquee.box && <div className="pointer-events-none fixed z-30 rounded-[3px] border border-primary bg-primary/10" style={{ left: marquee.box.x, top: marquee.box.y, width: marquee.box.w, height: marquee.box.h }} />}
      {drag && <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center bg-primary-soft/40 text-[14px] font-semibold text-primary">Drop to upload here</div>}
      {/* Stale-while-revalidate: a thin top bar while a background refresh runs over a listing that stays
          visible — no full-skeleton flash. Indeterminate sweep; static under prefers-reduced-motion. */}
      {refreshing && !listLoading && (
        <div className="pointer-events-none sticky top-0 z-20 h-0.5 overflow-hidden" role="status" aria-label="Refreshing">
          <div className="progress-indeterminate h-full w-2/5 bg-primary" />
        </div>
      )}
      {/* The only animated boundary around the virtualized rows: a crossfade between skeleton, states
          and content, and between the grid and list layouts. */}
      <FadeSwap k={`${layout}|${listLoading ? "loading" : listError ? "error" : visible.length ? "content" : "empty"}`}>
        {listLoading ? (
          <DriveContentSkeleton layout={layout} />
        ) : listError ? (
          <DriveErrorState message={listError} onRetry={() => void useDriveV2.getState().load(true)} />
        ) : !visible.length ? (
          filterTag ? (
            <div className="grid min-h-[360px] place-items-center p-6 text-center">
              <div>
                <div className="font-display text-[15px] font-semibold">No loaded items tagged <span className="text-primary">#{filterTag}</span></div>
                <p className="mx-auto mt-1.5 max-w-xs text-[13px] text-muted">Tag filtering applies to items already loaded. Load more, or clear the filter.</p>
                <Button variant="ghost" size="sm" className="mx-auto mt-4" onClick={() => useDriveV2.getState().setFilterTag(null)}>Clear tag filter</Button>
              </div>
            </div>
          ) : (
            <DriveEmptyState view={view} onUpload={onUpload} />
          )
        ) : layout === "list" ? (
          <VirtualList scrollRef={scrollRef} getScrollEl={getScrollEl} visible={visible} rowProps={rowProps} focusIdx={focusIdx} focusNonce={focusNonce} />
        ) : (
          <VirtualGrid scrollRef={scrollRef} getScrollEl={getScrollEl} visible={visible} rowProps={rowProps} focusIdx={focusIdx} focusNonce={focusNonce} onCols={setCols} />
        )}
      </FadeSwap>
    </div>
  );
}

type ItemRowProps = { node: DriveNode; index: number; colIndex: number; selected: boolean; busy: boolean; renaming: boolean; focusable: boolean; onFocusItem: (id: string) => void } & ItemHandlers;

type VirtualProps = {
  scrollRef: RefObject<HTMLDivElement | null>;
  /** The element the virtualizer scrolls against — the content div on lg, the page's `main` below. */
  getScrollEl: () => HTMLElement | null;
  visible: DriveNode[];
  rowProps: (n: DriveNode, index: number, colIndex: number) => ItemRowProps;
  focusIdx: number;
  focusNonce: number;
};

/** Distance from the scroll element's top to the list's top, so a list virtualized against the page
 *  knows where its rows begin. Re-measured whenever the Drive shell resizes (selection bar collapsing,
 *  header/toolbar wrapping) — a layout read, but only on those events. Zero when the list's own
 *  container is the scroller (lg+). */
function useScrollMargin(listRef: RefObject<HTMLDivElement | null>, getScrollEl: () => HTMLElement | null): number {
  const [margin, setMargin] = useState(0);
  useLayoutEffect(() => {
    const list = listRef.current;
    const sc = getScrollEl();
    const shell = list?.closest<HTMLElement>("[data-drive-shell]");
    if (!list || !sc || !shell) return;
    if (!sc.contains(shell)) { setMargin(0); return; } // the content div itself scrolls — rows start at 0
    const measure = () => setMargin(Math.max(0, Math.round(list.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(shell);
    return () => ro.disconnect();
  }, [listRef, getScrollEl]);
  return margin;
}

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
function VirtualList({ scrollRef, getScrollEl, visible, rowProps, focusIdx, focusNonce }: VirtualProps) {
  const compact = useDriveV2((s) => s.prefs.density === "compact");
  const listRef = useRef<HTMLDivElement>(null);
  const scrollMargin = useScrollMargin(listRef, getScrollEl);
  const virt = useVirtualizer({ count: visible.length, getScrollElement: getScrollEl, estimateSize: () => (compact ? 40 : 48), overscan: 12, scrollMargin });
  useEffect(() => { if (focusNonce) virt.scrollToIndex(focusIdx, { align: "auto" }); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [focusNonce]);
  useFocusScroll(scrollRef, focusIdx, focusNonce);
  return (
    <div>
      <ListHeader />
      <div ref={listRef} role="grid" aria-multiselectable="true" aria-label="Files and folders" aria-rowcount={visible.length} aria-colcount={1} style={{ height: virt.getTotalSize(), position: "relative" }}>
        {virt.getVirtualItems().map((vi) => {
          const n = visible[vi.index]!;
          return (
            <div key={n.id} role="row" aria-rowindex={vi.index + 1} data-index={vi.index} ref={virt.measureElement} style={{ position: "absolute", top: 0, left: 0, right: 0, transform: `translateY(${vi.start - scrollMargin}px)` }}>
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
function VirtualGrid({ scrollRef, getScrollEl, visible, rowProps, focusIdx, focusNonce, onCols }: VirtualProps & { onCols: (n: number) => void }) {
  const gridRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [cols, setCols] = useState(4);
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    // Narrower minimum on phones so 360–430px screens get two columns instead of a single tall card.
    const compute = () => { const w = el.clientWidth; const min = w < 640 ? 140 : 176, gap = 16; const c = Math.max(1, Math.floor((w + gap) / (min + gap))); setCols(c); setNarrow(w < 640); onCols(c); };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [onCols]);
  const compact = useDriveV2((s) => s.prefs.density === "compact");
  const rows = Math.ceil(visible.length / cols);
  const scrollMargin = useScrollMargin(listRef, getScrollEl);
  // Phone cards have a 112px hero and a two-line name (~196px + gap); desktop 144px hero (~208px).
  const virt = useVirtualizer({ count: rows, getScrollElement: getScrollEl, estimateSize: () => (compact ? 176 : narrow ? 212 : 208), overscan: 6, measureElement: (el) => el.getBoundingClientRect().height, scrollMargin });
  const focusRow = Math.floor(focusIdx / cols);
  useEffect(() => { if (focusNonce) virt.scrollToIndex(focusRow, { align: "auto" }); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [focusNonce]);
  useFocusScroll(scrollRef, focusIdx, focusNonce);
  return (
    <div ref={gridRef} className="py-2">
      <div ref={listRef} role="grid" aria-multiselectable="true" aria-label="Files and folders" aria-rowcount={rows} aria-colcount={cols} style={{ height: virt.getTotalSize(), position: "relative" }}>
        {virt.getVirtualItems().map((vr) => {
          const items = visible.slice(vr.index * cols, vr.index * cols + cols);
          return (
            <div
              key={vr.key}
              role="row"
              aria-rowindex={vr.index + 1}
              data-index={vr.index}
              ref={virt.measureElement}
              style={{ position: "absolute", top: 0, left: 0, right: 0, transform: `translateY(${vr.start - scrollMargin}px)`, display: "grid", gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: "16px", paddingBottom: "16px" }}
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
/** A compact upload-row control (pause / resume / retry / cancel / dismiss) with a tone-colored hover. */
function UploadRowBtn({ onClick, label, title, tone = "muted", children }: { onClick: () => void; label: string; title: string; tone?: "muted" | "primary" | "danger"; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={title}
      className={cn(
        "pressable grid h-8 w-8 place-items-center rounded-md text-faint transition-colors hover:bg-surface-3 [@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:w-10",
        tone === "danger" ? "hover:text-danger" : tone === "primary" ? "hover:text-primary" : "hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function UploadTray() {
  const uploads = useDriveV2((s) => s.uploads);
  const [open, setOpen] = useState(true);
  const active = uploads.filter((u) => u.status === "uploading");
  const paused = uploads.filter((u) => u.status === "paused").length;
  const done = uploads.filter((u) => u.status === "done").length;
  const failed = uploads.filter((u) => u.status === "error").length;
  const canceled = uploads.filter((u) => u.status === "canceled").length;
  const total = uploads.length;
  // "In progress" = still uploading OR paused (a paused upload isn't finished — it's waiting to resume).
  const inProgress = active.length > 0 || paused > 0;
  // Aggregate progress across everything in the tray (uploaded bytes / total bytes).
  const totalBytes = uploads.reduce((a, u) => a + u.size, 0);
  const doneBytes = uploads.reduce((a, u) => a + (u.status === "done" ? u.size : u.uploaded), 0);
  const aggPct = totalBytes ? Math.round((doneBytes / totalBytes) * 100) : 0;
  // Header: a real count, not a truncated "…". In-flight files while uploading, else a summary of the
  // final tallies (complete / failed / canceled), noting anything paused.
  const heading =
    active.length > 0
      ? `Uploading ${active.length} file${active.length === 1 ? "" : "s"}${total > active.length ? ` · ${done}/${total} done` : ""}${paused ? ` · ${paused} paused` : ""}`
      : paused > 0
        ? `${paused} paused${done ? ` · ${done} complete` : ""}`
        : [done && `${done} complete`, failed && `${failed} failed`, canceled && `${canceled} canceled`].filter(Boolean).join(" · ") || "Uploads";
  const headerIcon = active.length > 0 ? <Spinner size={14} className="text-primary" /> : paused > 0 ? <Pause size={14} className="text-muted" /> : done > 0 ? <Check size={15} className="text-ok" /> : <X size={15} className="text-muted" />;

  // Lives in the BottomStack (which owns the fixed position, the safe-area padding and the z-index).
  return (
    <motion.div variants={slideUp} initial="hidden" animate="show" className="pointer-events-auto w-full overflow-hidden rounded-[var(--radius-card)] border border-border bg-elevated shadow-[var(--shadow-pop)] sm:w-80">
      <div className="flex min-h-10 w-full items-center border-b border-border">
        <button onClick={() => setOpen((v) => !v)} aria-expanded={open} className="pressable flex min-w-0 flex-1 items-center gap-2 px-3.5 py-2.5 text-[13px] font-semibold">
          {headerIcon}
          <span className="min-w-0 flex-1 truncate text-left" title={heading}>{heading}</span>
          <ChevronRight size={15} className={cn("shrink-0 text-muted transition-transform duration-[var(--motion-base)]", open && "rotate-90")} />
        </button>
        {/* While anything is in progress this cancels it all; once finished it clears the tray. */}
        <button
          onClick={() => (inProgress ? useDriveV2.getState().cancelAllUploads() : useDriveV2.getState().clearFinishedUploads())}
          aria-label={inProgress ? "Cancel all uploads" : "Clear completed"}
          title={inProgress ? "Cancel all" : "Clear"}
          className={cn("pressable grid h-10 w-10 shrink-0 place-items-center border-l border-border text-muted hover:text-foreground [@media(pointer:coarse)]:w-11", inProgress && "hover:text-danger")}
        >
          <X size={16} />
        </button>
      </div>
      {active.length > 0 && (
        <div className="border-b border-border px-3.5 py-2">
          <Progress value={aggPct} />
          <div className="mt-1 flex justify-between text-[11px] text-muted">
            <span>{formatBytes(doneBytes)} of {formatBytes(totalBytes)}</span>
            <span>{aggPct}%</span>
          </div>
        </div>
      )}
      <Collapse open={open}>
        <div className="max-h-64 overflow-y-auto">
          {uploads.slice(0, 30).map((u) => (
            <div key={u.id} className="group/uprow flex items-center gap-2.5 border-b border-border px-3.5 py-2 last:border-0">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12.5px] font-medium">{u.name}</div>
                {u.status === "uploading" || u.status === "paused" ? (
                  <>
                    <Progress value={u.size ? Math.round((u.uploaded / u.size) * 100) : 0} className="mt-1" tone={u.status === "paused" ? "warn" : "primary"} />
                    <div className="mt-0.5 font-mono text-[11.5px] tabular text-faint">{u.status === "paused" ? "Paused · " : ""}{formatBytes(u.uploaded)} / {formatBytes(u.size)}</div>
                  </>
                ) : (
                  <div className={cn("text-[11px]", u.status === "done" ? "text-ok" : u.status === "error" ? "text-danger" : "text-muted")}>{u.status === "done" ? formatBytes(u.size) + " · Done" : u.status === "error" ? u.error ?? "Failed" : "Canceled"}</div>
                )}
              </div>
              {/* Controls by state: uploading → pause + cancel · paused → resume + cancel · error → retry +
                  dismiss · canceled → dismiss · done → a green check (a subtle remove appears on hover). */}
              <div className="flex shrink-0 items-center gap-0.5">
                {u.status === "uploading" && (
                  <UploadRowBtn onClick={() => useDriveV2.getState().pauseUpload(u.id)} label={`Pause ${u.name}`} title="Pause"><Pause size={14} /></UploadRowBtn>
                )}
                {u.status === "paused" && (
                  <UploadRowBtn onClick={() => useDriveV2.getState().resumeUpload(u.id)} label={`Resume ${u.name}`} title="Resume" tone="primary"><Play size={14} /></UploadRowBtn>
                )}
                {u.status === "error" && (
                  <UploadRowBtn onClick={() => useDriveV2.getState().resumeUpload(u.id)} label={`Retry ${u.name}`} title="Retry" tone="primary"><RefreshCw size={14} /></UploadRowBtn>
                )}
                {u.status === "uploading" || u.status === "paused" ? (
                  // In-flight: a real cancel (destructive).
                  <UploadRowBtn onClick={() => useDriveV2.getState().cancelUpload(u.id)} label={`Cancel upload of ${u.name}`} title="Cancel" tone="danger"><X size={14} /></UploadRowBtn>
                ) : u.status === "done" ? (
                  // Success: show a check, NOT a cancel-looking X. The X (remove from list) only appears on hover.
                  <button
                    onClick={() => useDriveV2.getState().dismissUpload(u.id)}
                    aria-label={`Remove ${u.name} from the list`}
                    title="Remove from list"
                    className="pressable grid h-8 w-8 place-items-center rounded-md transition-colors hover:bg-surface-3 [@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:w-10"
                  >
                    <Check size={15} className="text-ok group-hover/uprow:hidden" />
                    <X size={14} className="hidden text-muted group-hover/uprow:block" />
                  </button>
                ) : (
                  // Failed / canceled: a dismiss (remove the entry).
                  <UploadRowBtn onClick={() => useDriveV2.getState().dismissUpload(u.id)} label={`Dismiss ${u.name}`} title="Dismiss"><X size={14} /></UploadRowBtn>
                )}
              </div>
            </div>
          ))}
        </div>
      </Collapse>
    </motion.div>
  );
}
