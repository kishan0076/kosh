import { RotateCcw, Trash2 } from "lucide-react";
import type { Item } from "@kosh/shared";
import { useData } from "@/data/store";
import { useUi } from "@/data/ui";
import { trashed } from "@/data/selectors";
import { cn } from "@/lib/cn";
import { ago } from "@/lib/time";
import { itemIcon, GitHubMark } from "@/lib/icons";
import { EmptyState, PageHeader } from "@/components/common";
import { Button } from "@/components/ui";
import { useReveal } from "@/components/cards/ItemCard";

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
          {list.map((i, idx) => (
            <TrashRow
              key={i.id}
              item={i}
              index={idx}
              // Both are optimistic in the store (row leaves at once, sync follows) — a toast, no spinner.
              onRestore={() => { restore(i.id); toast({ message: "Restored", description: i.title, tone: "ok" }); }}
              onPurge={() =>
                openConfirm({
                  title: "Delete forever?",
                  message: `"${i.title}" will be permanently deleted. This can't be undone.`,
                  confirmLabel: "Delete forever",
                  onConfirm: () => { purge(i.id); toast({ message: "Purged permanently", tone: "warn" }); },
                })
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TrashRow({ item, index, onRestore, onPurge }: { item: Item; index: number; onRestore: () => void; onPurge: () => void }) {
  const Icon = itemIcon(item);
  const reveal = useReveal(index);
  return (
    // Narrow phones: the text keeps a readable column and the actions drop to their own line, right-aligned.
    <div
      onAnimationEnd={reveal.onAnimationEnd}
      style={reveal.style}
      className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-3 last:border-0", reveal.className)}
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted">
        {item.linkType === "repo" ? <GitHubMark size={16} /> : <Icon size={16} />}
      </span>
      <div className="min-w-0 flex-1 basis-24">
        <div className="truncate text-[13.5px] font-medium">{item.title}</div>
        <div className="truncate text-[11.5px] text-faint">deleted {ago(item.deletedAt)}</div>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <Button variant="ghost" size="sm" onClick={onRestore}>
          <RotateCcw size={14} /> Restore
        </Button>
        <Button variant="ghost" size="icon-sm" className="text-danger hover:bg-danger-soft" onClick={onPurge} aria-label="Delete forever">
          <Trash2 size={15} />
        </Button>
      </div>
    </div>
  );
}
