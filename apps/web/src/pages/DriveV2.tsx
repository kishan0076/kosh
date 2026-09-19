import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from "react";
import {
  ArrowUpDown,
  Bookmark,
  BookmarkPlus,
  Check,
  ChevronRight,
  Clock,
  Copy,
  CornerUpRight,
  Download,
  ExternalLink,
  Filter,
  FolderPlus,
  HardDrive,
  LayoutGrid,
  List as ListIcon,
  Pencil,
  Plug,
  Plus,
  RotateCcw,
  Search,
  Share2,
  Sparkles,
  Star,
  Trash2,
  Type,
  Upload,
  X,
} from "lucide-react";
import { formatBytes } from "@kosh/shared";
import { cn } from "@/lib/cn";
import { useData } from "@/data/store";
import { Button, Progress, Spinner } from "@/components/ui";
import { Menu, MenuItem, MenuLabel, MenuSeparator } from "@/components/overlays";
import { driveApi } from "@/data/driveApi";
import { filterBucket, kindOf, type DriveNode, type FilterKind } from "@/data/driveV2Api";
import { useDriveV2, type DriveView, type SortKey } from "@/data/driveV2";
import { useVirtualizer } from "@tanstack/react-virtual";
import { DriveContentSkeleton, DriveEmptyState, DriveErrorState, FileCard, FileRow, ListHeader, type ItemHandlers } from "@/components/drive-v2/items";
import { ContextMenu, type MenuAction } from "@/components/drive-v2/ContextMenu";
import { CreateFolderModal, DeleteConfirmModal, MoveToModal } from "@/components/drive-v2/modals";
import { ShareModal } from "@/components/drive-v2/ShareModal";
import { BulkRenameModal } from "@/components/drive-v2/BulkRenameModal";
import { InsightsPanel } from "@/components/drive-v2/InsightsPanel";
import { DriveDetails, PreviewOverlay } from "@/components/drive-v2/DriveDetails";
import { CommandPalette } from "@/components/drive-v2/CommandPalette";
import { getDragIds, hasDriveDrag, hasExternalFiles, setDragIds } from "@/components/drive-v2/dnd";

const SAVED_KEY = "kosh.driveV2.savedSearches";

/* ── sorting / filtering (client-side over loaded pages) ── */
function sortNodes(nodes: DriveNode[], key: SortKey, dir: "asc" | "desc"): DriveNode[] {
  const s = [...nodes].sort((a, b) => {
    if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1; // folders always first
    let c = 0;
    if (key === "name") c = a.name.localeCompare(b.name, undefined, { numeric: true });
    else if (key === "modified") c = (a.modifiedTime ?? "").localeCompare(b.modifiedTime ?? "");
    else if (key === "size") c = (a.size ?? 0) - (b.size ?? 0);
    else c = kindOf(a).localeCompare(kindOf(b)) || a.name.localeCompare(b.name);
    return dir === "asc" ? c : -c;
  });
  return s;
}

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
      action={copy.cta ? <a href={driveApi.connectUrl()}><Button variant="primary"><Plug size={15} /> {copy.cta}</Button></a> : undefined}
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

  const store = useDriveV2;
  const currentFolderId = useDriveV2((s) => s.path.at(-1)?.id ?? "root");

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


  /** Ids an action should target: the whole selection if the node is part of a multi-select, else just it. */
  const targetsFor = useCallback((node: DriveNode): string[] => (selection.has(node.id) && selection.size > 1 ? [...selection] : [node.id]), [selection]);

  const handlers: ItemHandlers = {
    onOpen: (node) => {
      if (node.isFolder) store.getState().openFolder(node);
      else store.getState().setPreview(node);
    },
    onClick: (node, e) => {
      store.getState().toggleSelect(node.id, { shift: e.shiftKey, meta: e.metaKey || e.ctrlKey }, orderedIds);
      if (!e.shiftKey && !e.metaKey && !e.ctrlKey) void store.getState().loadDetails(node.id);
    },
    onContext: (node, e) => {
      e.preventDefault();
      if (!selection.has(node.id)) store.getState().toggleSelect(node.id, {}, orderedIds);
      setMenu({ ids: targetsFor(node), node, x: e.clientX, y: e.clientY });
    },
    onToggleStar: (node) => void store.getState().toggleStar(node.id),
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
      <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)] lg:items-start">
        <DriveNav />
        <div className="min-w-0">
          {insightsOpen ? (
            <InsightsPanel onClose={() => store.getState().setInsights(false)} />
          ) : (
          <div className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
            <DriveToolbar onNewFolder={() => store.getState().openDialog({ kind: "newFolder", parentId: currentFolderId })} onUpload={() => fileInputRef.current?.click()} />
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
              <div className="border-t border-border p-3 text-center">
                <Button variant="ghost" size="sm" onClick={() => void store.getState().loadMore()} disabled={loadingMore}>
                  {loadingMore ? <Spinner size={14} /> : <ChevronRight size={14} className="rotate-90" />} Load more
                </Button>
              </div>
            )}
          </div>
          )}
        </div>
      </div>

      {/* Details panel — a fixed right drawer (control-center feel). */}
      {detailsId && (
        <aside className="fixed inset-y-0 right-0 z-40 w-[86vw] max-w-[340px] border-l border-border bg-surface shadow-[var(--shadow-pop)]">
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
          />
        </aside>
      )}

      {uploads.length > 0 && <UploadTray />}

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} onUpload={() => fileInputRef.current?.click()} />
      {menu && <ContextMenu x={menu.x} y={menu.y} actions={menuActions} onClose={() => setMenu(null)} />}
      {dialog?.kind === "newFolder" && <CreateFolderModal parentId={dialog.parentId} onClose={() => store.getState().closeDialog()} />}
      {dialog?.kind === "delete" && <DeleteConfirmModal ids={dialog.ids} permanent={dialog.permanent} onClose={() => store.getState().closeDialog()} />}
      {dialog?.kind === "move" && <MoveToModal ids={dialog.ids} onClose={() => store.getState().closeDialog()} />}
      {dialog?.kind === "share" && <ShareModal node={dialog.node} onClose={() => store.getState().closeDialog()} />}
      {dialog?.kind === "rename-bulk" && <BulkRenameModal ids={dialog.ids} onClose={() => store.getState().closeDialog()} />}
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
    if (!node.isFolder && node.capabilities?.canCopy !== false) a.push({ label: "Make a copy", icon: Copy, onClick: () => void s.copy(node.id) });
  }
  a.push({ label: many ? `Star ${ids.length}` : node.starred ? "Unstar" : "Star", icon: Star, onClick: () => ids.forEach((id) => void s.toggleStar(id)) });
  if (many) a.push({ label: `Bulk rename ${ids.length}`, icon: Type, onClick: () => s.openDialog({ kind: "rename-bulk", ids }) });
  a.push({ label: "Move to…", icon: CornerUpRight, onClick: () => s.openDialog({ kind: "move", ids }) });
  a.push({ label: many ? `Move ${ids.length} to trash` : "Move to trash", icon: Trash2, danger: true, separatorBefore: true, onClick: () => s.openDialog({ kind: "delete", ids, permanent: false }) });
  return a;
}

/* ── left nav ── */
function DriveNav() {
  const accounts = useDriveV2((s) => s.accounts);
  const accountId = useDriveV2((s) => s.accountId);
  const view = useDriveV2((s) => s.view);
  const insightsOpen = useDriveV2((s) => s.insightsOpen);
  const quota = useDriveV2((s) => s.quota);
  const account = accounts.find((a) => a.id === accountId);

  const NAV: { v: DriveView; label: string; icon: typeof HardDrive; tone?: string }[] = [
    { v: "myDrive", label: "My Drive", icon: HardDrive },
    { v: "recent", label: "Recent", icon: Clock },
    { v: "starred", label: "Starred", icon: Star, tone: "text-gold" },
    { v: "trash", label: "Trash", icon: Trash2 },
  ];
  const pct = quota?.limit ? Math.min(100, Math.round((quota.usage / quota.limit) * 100)) : 0;

  return (
    <aside className="space-y-3 lg:sticky lg:top-4">
      <div className="rounded-[var(--radius-card)] border border-border bg-surface p-2">
        <Menu
          align="start"
          width={240}
          trigger={({ toggle, ref }) => (
            <button ref={ref} onClick={toggle} className="flex w-full items-center gap-2 rounded-[var(--radius-control)] p-1.5 text-left hover:bg-surface-2">
              {account?.picture ? <img src={account.picture} alt="" className="h-8 w-8 rounded-full" /> : <span className="grid h-8 w-8 place-items-center rounded-full bg-primary-soft text-primary"><HardDrive size={15} /></span>}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] font-semibold">{account?.name ?? "Account"}</span>
                <span className="block truncate text-[11px] text-muted">{account?.email}</span>
              </span>
              <ChevronRight size={14} className="text-faint" />
            </button>
          )}
        >
          <MenuLabel>Google accounts</MenuLabel>
          {accounts.map((a) => (
            <MenuItem key={a.id} icon={a.id === accountId ? Check : HardDrive} onClick={() => void useDriveV2.getState().selectAccount(a.id)}>
              <span className="truncate">{a.email}</span>
            </MenuItem>
          ))}
          <MenuSeparator />
          <MenuItem icon={Plus} onClick={() => { window.location.href = driveApi.connectUrl(); }}>Connect account</MenuItem>
        </Menu>
      </div>

      <nav className="rounded-[var(--radius-card)] border border-border bg-surface p-2">
        {NAV.map(({ v, label, icon: Icon, tone }) => {
          const active = !insightsOpen && view === v;
          return (
            <button
              key={v}
              onClick={() => useDriveV2.getState().setView(v)}
              className={cn("flex w-full items-center gap-2.5 rounded-[var(--radius-control)] px-3 py-2 text-[13.5px] font-medium transition-colors", active ? "bg-primary-soft text-primary" : "text-muted hover:bg-surface-2 hover:text-foreground")}
            >
              <Icon size={16} className={cn(!active && tone)} /> {label}
            </button>
          );
        })}
        <div className="my-1 h-px bg-border" />
        <button
          onClick={() => useDriveV2.getState().setInsights(true)}
          className={cn("flex w-full items-center gap-2.5 rounded-[var(--radius-control)] px-3 py-2 text-[13.5px] font-medium transition-colors", insightsOpen ? "bg-primary-soft text-primary" : "text-muted hover:bg-surface-2 hover:text-foreground")}
        >
          <Sparkles size={16} /> Insights
        </button>
      </nav>

      {quota && (
        <div className="rounded-[var(--radius-card)] border border-border bg-surface p-3.5">
          <div className="mb-2 flex items-center gap-2 text-[12.5px] font-semibold"><HardDrive size={15} className="text-primary" /> Storage</div>
          {quota.limit ? (
            <>
              <Progress value={pct} tone={pct > 95 ? "danger" : pct > 80 ? "warn" : "primary"} />
              <div className="mt-1.5 text-[11.5px] text-muted">{formatBytes(quota.usage)} of {formatBytes(quota.limit)} used</div>
            </>
          ) : (
            <div className="text-[11.5px] text-muted">{formatBytes(quota.usage)} used</div>
          )}
        </div>
      )}
    </aside>
  );
}

/* ── toolbar ── */
function DriveToolbar({ onNewFolder, onUpload }: { onNewFolder: () => void; onUpload: () => void }) {
  const view = useDriveV2((s) => s.view);
  const path = useDriveV2((s) => s.path);
  const prefs = useDriveV2((s) => s.prefs);
  const searchQuery = useDriveV2((s) => s.searchQuery);
  const emptyTrash = useDriveV2((s) => s.emptyTrash);
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
    <div className="sticky top-0 z-20 flex flex-wrap items-center gap-2 border-b border-border bg-surface/85 px-3 py-2.5 backdrop-blur">
      <div className="mr-auto flex min-w-0 items-center gap-1 text-[13px]">
        {view === "myDrive" ? (
          <>
            <CrumbButton folderId="root" onClick={() => useDriveV2.getState().goRoot()} className="font-medium">My Drive</CrumbButton>
            {path.map((f, i) => (
              <span key={f.id} className="flex min-w-0 items-center gap-0.5">
                <ChevronRight size={13} className="shrink-0 text-faint" />
                {i === path.length - 1 ? (
                  <span className="max-w-[180px] truncate px-1.5 py-0.5 font-semibold">{f.name}</span>
                ) : (
                  <CrumbButton folderId={f.id} onClick={() => useDriveV2.getState().breadcrumbTo(i)} className="max-w-[140px] truncate">{f.name}</CrumbButton>
                )}
              </span>
            ))}
          </>
        ) : (
          <span className="px-1.5 font-semibold capitalize">{view}</span>
        )}
      </div>

      <label className="flex h-9 min-w-0 items-center gap-2 rounded-[var(--radius-control)] border border-border bg-surface px-2.5 focus-within:border-primary focus-within:ring-focus">
        <Search size={15} className="shrink-0 text-muted" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search Drive…" className="min-w-0 w-40 bg-transparent text-[13px] outline-none sm:w-52" />
        {q && <button onClick={() => setQ("")} aria-label="Clear search"><X size={14} className="text-faint hover:text-foreground" /></button>}
      </label>

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

      {view === "trash" ? (
        <Button variant="outline" size="sm" onClick={() => void emptyTrash()}><Trash2 size={14} /> Empty trash</Button>
      ) : (
        <>
          <Button variant="secondary" size="sm" onClick={onNewFolder}><FolderPlus size={15} /> New folder</Button>
          <Button variant="primary" size="sm" onClick={onUpload}><Upload size={15} /> Upload</Button>
        </>
      )}
    </div>
  );
}

/** A breadcrumb segment that also accepts an internal drag to move items into that folder. */
function CrumbButton({ folderId, onClick, className, children }: { folderId: string; onClick: () => void; className?: string; children: ReactNode }) {
  const [over, setOver] = useState(false);
  return (
    <button
      onClick={onClick}
      onDragOver={(e) => { if (hasDriveDrag(e)) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { if (!hasDriveDrag(e)) return; e.preventDefault(); setOver(false); const ids = getDragIds(e); if (ids?.length) void useDriveV2.getState().move(ids, folderId); }}
      className={cn("rounded px-1.5 py-0.5 hover:bg-surface-2", over && "bg-primary-soft ring-1 ring-primary", className)}
    >
      {children}
    </button>
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
            <Button variant="ghost" size="sm" onClick={() => ids.forEach((id) => void s().toggleStar(id))}><Star size={14} /> Star</Button>
            {ids.length > 1 && <Button variant="ghost" size="sm" onClick={() => s().openDialog({ kind: "rename-bulk", ids })}><Type size={14} /> Rename</Button>}
            <Button variant="ghost" size="sm" onClick={() => s().openDialog({ kind: "move", ids })}><CornerUpRight size={14} /> Move</Button>
            <Button variant="ghost" size="sm" className="text-danger" onClick={() => s().openDialog({ kind: "delete", ids, permanent: false })}><Trash2 size={14} /> Trash</Button>
          </>
        )}
      </div>
    </div>
  );
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

  // The drop target wraps ALL states so external-file drag-and-drop upload works even in an empty
  // folder. It reacts ONLY to external files — internal node drags are handled by folder/breadcrumb
  // drop targets, so dragging within the grid never shows "Drop to upload".
  return (
    <div
      ref={scrollRef}
      onDragOver={canDrop ? (e) => { if (hasExternalFiles(e) && !hasDriveDrag(e)) { e.preventDefault(); setDrag(true); } } : undefined}
      onDragLeave={canDrop ? (e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrag(false); } : undefined}
      onDrop={canDrop ? (e) => { if (!hasExternalFiles(e) || hasDriveDrag(e)) return; e.preventDefault(); setDrag(false); const files = Array.from(e.dataTransfer.files); if (files.length) onDropFiles(files); } : undefined}
      className={cn("relative max-h-[calc(100dvh-14rem)] min-h-[320px] overflow-y-auto", drag && "outline-2 -outline-offset-2 outline-dashed outline-primary")}
    >
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
  const virt = useVirtualizer({ count: visible.length, getScrollElement: () => scrollRef.current, estimateSize: () => 41, overscan: 12 });
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
    const compute = () => { const w = el.clientWidth - 24; const min = 150, gap = 12; setCols(Math.max(1, Math.floor((w + gap) / (min + gap)))); }; // -24 = p-3 horizontal padding
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const rows = Math.ceil(visible.length / cols);
  const virt = useVirtualizer({ count: rows, getScrollElement: () => scrollRef.current, estimateSize: () => 174, overscan: 6, measureElement: (el) => el.getBoundingClientRect().height });
  return (
    <div ref={gridRef} className="p-3">
      <div style={{ height: virt.getTotalSize(), position: "relative" }}>
        {virt.getVirtualItems().map((vr) => {
          const items = visible.slice(vr.index * cols, vr.index * cols + cols);
          return (
            <div
              key={vr.key}
              data-index={vr.index}
              ref={virt.measureElement}
              style={{ position: "absolute", top: 0, left: 0, right: 0, transform: `translateY(${vr.start}px)`, display: "grid", gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: "12px", paddingBottom: "12px" }}
            >
              {items.map((n) => <FileCard key={n.id} {...rowProps(n)} />)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── upload tray ── */
function UploadTray() {
  const uploads = useDriveV2((s) => s.uploads);
  const [open, setOpen] = useState(true);
  const active = uploads.filter((u) => u.status === "uploading").length;
  return (
    <div className="fixed bottom-4 right-4 z-40 w-80 overflow-hidden rounded-[var(--radius-card)] border border-border bg-elevated shadow-[var(--shadow-pop)]">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 border-b border-border px-3.5 py-2.5 text-[13px] font-semibold">
        {active > 0 ? <Spinner size={14} className="text-primary" /> : <Check size={15} className="text-ok" />}
        <span className="flex-1 text-left">{active > 0 ? `Uploading ${active}…` : "Uploads complete"}</span>
        <ChevronRight size={15} className={cn("text-muted transition-transform", open && "rotate-90")} />
      </button>
      {open && (
        <div className="max-h-64 overflow-y-auto">
          {uploads.slice(0, 30).map((u) => (
            <div key={u.id} className="flex items-center gap-2.5 border-b border-border px-3.5 py-2 last:border-0">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12.5px] font-medium">{u.name}</div>
                {u.status === "uploading" ? (
                  <Progress value={u.size ? Math.round((u.uploaded / u.size) * 100) : 0} className="mt-1" />
                ) : (
                  <div className={cn("text-[11px]", u.status === "done" ? "text-ok" : u.status === "error" ? "text-danger" : "text-muted")}>{u.status === "done" ? "Done" : u.status === "error" ? u.error ?? "Failed" : "Canceled"}</div>
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
