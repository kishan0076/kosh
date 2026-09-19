import { useState } from "react";
import { Check, CornerUpRight, Download, ExternalLink, Eye, Pencil, Plus, Share2, Star, Trash2, User, Users, X } from "lucide-react";
import { formatBytes } from "@kosh/shared";
import { cn } from "@/lib/cn";
import { ago } from "@/lib/time";
import { NodeIcon } from "./items";
import { kindOf, type DriveKind, type DriveNode } from "@/data/driveV2Api";

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 py-1.5 text-[12.5px]">
      <span className="shrink-0 text-muted">{label}</span>
      <span className="min-w-0 truncate text-right font-medium">{value}</span>
    </div>
  );
}

const KIND_LABEL: Record<DriveKind, string> = { folder: "Folder", doc: "Document", sheet: "Spreadsheet", slide: "Presentation", image: "Image", video: "Video", audio: "Audio", pdf: "PDF", archive: "Archive", other: "File" };

export function DriveDetails({
  node,
  count,
  totalBytes,
  loading,
  onClose,
  onRename,
  onStar,
  onMove,
  onTrash,
  onPreview,
  onShare,
  onUpdateMeta,
}: {
  node: DriveNode | null;
  count: number;
  totalBytes: number;
  loading: boolean;
  onClose: () => void;
  onRename: (node: DriveNode) => void;
  onStar: (node: DriveNode) => void;
  onMove: (node: DriveNode) => void;
  onTrash: (node: DriveNode) => void;
  onPreview: (node: DriveNode) => void;
  onShare: (node: DriveNode) => void;
  onUpdateMeta: (node: DriveNode, patch: { description?: string }) => void;
}) {
  // Multi-select aggregate
  if (count > 1) {
    return (
      <div className="flex h-full flex-col">
        <Header title={`${count} items selected`} onClose={onClose} />
        <div className="p-4 text-[13px] text-muted">Total size: <span className="font-medium text-foreground">{formatBytes(totalBytes)}</span></div>
      </div>
    );
  }
  if (!node) return null;
  const kind = kindOf(node);
  const canPreview = !node.isFolder; // images render inline; everything else embeds via Drive's viewer

  return (
    <div className="flex h-full flex-col">
      <Header title="Details" onClose={onClose} />
      <div className="flex-1 overflow-y-auto">
        <div className="flex flex-col items-center gap-3 border-b border-border px-4 py-5 text-center">
          <span className="grid h-20 w-20 place-items-center overflow-hidden rounded-xl bg-surface-2"><NodeIcon node={node} size={40} thumb /></span>
          <div className="min-w-0">
            <div className="break-words text-[14px] font-semibold">{node.name}</div>
            <div className="mt-0.5 text-[12px] text-muted">{KIND_LABEL[kind]}{!node.isFolder && node.size != null ? ` · ${formatBytes(node.size)}` : ""}</div>
          </div>
          <div className="flex flex-wrap justify-center gap-1.5">
            {canPreview && <QuickAction icon={Eye} label="Preview" onClick={() => onPreview(node)} />}
            <QuickAction icon={Star} label={node.starred ? "Unstar" : "Star"} active={node.starred} onClick={() => onStar(node)} />
            {node.capabilities?.canShare !== false && <QuickAction icon={Share2} label="Share" onClick={() => onShare(node)} />}
            {node.capabilities?.canRename !== false && <QuickAction icon={Pencil} label="Rename" onClick={() => onRename(node)} />}
            {node.capabilities?.canMoveItemWithinDrive !== false && <QuickAction icon={CornerUpRight} label="Move" onClick={() => onMove(node)} />}
            {node.webViewLink && <QuickAction icon={ExternalLink} label="Open" href={node.webViewLink} />}
            {node.webContentLink && <QuickAction icon={Download} label="Download" href={node.webContentLink} />}
            {node.capabilities?.canTrash !== false && <QuickAction icon={Trash2} label="Trash" danger onClick={() => onTrash(node)} />}
          </div>
        </div>

        <div className="px-4 py-3">
          {loading && <div className="mb-2 text-[11.5px] text-faint">Loading details…</div>}
          <Fact label="Type" value={KIND_LABEL[kind]} />
          {!node.isFolder && node.size != null && <Fact label="Size" value={formatBytes(node.size)} />}
          <Fact label="Owner" value={node.owners?.[0]?.displayName ?? (node.ownedByMe ? "Me" : "—")} />
          {node.modifiedTime && <Fact label="Modified" value={ago(node.modifiedTime)} />}
          {node.createdTime && <Fact label="Created" value={ago(node.createdTime)} />}
          <Fact label="Shared" value={node.shared ? "Yes" : "No"} />
          {node.md5Checksum && <Fact label="Checksum" value={node.md5Checksum.slice(0, 12) + "…"} />}
        </div>

        <NotesEditor key={node.id} node={node} onSave={(desc) => onUpdateMeta(node, { description: desc })} />


        <div className="border-t border-border px-4 py-3">
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-faint">
            {node.shared ? <Users size={12} /> : <User size={12} />} Sharing
          </div>
          <p className="text-[12.5px] text-muted">{node.shared ? "Shared with others." : "Private to you."} {node.ownedByMe ? "You own this." : ""}</p>
        </div>
      </div>
    </div>
  );
}

/** Editable notes — persisted to the file's Drive `description`. */
function NotesEditor({ node, onSave }: { node: DriveNode; onSave: (desc: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(node.description ?? "");
  const canEdit = node.capabilities?.canEdit !== false;
  return (
    <div className="border-t border-border px-4 py-3">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-faint">Notes</span>
        {canEdit && !editing && (
          <button onClick={() => { setValue(node.description ?? ""); setEditing(true); }} className="inline-flex items-center gap-1 text-[11.5px] text-primary hover:underline">
            {node.description ? <><Pencil size={11} /> Edit</> : <><Plus size={12} /> Add</>}
          </button>
        )}
      </div>
      {editing ? (
        <div className="space-y-2">
          <textarea autoFocus value={value} onChange={(e) => setValue(e.target.value)} rows={3} maxLength={1000} className="w-full resize-none rounded-[var(--radius-control)] border border-border bg-surface px-2.5 py-2 text-[12.5px] outline-none focus:border-primary focus:ring-focus" />
          <div className="flex justify-end gap-1.5">
            <button onClick={() => setEditing(false)} className="rounded-md px-2 py-1 text-[12px] text-muted hover:bg-surface-2"><X size={13} className="mr-1 inline" />Cancel</button>
            <button onClick={() => { onSave(value.trim()); setEditing(false); }} className="rounded-md bg-primary px-2 py-1 text-[12px] font-medium text-primary-foreground hover:bg-primary-hover"><Check size={13} className="mr-1 inline" />Save</button>
          </div>
        </div>
      ) : node.description ? (
        <p className="whitespace-pre-wrap text-[12.5px] text-muted">{node.description}</p>
      ) : (
        <p className="text-[12.5px] text-faint">No notes yet.</p>
      )}
    </div>
  );
}

function Header({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="flex items-center justify-between border-b border-border px-4 py-3">
      <span className="text-[13px] font-semibold">{title}</span>
      <button onClick={onClose} className="grid h-7 w-7 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-foreground" aria-label="Close details"><X size={16} /></button>
    </div>
  );
}

function QuickAction({ icon: Icon, label, onClick, href, danger, active }: { icon: typeof Star; label: string; onClick?: () => void; href?: string; danger?: boolean; active?: boolean }) {
  const cls = cn(
    "grid h-9 w-9 place-items-center rounded-[var(--radius-control)] border border-border transition-colors",
    danger ? "text-muted hover:border-danger/40 hover:bg-danger-soft hover:text-danger" : active ? "border-gold/40 bg-gold-soft text-gold" : "text-muted hover:bg-surface-2 hover:text-foreground",
  );
  if (href) return <a href={href} target="_blank" rel="noreferrer noopener" className={cls} aria-label={label} title={label}><Icon size={16} /></a>;
  return <button onClick={onClick} className={cls} aria-label={label} title={label}><Icon size={16} /></button>;
}

/** The Google embed URL for a node — native Docs/Sheets/Slides use docs.google.com; the rest use Drive. */
function embedUrl(node: DriveNode): string | null {
  const id = node.id;
  switch (node.mimeType) {
    case "application/vnd.google-apps.document": return `https://docs.google.com/document/d/${id}/preview`;
    case "application/vnd.google-apps.spreadsheet": return `https://docs.google.com/spreadsheets/d/${id}/preview`;
    case "application/vnd.google-apps.presentation": return `https://docs.google.com/presentation/d/${id}/preview`;
    case "application/vnd.google-apps.folder": return null;
    default: return `https://drive.google.com/file/d/${id}/preview`; // PDF, video, and most binary types
  }
}

/* ── full-screen preview — images render inline; PDFs/Docs/Sheets/Slides/video embed via Drive (CSP frame-src) ── */
export function PreviewOverlay({ node, onClose }: { node: DriveNode; onClose: () => void }) {
  const isImage = node.mimeType.startsWith("image/");
  const imgSrc = node.thumbnailLink?.replace(/=s\d+$/, "=s1600") ?? node.webContentLink;
  const frame = isImage ? null : embedUrl(node);
  const [loading, setLoading] = useState(!isImage && !!frame);
  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-black/80 backdrop-blur-sm" onClick={onClose}>
      <div className="flex items-center gap-3 px-4 py-3 text-white" onClick={(e) => e.stopPropagation()}>
        <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">{node.name}</span>
        {node.webViewLink && (
          <a href={node.webViewLink} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1.5 rounded-[var(--radius-control)] bg-white/10 px-3 py-1.5 text-[12.5px] hover:bg-white/20">
            <ExternalLink size={14} /> Open in Drive
          </a>
        )}
        <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-md hover:bg-white/10" aria-label="Close preview"><X size={18} /></button>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center p-4 sm:p-6" onClick={(e) => e.stopPropagation()}>
        {isImage && imgSrc ? (
          <img src={imgSrc} alt={node.name} className="max-h-full max-w-full rounded-lg object-contain shadow-2xl" />
        ) : frame ? (
          <div className="relative h-full w-full max-w-5xl">
            {loading && <div className="absolute inset-0 grid place-items-center text-white/70"><span className="animate-pulse text-[13px]">Loading preview…</span></div>}
            <iframe
              src={frame}
              title={node.name}
              onLoad={() => setLoading(false)}
              className="h-full w-full rounded-lg bg-white shadow-2xl"
              allow="autoplay"
              sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-downloads"
            />
          </div>
        ) : (
          <div className="text-center text-white/80">
            <div className="mb-2 text-[15px] font-medium">No inline preview</div>
            <p className="text-[13px] text-white/60">Open it in Google Drive to view this item.</p>
          </div>
        )}
      </div>
    </div>
  );
}
