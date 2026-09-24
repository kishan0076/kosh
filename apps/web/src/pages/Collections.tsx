import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, FolderOpen, FolderPlus } from "lucide-react";
import type { Collection } from "@kosh/shared";
import { useData } from "@/data/store";
import { useUi } from "@/data/ui";
import { live } from "@/data/selectors";
import { cn } from "@/lib/cn";
import { EmptyState, PageHeader } from "@/components/common";
import { ItemGrid } from "@/components/ItemGrid";
import { Button, Input } from "@/components/ui";
import { Modal } from "@/components/overlays";
import { useReveal } from "@/components/cards/ItemCard";

export function Collections() {
  const items = useData((s) => s.items);
  const collections = useData((s) => s.collections);
  const [newOpen, setNewOpen] = useState(false);
  const [params, setParams] = useSearchParams();

  // Support the ?new=1 deep link (e.g. from the Add page) to open the creator.
  useEffect(() => {
    if (params.get("new") === "1") {
      setNewOpen(true);
      const next = new URLSearchParams(params);
      next.delete("new");
      setParams(next, { replace: true });
    }
  }, [params, setParams]);

  const liveItems = live(items);

  return (
    <div>
      <PageHeader
        title="Collections"
        subtitle={`${collections.length} collections — group links, skills and prompts together`}
        icon={FolderOpen}
        actions={
          <Button variant="primary" onClick={() => setNewOpen(true)}>
            <FolderPlus size={16} /> New collection
          </Button>
        }
      />

      {collections.length === 0 ? (
        <EmptyState
          icon={FolderOpen}
          title="No collections yet"
          description="Group links, skills and prompts into a collection — add items from any card's menu."
          action={
            <Button variant="primary" onClick={() => setNewOpen(true)}>
              <FolderPlus size={16} /> New collection
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {collections.map((c, i) => (
            <CollectionCard key={c.id} c={c} index={i} count={liveItems.filter((it) => it.collections.includes(c.id)).length} />
          ))}
        </div>
      )}

      <NewCollectionModal open={newOpen} onClose={() => setNewOpen(false)} />
    </div>
  );
}

function CollectionCard({ c, index, count }: { c: Collection; index: number; count: number }) {
  const reveal = useReveal(index);
  return (
    <Link
      to={`/collections/${c.slug}`}
      onAnimationEnd={reveal.onAnimationEnd}
      style={reveal.style}
      className={cn("group flex items-center gap-4 rounded-[var(--radius-card)] border border-border bg-surface p-4 card-hover hover:border-border-strong", reveal.className)}
    >
      <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl" style={{ backgroundColor: `color-mix(in oklab, ${c.color} 16%, transparent)`, color: c.color }}>
        <FolderOpen size={22} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-semibold">{c.name}</div>
        <div className="text-[12.5px] text-muted">{count} item{count !== 1 ? "s" : ""}</div>
      </div>
    </Link>
  );
}

export function CollectionDetail() {
  const { slug } = useParams();
  const items = useData((s) => s.items);
  const collections = useData((s) => s.collections);
  const collection = collections.find((c) => c.slug === slug);

  if (!collection) {
    return (
      <EmptyState icon={FolderOpen} title="Collection not found" action={<Link to="/collections"><Button variant="outline">Back to collections</Button></Link>} />
    );
  }

  const list = live(items).filter((i) => i.collections.includes(collection.id)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return (
    <div>
      {/* The only way back on a phone: a real 40px target, not a text link. */}
      <Link
        to="/collections"
        className="-ml-2 mb-2 inline-flex min-h-10 items-center gap-1.5 rounded-[var(--radius-control)] px-2 text-[13px] text-muted hover:bg-surface-2 hover:text-foreground pressable"
      >
        <ArrowLeft size={15} /> All collections
      </Link>
      <PageHeader
        title={collection.name}
        subtitle={`${list.length} items`}
        icon={FolderOpen}
      />
      {list.length === 0 ? (
        <EmptyState icon={FolderOpen} title="Empty collection" description="Add items to this collection from any card's menu or the detail panel." />
      ) : (
        <ItemGrid key={collection.id} items={list} />
      )}
    </div>
  );
}

function NewCollectionModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const createCollection = useData((s) => s.createCollection);
  const toast = useUi((s) => s.toast);
  const [name, setName] = useState("");

  // Optimistic: the store adds the collection at once and syncs behind it, so no loading state.
  const save = () => {
    if (!name.trim()) return;
    createCollection(name.trim());
    toast({ message: "Collection created", description: name, tone: "ok" });
    setName("");
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} className="max-w-sm" labelledBy="new-collection-title">
      <div className="shrink-0 border-b border-border px-5 py-4">
        <h2 id="new-collection-title" className="text-base font-semibold">New collection</h2>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && save()}
          autoFocus
          placeholder="Collection name"
          aria-label="Collection name"
          className="sm:text-[14px]"
        />
      </div>
      <div className="flex shrink-0 justify-end gap-2 border-t border-border px-5 py-3.5">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" onClick={save} disabled={!name.trim()}>
          Create
        </Button>
      </div>
    </Modal>
  );
}
