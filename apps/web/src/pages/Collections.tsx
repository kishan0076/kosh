import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Copy, FolderOpen, FolderPlus, Globe, Share2 } from "lucide-react";
import type { Collection } from "@kosh/shared";
import { useData } from "@/data/store";
import { useUi } from "@/data/ui";
import { live } from "@/data/selectors";
import { cn } from "@/lib/cn";
import { EmptyState, PageHeader } from "@/components/common";
import { ItemGrid } from "@/components/ItemGrid";
import { Button, Input, Toggle } from "@/components/ui";
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
  const backend = useData((s) => s.backend);
  const collection = collections.find((c) => c.slug === slug);
  const [shareOpen, setShareOpen] = useState(false);

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
        actions={backend ? (
          <Button variant="outline" size="sm" onClick={() => setShareOpen(true)}>
            {collection.public ? <Globe size={15} className="text-ok" /> : <Share2 size={15} />} {collection.public ? "Shared" : "Share"}
          </Button>
        ) : undefined}
      />
      {shareOpen && <ShareCollectionModal open onClose={() => setShareOpen(false)} collection={collection} />}
      {list.length === 0 ? (
        <EmptyState icon={FolderOpen} title="Empty collection" description="Add items to this collection from any card's menu or the detail panel." />
      ) : (
        <ItemGrid key={collection.id} items={list} />
      )}
    </div>
  );
}

function ShareCollectionModal({ open, onClose, collection }: { open: boolean; onClose: () => void; collection: Collection }) {
  const setCollectionPublic = useData((s) => s.setCollectionPublic);
  const toast = useUi((s) => s.toast);
  const [busy, setBusy] = useState(false);
  const shareUrl = collection.publicSlug ? `${window.location.origin}/c/${collection.publicSlug}` : "";

  const toggle = async (next: boolean) => {
    setBusy(true);
    const updated = await setCollectionPublic(collection.id, next);
    setBusy(false);
    if (updated) toast({ message: next ? "Collection shared" : "Sharing stopped", tone: "ok" });
  };
  const copy = () => navigator.clipboard?.writeText(shareUrl).then(() => toast({ message: "Link copied", tone: "ok" })).catch(() => toast({ message: "Copy failed", tone: "danger" }));

  return (
    <Modal open={open} onClose={onClose} className="max-w-md" labelledBy="share-collection-title">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-5 py-4">
        <Share2 size={18} className="text-primary" />
        <h2 id="share-collection-title" className="min-w-0 flex-1 truncate text-base font-semibold">Share “{collection.name}”</h2>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
        <div className="flex items-center justify-between gap-3 rounded-[var(--radius-control)] border border-border bg-surface-2 px-3 py-2.5">
          <div className="min-w-0">
            <div className="text-[13.5px] font-medium">Public link</div>
            <div className="text-[12px] text-muted">Anyone with the link can view this collection read-only.</div>
          </div>
          <Toggle checked={!!collection.public} onChange={(next) => void toggle(next)} disabled={busy} label="Public link" />
        </div>
        {collection.public && collection.publicSlug && (
          <div>
            <div className="mb-1.5 flex items-center gap-1.5 text-[12px] font-medium text-muted"><Globe size={13} className="text-ok" /> Live link</div>
            <div className="flex items-center gap-2">
              <Input readOnly value={shareUrl} onFocus={(e) => e.currentTarget.select()} className="flex-1 font-mono text-[12px]" aria-label="Public link" />
              <Button variant="outline" size="sm" onClick={copy}><Copy size={14} /> Copy</Button>
            </div>
            <p className="mt-2 text-[11.5px] text-faint">Only titles, links and tags are shown — never your notes. Turning sharing off revokes the link.</p>
          </div>
        )}
      </div>
      <div className="flex shrink-0 justify-end border-t border-border px-5 py-3.5">
        <Button variant="primary" onClick={onClose}>Done</Button>
      </div>
    </Modal>
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
