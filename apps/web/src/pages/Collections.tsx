import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, FolderOpen, FolderPlus } from "lucide-react";
import { useData } from "@/data/store";
import { useUi } from "@/data/ui";
import { live } from "@/data/selectors";
import { EmptyState, PageHeader } from "@/components/common";
import { ItemGrid } from "@/components/ItemGrid";
import { Button } from "@/components/ui";
import { Modal } from "@/components/overlays";

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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {collections.map((c) => {
          const count = live(items).filter((i) => i.collections.includes(c.id)).length;
          return (
            <Link
              key={c.id}
              to={`/collections/${c.slug}`}
              className="group flex items-center gap-4 rounded-[var(--radius-card)] border border-border bg-surface p-4 card-hover hover:border-border-strong"
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
        })}
      </div>

      <NewCollectionModal open={newOpen} onClose={() => setNewOpen(false)} />
    </div>
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
      <Link to="/collections" className="mb-3 inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-foreground">
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
        <ItemGrid items={list} />
      )}
    </div>
  );
}

function NewCollectionModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const createCollection = useData((s) => s.createCollection);
  const toast = useUi((s) => s.toast);
  const [name, setName] = useState("");

  const save = () => {
    if (!name.trim()) return;
    createCollection(name.trim());
    toast({ message: "Collection created", description: name, tone: "ok" });
    setName("");
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} className="max-w-sm">
      <div className="border-b border-border px-5 py-4">
        <h2 className="text-base font-semibold">New collection</h2>
      </div>
      <div className="p-5">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && save()}
          autoFocus
          placeholder="Collection name"
          className="w-full rounded-[var(--radius-control)] border border-border bg-surface px-3 py-2 text-[14px] outline-none focus:border-primary focus:ring-focus"
        />
      </div>
      <div className="flex justify-end gap-2 border-t border-border px-5 py-3.5">
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
