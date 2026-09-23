import { Activity, Bell, BellOff, Download, FilePlus2, Folder, Pencil, RotateCcw, Trash2, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { ago } from "@/lib/time";
import { useUi } from "@/data/ui";
import { Button } from "@/components/ui";
import { useDriveV2, type ActivityEntry } from "@/data/driveV2";

/** Single source of truth for how each activity action is presented — panel label/icon/tone + notification verb. */
export const ACTION_META: Record<ActivityEntry["action"], { label: string; verb: string; icon: typeof Pencil; tone: string }> = {
  created: { label: "Created", verb: "was added", icon: FilePlus2, tone: "text-ok" },
  edited: { label: "Edited", verb: "was edited", icon: Pencil, tone: "text-primary" },
  trashed: { label: "Trashed", verb: "was trashed", icon: Trash2, tone: "text-warn" },
  removed: { label: "Removed", verb: "was removed", icon: RotateCcw, tone: "text-danger" },
};

/** Escape one CSV cell: neutralize spreadsheet formula injection, then RFC-4180-quote. */
function csvCell(v: string): string {
  // A Drive file name may legally start with =, +, -, @ (or a tab/CR) — prefix with ' so Excel/Sheets
  // treat it as text, not a formula, in this "audit log".
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function ActivityPanel({ onClose }: { onClose: () => void }) {
  const activity = useDriveV2((s) => s.activity);
  const sync = useDriveV2((s) => s.sync);
  const clearActivity = useDriveV2((s) => s.clearActivity);
  const notifyDesktop = useDriveV2((s) => s.notifyDesktop);
  const setNotifyDesktop = useDriveV2((s) => s.setNotifyDesktop);
  const toast = useUi((s) => s.toast);

  async function toggleNotify() {
    const on = await setNotifyDesktop(!notifyDesktop);
    if (on) toast({ message: "Desktop notifications on — you'll be pinged about changes while this tab is in the background.", tone: "ok" });
    else if (notifyDesktop) toast({ message: "Desktop notifications off.", tone: "default" });
  }

  function exportCsv() {
    const header = ["time", "action", "type", "name", "fileId"];
    const rows = activity.map((a) => [a.time, a.action, a.isFolder ? "folder" : "file", a.name, a.fileId].map(csvCell).join(","));
    const csv = [header.join(","), ...rows].join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `kosh-drive-activity-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface lg:h-full">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary-soft text-primary"><Activity size={18} /></span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[14px] font-semibold">Activity</h2>
          <p className="text-[12px] text-muted">
            Live changes to your Drive, tracked while this tab is open{sync.lastAt ? ` · synced ${ago(new Date(sync.lastAt).toISOString())}` : ""}.
          </p>
        </div>
        <button
          onClick={() => void toggleNotify()}
          className={cn("grid h-8 w-8 place-items-center rounded-md hover:bg-surface-2", notifyDesktop ? "text-primary" : "text-muted hover:text-foreground")}
          aria-label={notifyDesktop ? "Turn off desktop notifications" : "Notify me of background changes"}
          aria-pressed={notifyDesktop}
          title={notifyDesktop ? "Desktop notifications on" : "Notify me when files change while this tab is in the background"}
        >{notifyDesktop ? <Bell size={16} /> : <BellOff size={16} />}</button>
        <Button variant="outline" size="sm" onClick={exportCsv} disabled={!activity.length}><Download size={14} /> Export CSV</Button>
        {activity.length > 0 && <Button variant="ghost" size="sm" onClick={clearActivity}>Clear</Button>}
        <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-foreground" aria-label="Close activity"><X size={16} /></button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {activity.length === 0 ? (
          <div className="grid min-h-[280px] place-items-center px-6 text-center">
            <div>
              <span className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-surface-2 text-muted"><Activity size={22} /></span>
              <div className="text-[13.5px] font-medium">No activity yet</div>
              <p className="mx-auto mt-1 max-w-xs text-[12.5px] text-muted">Edits, new files, and deletions — in Kosh or anywhere else in Drive — appear here in real time.</p>
            </div>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {activity.map((a, i) => {
              const meta = ACTION_META[a.action];
              const Icon = a.isFolder ? Folder : meta.icon;
              return (
                <li key={`${a.fileId}-${a.time}-${i}`} className="flex items-center gap-3 px-4 py-2.5">
                  <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-surface-2", meta.tone)}><Icon size={15} /></span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium">{a.name}</div>
                    <div className="text-[11.5px] text-muted"><span className={meta.tone}>{meta.label}</span> · {ago(a.time)}</div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
