import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, Check, ChevronRight, CornerUpRight, Folder, FolderPlus, Info, Trash2 } from "lucide-react";
import { formatBytes } from "@kosh/shared";
import { cn } from "@/lib/cn";
import { Button, Spinner } from "@/components/ui";
import { Modal } from "@/components/overlays";
import { driveApi } from "@/data/driveApi";
import { driveV2Api, FOLDER_COLORS, type DriveNode } from "@/data/driveV2Api";
import { useDriveV2 } from "@/data/driveV2";

const INVALID = /[/\u0000-\u001f]/; // no slash, no control chars

/* ── Create folder ── */
export function CreateFolderModal({ parentId, onClose }: { parentId: string; onClose: () => void }) {
  const accountId = useDriveV2((s) => s.accountId);
  const path = useDriveV2((s) => s.path);
  const createFolder = useDriveV2((s) => s.createFolder);

  const [name, setName] = useState("");
  const [showMore, setShowMore] = useState(false);
  const [color, setColor] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dupHint, setDupHint] = useState(false);

  const trimmed = name.trim();
  const invalid = trimmed.length === 0 ? null : INVALID.test(trimmed) ? "Names can't contain “/”." : trimmed.length > 255 ? "That name is too long." : null;
  const dest = path.length ? `My Drive / ${path.map((p) => p.name).join(" / ")}` : "My Drive";

  // Debounced duplicate hint (best-effort).
  useEffect(() => {
    if (!accountId || !trimmed || invalid) { setDupHint(false); return; }
    let live = true;
    const t = window.setTimeout(async () => {
      try {
        const { duplicates } = await driveApi.duplicates(accountId, parentId, [trimmed]);
        if (live) setDupHint(duplicates.some((d) => d.name === trimmed));
      } catch { /* ignore */ }
    }, 350);
    return () => { live = false; window.clearTimeout(t); };
  }, [accountId, parentId, trimmed, invalid]);

  async function submit() {
    if (!trimmed || invalid || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await createFolder({ name: trimmed, parentId, folderColorRgb: color ?? undefined, description: description.trim() || undefined });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create the folder.");
      setSubmitting(false);
    }
  }

  return (
    <Modal open onClose={onClose} className="max-w-md" labelledBy="cf-title">
      <div className="flex items-center gap-3 border-b border-border px-5 py-4">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary-soft text-primary"><FolderPlus size={20} /></span>
        <div className="min-w-0">
          <h2 id="cf-title" className="text-[15px] font-semibold">New folder</h2>
          <p className="truncate text-[12px] text-muted">in {dest}</p>
        </div>
      </div>
      <div className="space-y-3 px-5 py-4">
        <div>
          <label htmlFor="cf-name" className="mb-1.5 block text-[12px] font-medium text-muted">Name</label>
          <input
            id="cf-name"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void submit(); }}
            placeholder="Untitled folder"
            className="w-full rounded-[var(--radius-control)] border border-border bg-surface px-3 py-2 text-[14px] outline-none focus:border-primary focus:ring-focus"
          />
          {invalid && <p className="mt-1 text-[11.5px] text-danger">{invalid}</p>}
          {!invalid && dupHint && <p className="mt-1 inline-flex items-center gap-1 text-[11.5px] text-info"><Info size={12} /> A folder named “{trimmed}” already exists here.</p>}
        </div>

        <button onClick={() => setShowMore((v) => !v)} className="text-[12.5px] font-medium text-primary hover:underline">
          {showMore ? "Fewer options" : "More options"}
        </button>

        {showMore && (
          <div className="space-y-3 rounded-[var(--radius-control)] border border-border bg-surface-2 p-3">
            <div>
              <span className="mb-1.5 block text-[12px] font-medium text-muted">Color</span>
              <div className="flex flex-wrap gap-2">
                <button onClick={() => setColor(null)} className={cn("grid h-6 w-6 place-items-center rounded-full border", color === null ? "border-foreground" : "border-border")} aria-label="Default color">
                  <Folder size={13} className="text-muted" />
                </button>
                {FOLDER_COLORS.map((c) => (
                  <button
                    key={c.hex}
                    onClick={() => setColor(c.hex)}
                    aria-label={c.name}
                    aria-pressed={color === c.hex}
                    // The one sanctioned raw-hex spot: Google Drive's own folder-color palette.
                    style={{ backgroundColor: c.hex }}
                    className={cn("h-6 w-6 rounded-full ring-offset-2 ring-offset-surface-2 transition-shadow", color === c.hex && "ring-2 ring-foreground")}
                  >
                    {color === c.hex && <Check size={13} className="mx-auto text-white" />}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label htmlFor="cf-desc" className="mb-1.5 block text-[12px] font-medium text-muted">Description <span className="text-faint">(optional)</span></label>
              <textarea id="cf-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="w-full resize-none rounded-[var(--radius-control)] border border-border bg-surface px-3 py-2 text-[13px] outline-none focus:border-primary focus:ring-focus" />
            </div>
          </div>
        )}

        {error && <p className="text-[12px] text-danger">{error}</p>}
      </div>
      <div className="flex justify-end gap-2 border-t border-border px-5 py-3.5">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={submit} disabled={!trimmed || !!invalid || submitting}>
          {submitting ? <Spinner size={15} /> : <FolderPlus size={15} />} Create folder
        </Button>
      </div>
    </Modal>
  );
}

/* ── Delete confirmation (custom — never window.confirm) ── */
export function DeleteConfirmModal({ ids, permanent, onClose }: { ids: string[]; permanent: boolean; onClose: () => void }) {
  const nodes = useDriveV2((s) => s.nodes);
  const trash = useDriveV2((s) => s.trash);
  const deletePermanent = useDriveV2((s) => s.deletePermanent);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [typed, setTyped] = useState("");

  const targets = useMemo(() => nodes.filter((n) => ids.includes(n.id)), [nodes, ids]);
  const folders = targets.filter((n) => n.isFolder).length;
  const totalBytes = targets.reduce((a, n) => a + (n.size ?? 0), 0);
  const single = targets[0];
  const multi = ids.length > 1;

  useEffect(() => { cancelRef.current?.focus(); }, []);

  // Type-to-confirm guards EVERY permanent delete — the guard must scale with blast radius, not
  // shrink for it. Key it on `ids` (what actually gets deleted), NOT the loaded `targets`: if the
  // live nodes list no longer holds the ids (a sync/optimistic removal), targets can go empty and
  // must never disable the guard. A single item asks for its name; anything else asks for DELETE.
  const requireType = permanent && ids.length > 0;
  const singleName = !multi ? single?.name : undefined;
  const confirmWord = singleName ?? "DELETE";
  const typeOk = !requireType || (confirmWord === "DELETE" ? typed.trim().toUpperCase() === "DELETE" : typed.trim() === confirmWord);

  const title = permanent
    ? multi ? `Delete ${ids.length} items forever?` : "Delete forever?"
    : multi ? `Move ${ids.length} items to trash?` : "Move to trash?";

  async function confirm() {
    if (busy || !typeOk) return;
    setBusy(true);
    try {
      if (permanent) await deletePermanent(ids);
      else await trash(ids);
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} className="max-w-md" labelledBy="del-title">
      <div className="flex items-center gap-3 border-b border-border px-5 py-4">
        <span className={cn("grid h-10 w-10 place-items-center rounded-xl", permanent ? "bg-danger-soft text-danger" : "bg-warn-soft text-warn")}>
          {permanent ? <AlertTriangle size={20} /> : <Trash2 size={20} />}
        </span>
        <h2 id="del-title" className="text-[15px] font-semibold">{title}</h2>
      </div>
      <div className="space-y-3 px-5 py-4">
        {/* identity */}
        {single && !multi ? (
          <div className="flex items-center gap-3 rounded-[var(--radius-control)] border border-border bg-surface-2 px-3 py-2.5">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-surface"><Folder size={18} className={single.isFolder ? "text-primary" : "text-muted"} /></span>
            <div className="min-w-0">
              <div className="truncate text-[13.5px] font-medium">{single.name}</div>
              <div className="text-[11.5px] text-faint">{single.isFolder ? "Folder" : single.size != null ? formatBytes(single.size) : "File"}</div>
            </div>
          </div>
        ) : targets.length === 0 ? (
          <div className="rounded-[var(--radius-control)] border border-border bg-surface-2 px-3 py-2.5 text-[12.5px] text-muted">{ids.length} item{ids.length === 1 ? "" : "s"} selected</div>
        ) : (
          <div className="rounded-[var(--radius-control)] border border-border bg-surface-2 px-3 py-2.5">
            <ul className="space-y-1">
              {targets.slice(0, 4).map((n) => (
                <li key={n.id} className="flex items-center gap-2 text-[12.5px]"><Folder size={13} className={n.isFolder ? "text-primary" : "text-muted"} /><span className="min-w-0 flex-1 truncate">{n.name}</span></li>
              ))}
            </ul>
            {targets.length > 4 && <div className="mt-1 text-[11.5px] text-faint">and {targets.length - 4} more · {formatBytes(totalBytes)} total</div>}
          </div>
        )}

        {folders > 0 && <p className="text-[12px] text-warn">{folders} folder{folders === 1 ? "" : "s"} and all their contents are included.</p>}

        <p className={cn("text-[12.5px]", permanent ? "text-danger" : "text-muted")}>
          {permanent ? "This can't be undone. These items will be permanently deleted from Google Drive." : "You can restore these from Trash for 30 days."}
        </p>

        {requireType && (
          <div>
            <label htmlFor="del-confirm" className="mb-1.5 block text-[12px] text-muted">
              Type <span className="font-semibold text-foreground">{confirmWord}</span> to confirm
            </label>
            <input
              id="del-confirm"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void confirm(); }}
              className="w-full rounded-[var(--radius-control)] border border-border bg-surface px-3 py-2 text-[13px] outline-none focus:border-danger"
            />
          </div>
        )}
      </div>
      <div className="flex justify-end gap-2 border-t border-border px-5 py-3.5">
        <Button ref={cancelRef} variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="danger" onClick={confirm} disabled={busy || !typeOk}>
          {busy ? <Spinner size={15} /> : <Trash2 size={15} />} {permanent ? "Delete forever" : "Move to trash"}
        </Button>
      </div>
    </Modal>
  );
}

/* ── Empty trash (irreversible — the strongest guard in the module) ── */
export function EmptyTrashModal({ onClose }: { onClose: () => void }) {
  const nodes = useDriveV2((s) => s.nodes);
  const nextPageToken = useDriveV2((s) => s.nextPageToken);
  const quota = useDriveV2((s) => s.quota);
  const emptyTrash = useDriveV2((s) => s.emptyTrash);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [typed, setTyped] = useState("");

  useEffect(() => { cancelRef.current?.focus(); }, []);

  // The loaded page may be partial (pagination), so "N+" when more pages exist; the authoritative
  // reclaimable size comes from the account quota, not the loaded rows.
  const loaded = nodes.length;
  const more = !!nextPageToken;
  const trashBytes = quota?.usageInDriveTrash ?? 0;
  const CONFIRM = "DELETE";
  const typeOk = typed.trim().toUpperCase() === CONFIRM;

  async function confirm() {
    if (busy || !typeOk) return;
    setBusy(true);
    try {
      await emptyTrash();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} className="max-w-md" labelledBy="et-title">
      <div className="flex items-center gap-3 border-b border-border px-5 py-4">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-danger-soft text-danger"><AlertTriangle size={20} /></span>
        <h2 id="et-title" className="text-[15px] font-semibold">Empty trash?</h2>
      </div>
      <div className="space-y-3 px-5 py-4">
        <div className="flex items-center gap-3 rounded-[var(--radius-control)] border border-border bg-surface-2 px-3 py-2.5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-surface text-danger"><Trash2 size={18} /></span>
          <div className="min-w-0">
            <div className="text-[13.5px] font-medium">{loaded ? `${loaded}${more ? "+" : ""} item${loaded === 1 && !more ? "" : "s"} in trash` : "Everything in trash"}</div>
            {trashBytes > 0 && <div className="text-[11.5px] text-faint">Frees about {formatBytes(trashBytes)}</div>}
          </div>
        </div>
        <p className="text-[12.5px] text-danger">This permanently deletes <span className="font-semibold">every</span> item in your trash from Google Drive. It can't be undone.</p>
        <div>
          <label htmlFor="et-confirm" className="mb-1.5 block text-[12px] text-muted">Type <span className="font-semibold text-foreground">{CONFIRM}</span> to confirm</label>
          <input
            id="et-confirm"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void confirm(); }}
            className="w-full rounded-[var(--radius-control)] border border-border bg-surface px-3 py-2 text-[13px] outline-none focus:border-danger"
          />
        </div>
      </div>
      <div className="flex justify-end gap-2 border-t border-border px-5 py-3.5">
        <Button ref={cancelRef} variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="danger" onClick={confirm} disabled={busy || !typeOk}>
          {busy ? <Spinner size={15} /> : <Trash2 size={15} />} Empty trash
        </Button>
      </div>
    </Modal>
  );
}

/* ── Move to (navigable folder picker) ── */
export function MoveToModal({ ids, onClose }: { ids: string[]; onClose: () => void }) {
  const accountId = useDriveV2((s) => s.accountId);
  const move = useDriveV2((s) => s.move);
  const [stack, setStack] = useState<{ id: string; name: string }[]>([]);
  const [folders, setFolders] = useState<DriveNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [moving, setMoving] = useState(false);
  const destId = stack.at(-1)?.id ?? "root";
  const movingSet = useMemo(() => new Set(ids), [ids]);

  useEffect(() => {
    if (!accountId) return;
    let live = true;
    setLoading(true);
    driveV2Api
      .list(accountId, destId)
      .then((r) => { if (live) { setFolders(r.files.filter((f) => f.isFolder)); setLoading(false); } })
      .catch(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [accountId, destId]);

  async function confirm() {
    setMoving(true);
    try {
      await move(ids, destId);
      onClose();
    } finally {
      setMoving(false);
    }
  }

  return (
    <Modal open onClose={onClose} className="max-w-md" labelledBy="mv-title">
      <div className="flex items-center gap-3 border-b border-border px-5 py-4">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary-soft text-primary"><CornerUpRight size={19} /></span>
        <h2 id="mv-title" className="text-[15px] font-semibold">Move {ids.length} item{ids.length === 1 ? "" : "s"}</h2>
      </div>
      <div className="px-5 py-3">
        <div className="mb-2 flex items-center gap-1 text-[12.5px]">
          {stack.length > 0 && (
            <button onClick={() => setStack((s) => s.slice(0, -1))} className="grid h-6 w-6 place-items-center rounded-md text-muted hover:bg-surface-2" aria-label="Back"><ArrowLeft size={14} /></button>
          )}
          <button onClick={() => setStack([])} className="rounded px-1.5 py-0.5 font-medium hover:bg-surface-2">My Drive</button>
          {stack.map((f, i) => (
            <span key={f.id} className="flex items-center gap-0.5">
              <ChevronRight size={12} className="text-faint" />
              <button onClick={() => setStack((s) => s.slice(0, i + 1))} className="max-w-[120px] truncate rounded px-1.5 py-0.5 hover:bg-surface-2">{f.name}</button>
            </span>
          ))}
        </div>
        <div className="h-56 overflow-y-auto rounded-[var(--radius-control)] border border-border">
          {loading ? (
            <div className="grid h-full place-items-center"><Spinner size={18} className="text-muted" /></div>
          ) : folders.length === 0 ? (
            <div className="grid h-full place-items-center px-4 text-center text-[12.5px] text-muted">No sub-folders here.</div>
          ) : (
            folders.map((f) => (
              <button
                key={f.id}
                disabled={movingSet.has(f.id)}
                onClick={() => setStack((s) => [...s, { id: f.id, name: f.name }])}
                className="flex w-full items-center gap-2 border-b border-border px-3 py-2 text-left text-[13px] last:border-0 hover:bg-surface-2 disabled:opacity-40"
              >
                <Folder size={16} className="shrink-0 text-primary" />
                <span className="min-w-0 flex-1 truncate">{f.name}</span>
                <ChevronRight size={14} className="shrink-0 text-faint" />
              </button>
            ))
          )}
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-border px-5 py-3.5">
        <span className="truncate text-[12px] text-muted">Into: <span className="font-medium text-foreground">{stack.at(-1)?.name ?? "My Drive"}</span></span>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={confirm} disabled={moving}>{moving ? <Spinner size={15} /> : <CornerUpRight size={15} />} Move here</Button>
        </div>
      </div>
    </Modal>
  );
}
