import { RotateCcw, Trash2 } from "lucide-react";
import { useData } from "@/data/store";
import { useUi } from "@/data/ui";
import { trashed } from "@/data/selectors";
import { ago } from "@/lib/time";
import { itemIcon, GitHubMark } from "@/lib/icons";
import { EmptyState, PageHeader } from "@/components/common";
import { Button } from "@/components/ui";

export function Trash() {
  const items = useData((s) => s.items);
  const restore = useData((s) => s.restore);
  const purge = useData((s) => s.purge);
  const emptyTrash = useData((s) => s.emptyTrash);
  const toast = useUi((s) => s.toast);
  const openConfirm = useUi((s) => s.openConfirm);

  const list = trashed(items).sort((a, b) => (b.deletedAt ?? "").localeCompare(a.deletedAt ?? ""));

  return (
    <div>
      <PageHeader
        title="Trash"
        subtitle={`${list.length} items · auto-purged after 30 days`}
        icon={Trash2}
        actions={
          list.length > 0 ? (
            <Button
              variant="outline"
              onClick={() =>
                openConfirm({
                  title: "Empty trash?",
                  message: `This permanently deletes ${list.length} item${list.length === 1 ? "" : "s"}. This can't be undone.`,
                  confirmLabel: "Empty trash",
                  onConfirm: () => { emptyTrash(); toast({ message: "Trash emptied", tone: "ok" }); },
                })
              }
            >
              Empty trash
            </Button>
          ) : undefined
        }
      />

      {list.length === 0 ? (
        <EmptyState icon={Trash2} title="Trash is empty" description="Deleted items land here for 30 days before they're purged. Content-addressed storage keeps versions cheap." />
      ) : (
        <div className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
          {list.map((i) => {
            const Icon = itemIcon(i);
            return (
              <div key={i.id} className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-0">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted">
                  {i.linkType === "repo" ? <GitHubMark size={16} /> : <Icon size={16} />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] font-medium">{i.title}</div>
                  <div className="text-[11.5px] text-faint">deleted {ago(i.deletedAt)}</div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => { restore(i.id); toast({ message: "Restored", description: i.title, tone: "ok" }); }}>
                  <RotateCcw size={14} /> Restore
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-danger hover:bg-danger-soft"
                  onClick={() =>
                    openConfirm({
                      title: "Delete forever?",
                      message: `"${i.title}" will be permanently deleted. This can't be undone.`,
                      confirmLabel: "Delete forever",
                      onConfirm: () => { purge(i.id); toast({ message: "Purged permanently", tone: "warn" }); },
                    })
                  }
                  aria-label="Delete forever"
                >
                  <Trash2 size={15} />
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
