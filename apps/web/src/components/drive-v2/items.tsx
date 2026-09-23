import { useEffect, useRef, useState, type DragEvent as ReactDragEvent, type MouseEvent as ReactMouseEvent } from "react";
import { Check, File, FileArchive, FileText, Film, Folder, FolderOpen, Image as ImageIcon, MoreVertical, Music, Presentation, Search, Star, Table, UploadCloud } from "lucide-react";
import { formatBytes, sortDriveNodes } from "@kosh/shared";
import { cn } from "@/lib/cn";
import { ago } from "@/lib/time";
import { Button, Spinner } from "@/components/ui";
import { kindOf, type DriveKind, type DriveNode } from "@/data/driveV2Api";
import { useDriveV2, type DriveView, type SortKey } from "@/data/driveV2";
import { getDragIds, hasDriveDrag } from "./dnd";

/**
 * Order nodes for display (folders always first, then by key). The single source of truth for the
 * visible order — reused by the grid/list AND bulk rename so its sequential numbering matches what
 * the user sees on screen.
 */
export function sortNodes(nodes: DriveNode[], key: SortKey, dir: "asc" | "desc"): DriveNode[] {
  return sortDriveNodes(nodes, key, dir); // shared, unit-tested (folders-first + numeric name sort)
}

/** Shared internal-drag drop handlers for a folder node (move onto folder). */
function useFolderDrop(node: DriveNode, onFolderDrop: (folder: DriveNode, ids: string[]) => void) {
  const [over, setOver] = useState(false);
  if (!node.isFolder) return { over: false, dropProps: {} };
  return {
    over,
    dropProps: {
      onDragOver: (e: ReactDragEvent) => { if (hasDriveDrag(e)) { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = "move"; setOver(true); } },
      onDragLeave: (e: ReactDragEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false); }, // ignore crossings onto children (no flicker)
      onDrop: (e: ReactDragEvent) => {
        if (!hasDriveDrag(e)) return; // external file drop bubbles to the content upload zone
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        const ids = getDragIds(e)?.filter((id) => id !== node.id); // never drop a folder onto itself
        if (ids && ids.length) onFolderDrop(node, ids);
      },
    },
  };
}

const KIND_ICON: Record<DriveKind, typeof File> = {
  folder: Folder,
  doc: FileText,
  sheet: Table,
  slide: Presentation,
  image: ImageIcon,
  video: Film,
  audio: Music,
  pdf: FileText,
  archive: FileArchive,
  other: File,
};
const KIND_TINT: Record<DriveKind, string> = {
  folder: "text-primary",
  doc: "text-info",
  sheet: "text-ok",
  slide: "text-warn",
  image: "text-primary",
  video: "text-danger",
  audio: "text-gold",
  pdf: "text-danger",
  archive: "text-muted",
  other: "text-muted",
};
/** The soft type wash behind a card's hero icon — the "engineered surface" color cue. */
const KIND_HERO: Record<DriveKind, string> = {
  folder: "bg-surface-2",
  doc: "bg-info-soft",
  sheet: "bg-ok-soft",
  slide: "bg-warn-soft",
  image: "bg-primary-soft",
  video: "bg-danger-soft",
  audio: "bg-gold-soft",
  pdf: "bg-danger-soft",
  archive: "bg-surface-3",
  other: "bg-surface-2",
};

/** Thumbnail with graceful fallback to a kind icon (thumbnailLink is short-lived + auth-scoped). */
export function NodeIcon({ node, size = 20, thumb = false }: { node: DriveNode; size?: number; thumb?: boolean }) {
  const kind = kindOf(node);
  const Icon = KIND_ICON[kind];
  const [broken, setBroken] = useState(false);
  // Reset the broken flag when the source changes — the same NodeIcon instance is reused across
  // selected files (e.g. in the details panel), so a stale "broken" would hide a valid thumbnail.
  useEffect(() => { setBroken(false); }, [node.thumbnailLink]);
  const canThumb = thumb && !node.isFolder && !!node.thumbnailLink && !broken;
  if (canThumb) {
    return <img src={node.thumbnailLink} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} className="h-full w-full object-cover" />;
  }
  return <Icon size={size} className={cn("shrink-0", KIND_TINT[kind])} />;
}

const metaLine = (node: DriveNode): string => {
  const parts: string[] = [];
  if (!node.isFolder && node.size != null) parts.push(formatBytes(node.size));
  if (node.modifiedTime) parts.push(ago(node.modifiedTime));
  return parts.join(" · ") || "—";
};

export interface ItemHandlers {
  onOpen: (node: DriveNode) => void;
  onClick: (node: DriveNode, e: ReactMouseEvent) => void;
  onContext: (node: DriveNode, e: ReactMouseEvent) => void;
  onToggleStar: (node: DriveNode) => void;
  onToggleSelect: (node: DriveNode) => void;
  onMore: (node: DriveNode, e: ReactMouseEvent) => void;
  onRenameSubmit: (node: DriveNode, name: string) => void;
  onRenameCancel: () => void;
  onDragStart: (node: DriveNode, e: ReactDragEvent) => void;
  onFolderDrop: (folder: DriveNode, ids: string[]) => void;
}
interface ItemProps extends ItemHandlers {
  node: DriveNode;
  /** Zero-based position within the visible list — powers roving-tabindex keyboard focus. */
  index: number;
  /** One-based column position within its ARIA row (1 for the list). */
  colIndex: number;
  selected: boolean;
  busy: boolean;
  renaming: boolean;
  /** True for the single roving-focus target (tabIndex 0); all others are tabIndex -1. */
  focusable: boolean;
  /** Report focus back so clicking/tabbing an item moves the roving cursor to it. */
  onFocusItem: (id: string) => void;
}

/** Accessible name for a cell — otherwise a screen reader concatenates every inner control's label. */
function itemLabel(node: DriveNode): string {
  const parts: string[] = [node.name, node.isFolder ? "folder" : kindOf(node)];
  if (!node.isFolder && node.size != null) parts.push(formatBytes(node.size));
  if (node.starred) parts.push("starred");
  if (node.modifiedTime) parts.push(`modified ${ago(node.modifiedTime)}`);
  return parts.join(", ");
}

function InlineRename({ node, onSubmit, onCancel, center }: { node: DriveNode; onSubmit: (name: string) => void; onCancel: () => void; center?: boolean }) {
  const [value, setValue] = useState(node.name);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    // Select the base name (excluding extension) for quick editing.
    const dot = node.name.lastIndexOf(".");
    ref.current?.setSelectionRange(0, dot > 0 && !node.isFolder ? dot : node.name.length);
  }, [node.name, node.isFolder]);
  const submit = () => {
    const v = value.trim();
    if (v && v !== node.name) onSubmit(v);
    else onCancel();
  };
  return (
    <input
      ref={ref}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Enter") submit();
        if (e.key === "Escape") onCancel();
      }}
      onBlur={submit}
      className={cn("min-w-0 rounded-[var(--radius-control)] border border-primary bg-surface px-1.5 py-0.5 text-[13px] outline-none ring-focus", center ? "w-full text-center" : "flex-1")}
    />
  );
}

/**
 * Circular select checkbox. Hidden by default, revealed on hover (or keyboard focus), and always shown
 * once the item is selected. `reveal="collapse"` removes it from layout when hidden (inline list rows);
 * the default uses opacity so an absolutely-positioned card overlay fades in.
 */
function SelectDisc({ selected, onToggle, className, reveal = "opacity", tabIndex }: { selected: boolean; onToggle: () => void; className?: string; reveal?: "opacity" | "collapse"; tabIndex?: number }) {
  // On touch/coarse-pointer devices there is no hover, so the disc must be visible by default —
  // otherwise multi-select is unreachable on a phone/tablet.
  const hidden =
    reveal === "collapse"
      ? "hidden group-hover:grid focus-visible:grid [@media(pointer:coarse)]:grid"
      : "grid opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 [@media(pointer:coarse)]:opacity-100";
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
      tabIndex={tabIndex}
      aria-label={selected ? "Deselect" : "Select"}
      aria-pressed={selected}
      className={cn(
        "h-6 w-6 shrink-0 place-items-center rounded-full border backdrop-blur transition-colors",
        selected ? "grid border-primary bg-primary text-primary-foreground opacity-100" : cn(hidden, "border-border-strong bg-surface/80 text-transparent hover:text-muted"),
        className,
      )}
    >
      <Check size={13} strokeWidth={3} />
    </button>
  );
}

/* ── list row ── */
export function FileRow({ node, index, colIndex, selected, busy, renaming, focusable, onFocusItem, onOpen, onClick, onContext, onToggleStar, onToggleSelect, onMore, onRenameSubmit, onRenameCancel, onDragStart, onFolderDrop }: ItemProps) {
  const { over, dropProps } = useFolderDrop(node, onFolderDrop);
  const innerTab = focusable ? 0 : -1; // only the roving cell contributes its controls to the tab order
  return (
    <div
      role="gridcell"
      aria-selected={selected}
      aria-label={itemLabel(node)}
      aria-colindex={colIndex}
      tabIndex={focusable ? 0 : -1}
      data-node-id={node.id}
      data-idx={index}
      draggable={!renaming}
      onFocus={() => onFocusItem(node.id)}
      onDragStart={(e) => onDragStart(node, e)}
      {...dropProps}
      onClick={(e) => onClick(node, e)}
      onDoubleClick={() => onOpen(node)}
      onContextMenu={(e) => onContext(node, e)}
      className={cn(
        "group grid cursor-pointer grid-cols-[minmax(0,1fr)_104px_36px] items-center gap-3 rounded-[var(--radius-control)] px-2.5 py-1.5 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary md:grid-cols-[minmax(0,1fr)_150px_96px_128px_36px]",
        over ? "bg-primary-soft ring-1 ring-inset ring-primary" : selected ? "bg-primary-soft shadow-[inset_2px_0_0_var(--primary)]" : "hover:bg-surface-2",
      )}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <SelectDisc selected={selected} onToggle={() => onToggleSelect(node)} reveal="collapse" className="h-5 w-5" tabIndex={innerTab} />
        <span className="relative grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-[8px] bg-surface-2">
          <NodeIcon node={node} size={18} thumb />
        </span>
        {renaming ? (
          <InlineRename node={node} onSubmit={(name) => onRenameSubmit(node, name)} onCancel={onRenameCancel} />
        ) : (
          <span className="min-w-0 flex-1 truncate font-medium">{node.name}</span>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); onToggleStar(node); }}
          tabIndex={innerTab}
          className={cn("shrink-0 rounded p-0.5 transition-opacity hover:text-gold", node.starred ? "text-gold opacity-100" : "text-faint opacity-0 focus-visible:opacity-100 group-hover:opacity-100")}
          aria-label={node.starred ? "Unstar" : "Star"}
        >
          <Star size={13} className={cn(node.starred && "fill-gold")} />
        </button>
      </div>
      <span className="hidden truncate text-[12px] text-muted md:block">{node.owners?.[0]?.displayName ?? (node.ownedByMe ? "me" : "—")}</span>
      <span className="hidden justify-self-end font-mono text-[11.5px] tabular text-muted md:block">{!node.isFolder && node.size != null ? formatBytes(node.size) : "—"}</span>
      <span className="truncate font-mono text-[11.5px] tabular text-muted">{node.modifiedTime ? ago(node.modifiedTime) : "—"}</span>
      <div className="flex items-center justify-end">
        {busy ? (
          <Spinner size={14} className="text-muted" />
        ) : (
          <button
            onClick={(e) => { e.stopPropagation(); onMore(node, e); }}
            tabIndex={innerTab}
            className="grid h-7 w-7 place-items-center rounded-md text-muted opacity-0 transition-opacity hover:bg-surface-3 hover:text-foreground focus:opacity-100 group-hover:opacity-100 [@media(pointer:coarse)]:opacity-100"
            aria-label="More actions"
          >
            <MoreVertical size={16} />
          </button>
        )}
      </div>
    </div>
  );
}

/* ── grid card ── */
export function FileCard({ node, index, colIndex, selected, busy, renaming, focusable, onFocusItem, onOpen, onClick, onContext, onToggleStar, onToggleSelect, onMore, onRenameSubmit, onRenameCancel, onDragStart, onFolderDrop }: ItemProps) {
  const { over, dropProps } = useFolderDrop(node, onFolderDrop);
  const kind = kindOf(node);
  const innerTab = focusable ? 0 : -1; // only the roving cell contributes its controls to the tab order
  return (
    <div
      role="gridcell"
      aria-selected={selected}
      aria-label={itemLabel(node)}
      aria-colindex={colIndex}
      tabIndex={focusable ? 0 : -1}
      data-node-id={node.id}
      data-idx={index}
      draggable={!renaming}
      onFocus={() => onFocusItem(node.id)}
      onDragStart={(e) => onDragStart(node, e)}
      {...dropProps}
      onClick={(e) => onClick(node, e)}
      onDoubleClick={() => onOpen(node)}
      onContextMenu={(e) => onContext(node, e)}
      className={cn(
        "group relative flex cursor-pointer flex-col overflow-hidden rounded-[var(--radius-card)] border bg-surface transition-[transform,box-shadow,border-color] duration-200 will-change-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        over
          ? "border-primary bg-primary-soft ring-2 ring-primary"
          : selected
            ? "-translate-y-0.5 border-primary bg-primary-soft/40 shadow-card ring-2 ring-primary"
            : "card-hover border-border hover:border-border-strong",
      )}
    >
      {/* folder color top-strip (the one sanctioned inline-hex spot) */}
      {node.isFolder && (
        <span className={cn("h-[3px] w-full shrink-0", !node.folderColorRgb && "bg-primary")} style={node.folderColorRgb ? { backgroundColor: node.folderColorRgb } : undefined} />
      )}
      <div className={cn("relative flex h-36 items-center justify-center overflow-hidden", KIND_HERO[kind])}>
        {/* faint top light for a physical, lit feel */}
        <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/10 to-transparent dark:from-white/5" />
        {node.isFolder ? (
          over ? (
            <FolderOpen size={44} style={{ color: node.folderColorRgb || undefined }} className={cn(!node.folderColorRgb && "text-primary")} />
          ) : (
            <Folder size={44} style={{ color: node.folderColorRgb || undefined }} className={cn("transition-transform group-hover:scale-105", !node.folderColorRgb && "text-primary")} />
          )
        ) : (
          <NodeIcon node={node} size={44} thumb />
        )}

        {/* select disc */}
        <div className="absolute left-2 top-2">
          <SelectDisc selected={selected} onToggle={() => onToggleSelect(node)} tabIndex={innerTab} />
        </div>

        {/* star + more (frosted pill) */}
        <div className="absolute right-2 top-2 flex items-center gap-1">
          <button
            onClick={(e) => { e.stopPropagation(); onToggleStar(node); }}
            tabIndex={innerTab}
            className={cn("grid h-7 w-7 place-items-center rounded-full bg-surface/80 backdrop-blur transition-opacity hover:bg-surface", node.starred ? "opacity-100" : "opacity-0 focus-visible:opacity-100 group-hover:opacity-100")}
            aria-label={node.starred ? "Unstar" : "Star"}
          >
            <Star size={14} className={cn(node.starred ? "fill-gold text-gold" : "text-muted")} />
          </button>
          {busy ? (
            <span className="grid h-7 w-7 place-items-center rounded-full bg-surface/80"><Spinner size={13} className="text-muted" /></span>
          ) : (
            <button
              onClick={(e) => { e.stopPropagation(); onMore(node, e); }}
              tabIndex={innerTab}
              className="grid h-7 w-7 place-items-center rounded-full bg-surface/80 text-muted opacity-0 backdrop-blur transition-opacity hover:bg-surface hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 [@media(pointer:coarse)]:opacity-100"
              aria-label="More actions"
            >
              <MoreVertical size={15} />
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-0.5 px-3 py-2.5">
        {renaming ? (
          <InlineRename node={node} onSubmit={(name) => onRenameSubmit(node, name)} onCancel={onRenameCancel} center />
        ) : (
          <div className="flex items-center gap-1.5">
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{node.name}</span>
          </div>
        )}
        <span className="truncate font-mono text-[11px] tabular text-faint">{metaLine(node)}</span>
      </div>
    </div>
  );
}

/* ── sortable list header (reads sort state from the store) ── */
export function ListHeader() {
  const sortKey = useDriveV2((s) => s.prefs.sortKey);
  const sortDir = useDriveV2((s) => s.prefs.sortDir);
  const setSort = useDriveV2((s) => s.setSort);
  const caret = (k: SortKey) => (sortKey === k ? (sortDir === "asc" ? " ↑" : " ↓") : "");
  const SortBtn = ({ k, label, className }: { k: SortKey; label: string; className?: string }) => (
    <button onClick={() => setSort(k)} className={cn("inline-flex items-center text-left transition-colors hover:text-foreground", sortKey === k && "text-primary", className)}>
      {label}<span className="tabular">{caret(k)}</span>
    </button>
  );
  return (
    <div className="sticky top-0 z-10 grid grid-cols-[minmax(0,1fr)_104px_36px] gap-3 border-b border-border bg-background/85 px-2.5 py-2 text-[11px] font-semibold uppercase tracking-wide text-faint backdrop-blur md:grid-cols-[minmax(0,1fr)_150px_96px_128px_36px]">
      <SortBtn k="name" label="Name" />
      <span className="hidden md:block">Owner</span>
      <SortBtn k="size" label="Size" className="hidden justify-self-end md:inline-flex" />
      <SortBtn k="modified" label="Modified" />
      <span />
    </div>
  );
}

/* ── states ── */
export function DriveContentSkeleton({ layout }: { layout: "grid" | "list" }) {
  if (layout === "grid") {
    return (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(176px,1fr))] gap-4">
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
            <div className="shimmer h-36" />
            <div className="flex flex-col gap-1.5 px-3 py-2.5"><div className="shimmer h-3.5 w-3/4 rounded" /><div className="shimmer h-2.5 w-1/2 rounded" /></div>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="space-y-0.5">
      {Array.from({ length: 12 }).map((_, i) => (
        <div key={i} className="grid grid-cols-[minmax(0,1fr)_150px_96px_128px_36px] items-center gap-3 px-2.5 py-2">
          <div className="flex items-center gap-2.5"><div className="shimmer h-8 w-8 rounded-[8px]" /><div className="shimmer h-3.5 w-1/3 rounded" /></div>
          <div className="shimmer h-3 w-20 rounded" /><div className="shimmer h-3 w-12 justify-self-end rounded" /><div className="shimmer h-3 w-16 rounded" /><div />
        </div>
      ))}
    </div>
  );
}

const EMPTY_COPY: Record<DriveView, { icon: typeof Folder; title: string; body: string; tint: string }> = {
  myDrive: { icon: FolderOpen, title: "This folder is empty", body: "Drop files anywhere to upload, or create a folder to get started.", tint: "text-primary" },
  recent: { icon: File, title: "Nothing recent yet", body: "Files you open or edit will show up here.", tint: "text-info" },
  starred: { icon: Star, title: "No starred items", body: "Star files and folders to find them fast.", tint: "text-gold" },
  trash: { icon: FolderOpen, title: "Trash is empty", body: "Items you delete rest here for 30 days before they're gone.", tint: "text-muted" },
  shared: { icon: FolderOpen, title: "Nothing shared with you", body: "Files others share with you will appear here.", tint: "text-info" },
  search: { icon: Search, title: "No matches", body: "Try a different term, or use operators like type: owner: before:", tint: "text-muted" },
};

export function DriveEmptyState({ view, onUpload }: { view: DriveView; onUpload?: () => void }) {
  const { icon: Icon, title, body, tint } = EMPTY_COPY[view];
  return (
    <div className="grid min-h-[360px] place-items-center p-6 text-center">
      <div className="relative">
        <span className="pointer-events-none absolute -inset-10 -z-10 mesh opacity-40" />
        <span className={cn("mx-auto mb-4 grid h-16 w-16 place-items-center rounded-3xl bg-primary-soft", tint)}><Icon size={30} /></span>
        <div className="font-display text-[17px] font-semibold">{title}</div>
        <p className="mx-auto mt-1.5 max-w-xs text-[13px] text-muted">{body}</p>
        {view === "myDrive" && onUpload && (
          <Button variant="primary" onClick={onUpload} className="mx-auto mt-5"><UploadCloud size={15} /> Upload files</Button>
        )}
        <div className="mt-5 font-mono text-[11px] text-faint">Press ⌘K to search · Drop files anywhere to upload</div>
      </div>
    </div>
  );
}

export function DriveErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="grid min-h-[360px] place-items-center p-6 text-center">
      <div>
        <span className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-3xl bg-danger-soft text-danger"><FileText size={28} /></span>
        <div className="font-display text-[17px] font-semibold">Couldn't load this</div>
        <p className="mx-auto mt-1.5 max-w-sm text-[13px] text-muted">{message}</p>
        <Button variant="primary" onClick={onRetry} className="mx-auto mt-5">Retry</Button>
      </div>
    </div>
  );
}

export { metaLine };
