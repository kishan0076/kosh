import { useEffect, useState } from "react";
import { Download, History, Pin, PinOff, RefreshCw, Trash2 } from "lucide-react";
import { formatBytes } from "@kosh/shared";
import { ago } from "@/lib/time";
import { cn } from "@/lib/cn";
import { Button, Skeleton, Spinner } from "@/components/ui";
import { Modal } from "@/components/overlays";
import { useUi } from "@/data/ui";
import { driveV2Api, type DriveNode, type DriveRevision } from "@/data/driveV2Api";
import { useDriveV2 } from "@/data/driveV2";

// Row icon actions (download / pin / delete) share one hit box: 32px at rest, the 40px floor on touch.
const ROW_ICON = "grid h-8 w-8 place-items-center rounded-md hover:bg-surface-2 [@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:w-10";

/** A revision-row silhouette (two text lines, the action cluster) — same height as a real row. */
function RevisionSkeleton() {
  return (
    <div className="flex items-center gap-3 py-2.5">
      <div className="min-w-0 flex-1 space-y-2">
        <Skeleton className="h-3.5 w-2/5" />
        <Skeleton className="h-3 w-3/5" />
      </div>
      <Skeleton className="h-8 w-[68px] [@media(pointer:coarse)]:h-10" />
    </div>
  );
}

export function RevisionsModal({ node, onClose }: { node: DriveNode; onClose: () => void }) {
  const accountId = useDriveV2((s) => s.accountId)!;
  const download = useDriveV2((s) => s.downloadRevision);
  const toast = useUi((s) => s.toast);
  const [revs, setRevs] = useState<DriveRevision[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const { revisions } = await driveV2Api.listRevisions(accountId, node.id);
      setRevs([...revisions].reverse()); // newest first
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load version history.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [accountId, node.id]);

  async function remove(rev: DriveRevision) {
    setBusy(rev.id);
    try {
      await driveV2Api.deleteRevision(accountId, node.id, rev.id);
      setRevs((rs) => rs.filter((r) => r.id !== rev.id));
      toast({ message: "Version deleted", tone: "ok" });
    } catch {
      toast({ message: "Couldn't delete that version", tone: "danger" });
    } finally {
      setBusy(null);
    }
  }

  async function toggleKeep(rev: DriveRevision) {
    setBusy(rev.id);
    try {
      const { revision } = await driveV2Api.updateRevision(accountId, node.id, rev.id, !rev.keepForever);
      setRevs((rs) => rs.map((r) => (r.id === rev.id ? { ...r, keepForever: revision.keepForever } : r)));
      toast({ message: revision.keepForever ? "Version pinned — kept forever" : "Version unpinned", tone: "ok" });
    } catch {
      toast({ message: "Couldn't update that version", tone: "danger" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal open onClose={onClose} className="max-w-lg" labelledBy="rev-title">
      <div className="flex items-center gap-3 border-b border-border px-5 py-4">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary-soft text-primary"><History size={19} /></span>
        <div className="min-w-0">
          <h2 id="rev-title" className="truncate text-[15px] font-semibold">Version history</h2>
          <p className="truncate text-[12px] text-muted">{node.name}</p>
        </div>
      </div>
      <div className="max-h-[60vh] overflow-y-auto px-5 py-3">
        {loading ? (
          <div role="status" aria-busy="true" aria-label="Loading versions" className="divide-y divide-border">
            {[0, 1, 2].map((i) => <RevisionSkeleton key={i} />)}
          </div>
        ) : error ? (
          <div className="flex flex-wrap items-center gap-2 py-3 text-[13px] text-danger">
            <span className="min-w-0 flex-1">{error}</span>
            <Button variant="outline" size="sm" onClick={() => void load()}><RefreshCw size={14} /> Try again</Button>
          </div>
        ) : revs.length === 0 ? (
          <p className="py-3 text-[13px] text-muted">No prior versions. Google-native docs (Docs/Sheets/Slides) keep history in Drive itself.</p>
        ) : (
          <div className="divide-y divide-border">
            {revs.map((r, i) => (
              <div key={r.id} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-[13px] font-medium">
                    {r.modifiedTime ? ago(r.modifiedTime) : "Unknown time"}
                    {i === 0 && <span className="rounded-full bg-ok-soft px-1.5 py-0.5 text-[11px] text-ok">current</span>}
                    {r.keepForever && <span className="inline-flex items-center gap-0.5 rounded-full bg-primary-soft px-1.5 py-0.5 text-[11px] text-primary"><Pin size={9} /> kept</span>}
                  </div>
                  <div className="text-[11.5px] text-faint">{r.lastModifyingUser?.displayName ?? "Someone"}{r.size != null ? ` · ${formatBytes(r.size)}` : ""}</div>
                </div>
                {busy === r.id ? (
                  <Spinner size={14} className="text-muted" />
                ) : (
                  <div className="flex items-center gap-0.5">
                    <button onClick={() => void download(node.id, r.id, node.name)} className={cn(ROW_ICON, "text-muted hover:text-primary")} aria-label="Download this version" title="Download this version"><Download size={15} /></button>
                    <button onClick={() => void toggleKeep(r)} className={cn(ROW_ICON, r.keepForever ? "text-primary" : "text-muted hover:text-primary")} aria-label={r.keepForever ? "Unpin this version" : "Keep this version forever"} title={r.keepForever ? "Unpin (allow auto-cleanup)" : "Keep forever (pin)"}>
                      {r.keepForever ? <Pin size={15} /> : <PinOff size={15} />}
                    </button>
                    {i !== 0 && <button onClick={() => remove(r)} className={cn(ROW_ICON, "text-muted hover:text-danger")} aria-label="Delete this version" title="Delete this version"><Trash2 size={15} /></button>}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      {!loading && !error && revs.length > 0 && (
        <p className="border-t border-border px-5 py-2.5 text-[11.5px] text-faint">
          Download any version to your device, or pin one to keep it forever. To restore an old version, download it and re-upload — Drive makes it the new current version.
        </p>
      )}
      <div className="flex justify-end border-t border-border px-5 py-3.5">
        <Button variant="primary" onClick={onClose}>Done</Button>
      </div>
    </Modal>
  );
}
