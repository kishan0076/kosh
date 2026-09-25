import { useState } from "react";
import { ArrowRight, Type } from "lucide-react";
import { Button, Input } from "@/components/ui";
import { Modal } from "@/components/overlays";
import { useUi } from "@/data/ui";
import { useDriveV2 } from "@/data/driveV2";
import { sortNodes } from "./items";

/** Split "name.ext" into [base, ".ext"] for files (folders keep the whole name). */
function splitExt(name: string, isFolder: boolean): [string, string] {
  if (isFolder) return [name, ""];
  const dot = name.lastIndexOf(".");
  return dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
}

export function BulkRenameModal({ ids, onClose }: { ids: string[]; onClose: () => void }) {
  const rename = useDriveV2((s) => s.rename);
  const toast = useUi((s) => s.toast);
  const [find, setFind] = useState("");
  const [replace, setReplace] = useState("");
  const [numbering, setNumbering] = useState(false);
  const [start, setStart] = useState(1);
  const [busy, setBusy] = useState(false);

  // Snapshot the targets once, ordered by the SAME sort the user sees on screen so sequential numbering
  // (1, 2, 3…) follows the visible list. A snapshot (not a live selector) keeps rows that were already
  // renamed mid-apply from re-entering the preview with double numbering ("Backups 1 → Backups 1 1").
  const [targets] = useState(() => {
    const { nodes, prefs } = useDriveV2.getState();
    const idSet = new Set(ids);
    return sortNodes(nodes.filter((n) => idSet.has(n.id)), prefs.sortKey, prefs.sortDir);
  });

  const rename1 = (name: string, isFolder: boolean, index: number): string => {
    let [b, ext] = splitExt(name, isFolder);
    if (find) b = b.split(find).join(replace);
    if (numbering) b = `${b} ${start + index}`.trim();
    return (b + ext).trim() || name;
  };

  const preview = targets.slice(0, 8).map((n, i) => ({ id: n.id, from: n.name, to: rename1(n.name, n.isFolder, i) }));
  const anyChange = targets.some((n, i) => rename1(n.name, n.isFolder, i) !== n.name);

  async function apply() {
    if (!anyChange || busy) return;
    setBusy(true);
    let ok = 0;
    // Sequential so numbering order is stable and we don't hammer the API.
    for (let i = 0; i < targets.length; i++) {
      const n = targets[i]!;
      const next = rename1(n.name, n.isFolder, i);
      if (next === n.name) continue;
      try {
        await rename(n.id, next, { silent: true }); // one summary toast below, not one per item
        ok++;
      } catch {
        /* rename() already toasts on failure */
      }
    }
    setBusy(false);
    toast({ message: `Renamed ${ok} item${ok === 1 ? "" : "s"}`, tone: ok ? "ok" : "warn" });
    onClose();
  }

  return (
    <Modal open onClose={onClose} className="max-w-lg" labelledBy="bulk-title">
      <div className="flex shrink-0 items-center gap-3 border-b border-border px-5 py-4">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary-soft text-primary"><Type size={19} /></span>
        <div>
          <h2 id="bulk-title" className="text-[15px] font-semibold">Bulk rename</h2>
          <p className="text-[12px] text-muted">{targets.length} item{targets.length === 1 ? "" : "s"} · extensions are preserved</p>
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="mb-1 block text-[12px] font-medium text-muted">Find</label>
            <Input value={find} onChange={(e) => setFind(e.target.value)} placeholder="text to replace" />
          </div>
          <div>
            <label className="mb-1 block text-[12px] font-medium text-muted">Replace with</label>
            <Input value={replace} onChange={(e) => setReplace(e.target.value)} placeholder="replacement" />
          </div>
        </div>
        <label className="flex min-h-10 flex-wrap items-center gap-2 text-[13px]">
          <input type="checkbox" checked={numbering} onChange={(e) => setNumbering(e.target.checked)} className="h-5 w-5 accent-[var(--primary)]" />
          Append a number, starting from
          <Input type="number" value={start} min={0} onChange={(e) => setStart(Number(e.target.value) || 0)} disabled={!numbering} className="h-9 w-20" />
        </label>

        <div className="rounded-[var(--radius-control)] border border-border bg-surface-2">
          <div className="border-b border-border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-faint">Preview</div>
          <div className="max-h-56 overflow-y-auto">
            {/* Stacked on phones so the NEW name (the thing the preview exists to verify) is never truncated. */}
            {preview.map((p) => (
              <div key={p.id} className="flex flex-col gap-0.5 border-b border-border px-3 py-2 text-[12px] last:border-0 sm:flex-row sm:items-center sm:gap-2">
                <span className="min-w-0 truncate text-muted line-through sm:flex-1">{p.from}</span>
                <ArrowRight size={13} className="hidden shrink-0 text-faint sm:block" />
                <span className="min-w-0 break-all font-medium sm:flex-1 sm:truncate">{p.to}</span>
              </div>
            ))}
            {targets.length > preview.length && <div className="px-3 py-1.5 text-[11.5px] text-faint">…and {targets.length - preview.length} more</div>}
          </div>
        </div>
      </div>
      <div className="flex shrink-0 justify-end gap-2 border-t border-border px-5 py-3.5">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={apply} disabled={!anyChange} loading={busy}><Type size={15} /> Rename {targets.length}</Button>
      </div>
    </Modal>
  );
}
