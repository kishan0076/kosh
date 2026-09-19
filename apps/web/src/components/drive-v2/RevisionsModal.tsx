import { useEffect, useState } from "react";
import { History, Trash2 } from "lucide-react";
import { formatBytes } from "@kosh/shared";
import { ago } from "@/lib/time";
import { Button, Spinner } from "@/components/ui";
import { Modal } from "@/components/overlays";
import { useUi } from "@/data/ui";
import { driveV2Api, type DriveNode, type DriveRevision } from "@/data/driveV2Api";
import { useDriveV2 } from "@/data/driveV2";

export function RevisionsModal({ node, onClose }: { node: DriveNode; onClose: () => void }) {
  const accountId = useDriveV2((s) => s.accountId)!;
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
          <div className="grid place-items-center py-10"><Spinner size={20} className="text-muted" /></div>
        ) : error ? (
          <p className="py-3 text-[13px] text-danger">{error}</p>
        ) : revs.length === 0 ? (
          <p className="py-3 text-[13px] text-muted">No prior versions. Google-native docs (Docs/Sheets/Slides) keep history in Drive itself.</p>
        ) : (
          <div className="divide-y divide-border">
            {revs.map((r, i) => (
              <div key={r.id} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-[13px] font-medium">
                    {r.modifiedTime ? ago(r.modifiedTime) : "Unknown time"}
                    {i === 0 && <span className="rounded-full bg-ok-soft px-1.5 text-[10px] text-ok">current</span>}
                  </div>
                  <div className="text-[11.5px] text-faint">{r.lastModifyingUser?.displayName ?? "Someone"}{r.size != null ? ` · ${formatBytes(r.size)}` : ""}</div>
                </div>
                {busy === r.id ? (
                  <Spinner size={14} className="text-muted" />
                ) : i !== 0 ? (
                  <button onClick={() => remove(r)} className="grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-danger" aria-label="Delete this version"><Trash2 size={15} /></button>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="flex justify-end border-t border-border px-5 py-3.5">
        <Button variant="primary" onClick={onClose}>Done</Button>
      </div>
    </Modal>
  );
}
