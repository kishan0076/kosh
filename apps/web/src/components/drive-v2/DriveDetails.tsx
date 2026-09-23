import { useEffect, useState, type ReactNode } from "react";
import { Check, ChevronLeft, ChevronRight, CornerUpRight, Download, ExternalLink, Eye, Pencil, Plus, RotateCw, Share2, Star, Tag, Trash2, User, Users, X, ZoomIn, ZoomOut } from "lucide-react";
import { formatBytes, normalizeTag, parseTags } from "@kosh/shared";
import { cn } from "@/lib/cn";
import { ago } from "@/lib/time";
import { NodeIcon, tagChipClass } from "./items";
import { Button, Spinner, Textarea } from "@/components/ui";
import { Markdown } from "@/components/markdown";
import { kindOf, type DriveKind, type DriveNode } from "@/data/driveV2Api";
import { useDriveV2 } from "@/data/driveV2";

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
  onSetTags,
  onDownload,
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
  onSetTags: (node: DriveNode, tags: string[]) => void;
  onDownload: (node: DriveNode) => void;
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
            {!node.isFolder && <QuickAction icon={Download} label="Download" onClick={() => onDownload(node)} />}
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

        <TagsEditor key={`tags-${node.id}`} node={node} onSetTags={(tags) => onSetTags(node, tags)} />

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
          <Textarea autoFocus value={value} onChange={(e) => setValue(e.target.value)} rows={3} maxLength={1000} className="min-h-0 resize-none text-[12.5px]" />
          <div className="flex justify-end gap-1.5">
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)}><X size={13} /> Cancel</Button>
            <Button variant="primary" size="sm" onClick={() => { onSave(value.trim()); setEditing(false); }}><Check size={13} /> Save</Button>
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

/** Editable tag chips — persisted to the file's app-private Drive `appProperties`. */
function TagsEditor({ node, onSetTags }: { node: DriveNode; onSetTags: (tags: string[]) => void }) {
  const canEdit = node.capabilities?.canEdit !== false;
  const tags = parseTags(node);
  const [draft, setDraft] = useState("");
  const add = () => {
    const t = normalizeTag(draft);
    setDraft("");
    if (t && !tags.includes(t)) onSetTags([...tags, t]);
  };
  return (
    <div className="border-t border-border px-4 py-3">
      <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-faint"><Tag size={12} /> Tags</div>
      {(tags.length > 0 || !canEdit) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {tags.map((t) => (
            <span key={t} className={cn("inline-flex items-center gap-1 rounded-[var(--radius-chip)] px-1.5 py-0.5 text-[11px] font-medium", tagChipClass(t))}>
              {t}
              {canEdit && <button onClick={() => onSetTags(tags.filter((x) => x !== t))} aria-label={`Remove tag ${t}`} className="opacity-70 transition-opacity hover:opacity-100"><X size={10} /></button>}
            </span>
          ))}
          {!tags.length && <span className="text-[12.5px] text-faint">No tags.</span>}
        </div>
      )}
      {canEdit && (
        <div className="mt-2 flex items-center gap-1.5">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
            placeholder="Add a tag…"
            maxLength={32}
            className="min-w-0 flex-1 rounded-[var(--radius-control)] border border-border bg-surface-2 px-2 py-1 text-[12.5px] outline-none focus:border-primary"
          />
          <Button variant="ghost" size="sm" disabled={!draft.trim()} onClick={add}><Plus size={13} /> Add</Button>
        </div>
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

/* ── Quick Look ── */

const TEXT_EXT = new Set(["txt", "log", "json", "xml", "yaml", "yml", "toml", "ini", "env", "js", "ts", "tsx", "jsx", "mjs", "cjs", "css", "scss", "html", "py", "rb", "go", "rs", "java", "kt", "c", "cpp", "h", "hpp", "sh", "bash", "sql", "swift", "php"]);
const TEXT_PREVIEW_CAP = 2_000_000; // don't stream huge files into memory for a peek

/** Which inline Quick Look renderer fits a file, if any (native rendering beats a Drive iframe). */
function textPreviewKind(node: DriveNode): "markdown" | "csv" | "code" | null {
  if (node.isFolder) return null;
  if (node.size != null && node.size > TEXT_PREVIEW_CAP) return null;
  const mime = node.mimeType || "";
  const ext = (node.name.split(".").pop() || "").toLowerCase();
  if (mime === "text/markdown" || ext === "md" || ext === "markdown") return "markdown";
  if (mime === "text/csv" || ext === "csv") return "csv";
  if (mime === "text/tab-separated-values" || ext === "tsv") return "csv";
  if (mime.startsWith("text/") || mime === "application/json" || mime === "application/xml" || TEXT_EXT.has(ext)) return "code";
  return null;
}

/** Tiny quote-aware CSV/TSV parser — enough for a read-only preview (first rows only). */
function parseDelimited(text: string, delimiter: string, maxRows: number): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length && rows.length < maxRows; i++) {
    const c = text[i]!;
    if (inQuotes) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === delimiter) { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if ((field || row.length) && rows.length < maxRows) { row.push(field); rows.push(row); }
  return rows;
}

/** Full-screen Quick Look: native rendering for images (zoom/rotate) and text/markdown/code/CSV; a
 *  Drive iframe for PDF/Docs/Sheets/Slides/video; filmstrip prev/next across the visible list. */
export function PreviewOverlay({ node, list = [], onClose }: { node: DriveNode; list?: DriveNode[]; onClose: () => void }) {
  const isImage = node.mimeType.startsWith("image/");
  const imgSrc = node.thumbnailLink?.replace(/=s\d+$/, "=s1600") ?? node.webContentLink;
  const textKind = !isImage ? textPreviewKind(node) : null;
  const frame = !isImage && !textKind ? embedUrl(node) : null;

  const [loading, setLoading] = useState(!isImage && !textKind && !!frame);
  const [text, setText] = useState<string | null>(null);
  const [textErr, setTextErr] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [rot, setRot] = useState(0);

  // Filmstrip position within the (already sorted+filtered) visible list.
  const idx = list.findIndex((n) => n.id === node.id);
  const go = (delta: number) => { const t = list[idx + delta]; if (t) useDriveV2.getState().setPreview(t); };
  const hasPrev = idx > 0;
  const hasNext = idx >= 0 && idx < list.length - 1;

  // Reset per-node view state whenever the previewed node changes (filmstrip paging reuses this overlay).
  useEffect(() => { setZoom(1); setRot(0); setText(null); setTextErr(false); setLoading(!isImage && !textKind && !!frame); }, [node.id, isImage, textKind, frame]);

  // Fetch text content for the native text/code/CSV renderer.
  useEffect(() => {
    if (!textKind) return;
    let live = true;
    useDriveV2.getState().fetchFileText(node).then((t) => { if (live) setText(t); }).catch(() => { if (live) setTextErr(true); });
    return () => { live = false; };
  }, [node, textKind]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") { e.preventDefault(); go(1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); go(-1); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose, idx, list]);

  const ChromeBtn = ({ onClick, label, disabled, children }: { onClick: () => void; label: string; disabled?: boolean; children: ReactNode }) => (
    <button onClick={onClick} disabled={disabled} aria-label={label} className="grid h-8 w-8 place-items-center rounded-md text-white transition-colors hover:bg-white/10 disabled:opacity-30">{children}</button>
  );

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-black/80 backdrop-blur-sm" onClick={onClose}>
      <div className="flex items-center gap-2 px-4 py-3 text-white" onClick={(e) => e.stopPropagation()}>
        <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">{node.name}</span>
        {list.length > 1 && idx >= 0 && <span className="shrink-0 tabular text-[12px] text-white/60">{idx + 1} / {list.length}</span>}
        {isImage && (
          <>
            <ChromeBtn onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))} label="Zoom out"><ZoomOut size={17} /></ChromeBtn>
            <ChromeBtn onClick={() => setZoom((z) => Math.min(5, z + 0.25))} label="Zoom in"><ZoomIn size={17} /></ChromeBtn>
            <ChromeBtn onClick={() => setRot((r) => (r + 90) % 360)} label="Rotate"><RotateCw size={17} /></ChromeBtn>
          </>
        )}
        {!node.isFolder && <ChromeBtn onClick={() => void useDriveV2.getState().downloadNode(node.id)} label="Download"><Download size={17} /></ChromeBtn>}
        <ChromeBtn onClick={() => void useDriveV2.getState().toggleStar(node.id)} label={node.starred ? "Unstar" : "Star"}><Star size={17} className={cn(node.starred && "fill-gold text-gold")} /></ChromeBtn>
        {node.webViewLink && (
          <a href={node.webViewLink} target="_blank" rel="noreferrer noopener" onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1.5 rounded-[var(--radius-control)] bg-white/10 px-3 py-1.5 text-[12.5px] hover:bg-white/20">
            <ExternalLink size={14} /> Open in Drive
          </a>
        )}
        <ChromeBtn onClick={onClose} label="Close preview"><X size={18} /></ChromeBtn>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center p-4 sm:p-6" onClick={(e) => e.stopPropagation()}>
        {/* filmstrip arrows */}
        {hasPrev && <button onClick={() => go(-1)} aria-label="Previous" className="absolute left-2 top-1/2 z-10 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20"><ChevronLeft size={22} /></button>}
        {hasNext && <button onClick={() => go(1)} aria-label="Next" className="absolute right-2 top-1/2 z-10 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20"><ChevronRight size={22} /></button>}

        {isImage && imgSrc ? (
          <img
            src={imgSrc}
            alt={node.name}
            referrerPolicy="no-referrer"
            style={{ transform: `scale(${zoom}) rotate(${rot}deg)` }}
            className="max-h-full max-w-full rounded-lg object-contain shadow-2xl transition-transform motion-reduce:transition-none"
          />
        ) : textKind ? (
          <div className="h-full w-full max-w-4xl overflow-auto rounded-lg bg-surface p-5 text-foreground shadow-2xl">
            {text == null && !textErr ? (
              <div className="grid h-full place-items-center text-muted"><Spinner size={18} /></div>
            ) : textErr ? (
              <div className="grid h-full place-items-center text-[13px] text-muted">Couldn't load a preview. Open it in Drive instead.</div>
            ) : textKind === "markdown" ? (
              <Markdown>{text!}</Markdown>
            ) : textKind === "csv" ? (
              <table className="w-full border-collapse text-[12.5px]">
                <tbody>
                  {parseDelimited(text!, node.name.toLowerCase().endsWith(".tsv") ? "\t" : ",", 200).map((r, ri) => (
                    <tr key={ri} className={ri === 0 ? "bg-surface-2 font-semibold" : ""}>
                      {r.map((cell, ci) => <td key={ci} className="border border-border px-2 py-1 align-top">{cell}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <pre className="whitespace-pre-wrap break-words font-mono text-[12.5px] leading-relaxed">{text}</pre>
            )}
          </div>
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
