import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { File, FileArchive, FileText, Film, Folder, FolderOpen, Image as ImageIcon, MoreVertical, Music, Presentation, Search, Star, Table, UploadCloud } from "lucide-react";
import { formatBytes } from "@kosh/shared";
import { cn } from "@/lib/cn";
import { ago } from "@/lib/time";
import { Spinner } from "@/components/ui";
import { kindOf, type DriveKind, type DriveNode } from "@/data/driveV2Api";
import type { DriveView } from "@/data/driveV2";

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

/** Thumbnail with graceful fallback to a kind icon (thumbnailLink is short-lived + auth-scoped). */
export function NodeIcon({ node, size = 20, thumb = false }: { node: DriveNode; size?: number; thumb?: boolean }) {
  const kind = kindOf(node);
  const Icon = KIND_ICON[kind];
  const [broken, setBroken] = useState(false);
  const canThumb = thumb && !node.isFolder && !!node.thumbnailLink && !broken;
  if (canThumb) {
    return <img src={node.thumbnailLink} alt="" loading="lazy" onError={() => setBroken(true)} className="h-full w-full object-cover" />;
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
  onMore: (node: DriveNode, e: ReactMouseEvent) => void;
  onRenameSubmit: (node: DriveNode, name: string) => void;
  onRenameCancel: () => void;
}
interface ItemProps extends ItemHandlers {
  node: DriveNode;
  selected: boolean;
  busy: boolean;
  renaming: boolean;
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

/* ── list row ── */
export function FileRow({ node, selected, busy, renaming, onOpen, onClick, onContext, onMore, onRenameSubmit, onRenameCancel }: ItemProps) {
  return (
    <div
      role="row"
      tabIndex={-1}
      data-node-id={node.id}
      onClick={(e) => onClick(node, e)}
      onDoubleClick={() => onOpen(node)}
      onContextMenu={(e) => onContext(node, e)}
      className={cn(
        "group grid grid-cols-[minmax(0,1fr)_140px_120px_36px] items-center gap-3 border-b border-border px-3 py-2 text-[13px] transition-colors sm:grid-cols-[minmax(0,1fr)_150px_130px_36px]",
        selected ? "bg-primary-soft" : "hover:bg-surface-2",
      )}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="grid h-7 w-7 shrink-0 place-items-center overflow-hidden rounded-md bg-surface-2">
          <NodeIcon node={node} size={17} thumb />
        </span>
        {renaming ? (
          <InlineRename node={node} onSubmit={(name) => onRenameSubmit(node, name)} onCancel={onRenameCancel} />
        ) : (
          <span className="min-w-0 flex-1 truncate font-medium">{node.name}</span>
        )}
        {node.starred && <Star size={13} className="shrink-0 fill-gold text-gold" />}
      </div>
      <span className="hidden truncate text-[12px] text-muted sm:block">{node.owners?.[0]?.displayName ?? (node.ownedByMe ? "me" : "—")}</span>
      <span className="truncate text-[12px] text-muted">{node.modifiedTime ? ago(node.modifiedTime) : "—"}</span>
      <div className="flex items-center justify-end">
        {busy ? (
          <Spinner size={14} className="text-muted" />
        ) : (
          <button
            onClick={(e) => { e.stopPropagation(); onMore(node, e); }}
            className="grid h-7 w-7 place-items-center rounded-md text-muted opacity-0 transition-opacity hover:bg-surface-3 hover:text-foreground focus:opacity-100 group-hover:opacity-100"
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
export function FileCard({ node, selected, busy, renaming, onOpen, onClick, onContext, onToggleStar, onMore, onRenameSubmit, onRenameCancel }: ItemProps) {
  return (
    <div
      role="gridcell"
      tabIndex={-1}
      data-node-id={node.id}
      onClick={(e) => onClick(node, e)}
      onDoubleClick={() => onOpen(node)}
      onContextMenu={(e) => onContext(node, e)}
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-[var(--radius-card)] border bg-surface transition-colors",
        selected ? "border-primary ring-1 ring-primary" : "border-border hover:border-border-strong hover:bg-surface-2",
      )}
    >
      <div className="relative flex h-28 items-center justify-center overflow-hidden bg-surface-2">
        <NodeIcon node={node} size={38} thumb />
        <div className="absolute right-1.5 top-1.5 flex items-center gap-1">
          <button
            onClick={(e) => { e.stopPropagation(); onToggleStar(node); }}
            className={cn("grid h-7 w-7 place-items-center rounded-full bg-surface/80 backdrop-blur transition-opacity hover:bg-surface", node.starred ? "opacity-100" : "opacity-0 group-hover:opacity-100")}
            aria-label={node.starred ? "Unstar" : "Star"}
          >
            <Star size={14} className={cn(node.starred ? "fill-gold text-gold" : "text-muted")} />
          </button>
          {busy ? (
            <span className="grid h-7 w-7 place-items-center rounded-full bg-surface/80"><Spinner size={13} className="text-muted" /></span>
          ) : (
            <button
              onClick={(e) => { e.stopPropagation(); onMore(node, e); }}
              className="grid h-7 w-7 place-items-center rounded-full bg-surface/80 text-muted opacity-0 backdrop-blur transition-opacity hover:bg-surface hover:text-foreground group-hover:opacity-100"
              aria-label="More actions"
            >
              <MoreVertical size={15} />
            </button>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 px-2.5 py-2">
        <span className="grid h-5 w-5 shrink-0 place-items-center"><NodeIcon node={node} size={15} /></span>
        {renaming ? (
          <InlineRename node={node} onSubmit={(name) => onRenameSubmit(node, name)} onCancel={onRenameCancel} />
        ) : (
          <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">{node.name}</span>
        )}
      </div>
    </div>
  );
}

export function ListHeader() {
  return (
    <div className="sticky top-0 z-10 grid grid-cols-[minmax(0,1fr)_140px_120px_36px] gap-3 border-b border-border bg-surface px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-faint sm:grid-cols-[minmax(0,1fr)_150px_130px_36px]">
      <span>Name</span>
      <span className="hidden sm:block">Owner</span>
      <span>Modified</span>
      <span />
    </div>
  );
}

/* ── states ── */
export function DriveContentSkeleton({ layout }: { layout: "grid" | "list" }) {
  if (layout === "grid") {
    return (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3 p-4">
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="overflow-hidden rounded-[var(--radius-card)] border border-border">
            <div className="shimmer h-28" />
            <div className="flex items-center gap-2 px-2.5 py-2"><div className="shimmer h-4 w-4 rounded" /><div className="shimmer h-3 flex-1 rounded" /></div>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div>
      {Array.from({ length: 10 }).map((_, i) => (
        <div key={i} className="grid grid-cols-[minmax(0,1fr)_150px_130px_36px] items-center gap-3 border-b border-border px-3 py-2.5">
          <div className="flex items-center gap-2.5"><div className="shimmer h-7 w-7 rounded-md" /><div className="shimmer h-3.5 w-1/3 rounded" /></div>
          <div className="shimmer h-3 w-20 rounded" /><div className="shimmer h-3 w-16 rounded" /><div />
        </div>
      ))}
    </div>
  );
}

const EMPTY_COPY: Record<DriveView, { icon: typeof Folder; title: string; body: string }> = {
  myDrive: { icon: FolderOpen, title: "This folder is empty", body: "Upload files or create a folder to get started." },
  recent: { icon: File, title: "Nothing recent", body: "Files you open or edit will show up here." },
  starred: { icon: Star, title: "No starred items", body: "Star files and folders to find them fast." },
  trash: { icon: FolderOpen, title: "Trash is empty", body: "Items you delete land here for 30 days." },
  search: { icon: Search, title: "No matches", body: "Try a different search term." },
};

export function DriveEmptyState({ view, onUpload }: { view: DriveView; onUpload?: () => void }) {
  const { icon: Icon, title, body } = EMPTY_COPY[view];
  return (
    <div className="grid min-h-[320px] place-items-center p-6 text-center">
      <div>
        <span className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-surface-2 text-muted"><Icon size={26} /></span>
        <div className="text-[15px] font-semibold">{title}</div>
        <p className="mx-auto mt-1 max-w-xs text-[13px] text-muted">{body}</p>
        {view === "myDrive" && onUpload && (
          <button onClick={onUpload} className="mx-auto mt-4 inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-border bg-surface px-3.5 py-2 text-[13px] font-medium hover:bg-surface-2">
            <UploadCloud size={15} /> Upload files
          </button>
        )}
      </div>
    </div>
  );
}

export function DriveErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="grid min-h-[320px] place-items-center p-6 text-center">
      <div>
        <div className="text-[15px] font-semibold">Couldn't load this</div>
        <p className="mx-auto mt-1 max-w-sm text-[13px] text-muted">{message}</p>
        <button onClick={onRetry} className="mx-auto mt-4 inline-flex items-center gap-2 rounded-[var(--radius-control)] bg-primary px-3.5 py-2 text-[13px] font-medium text-primary-foreground hover:bg-primary-hover">
          Retry
        </button>
      </div>
    </div>
  );
}

export { metaLine };
