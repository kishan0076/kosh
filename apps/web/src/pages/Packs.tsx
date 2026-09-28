import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowUpRight,
  ChevronDown,
  ChevronUp,
  Copy,
  FileText,
  History,
  Package,
  Pin,
  Plus,
  Search as SearchIcon,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import type { ContextPack, Item } from "@kosh/shared";
import { searchItems } from "@kosh/shared";
import { api, type PackListEntry, type PackVersion, type ResolvedPackContext } from "@/data/api";
import { useData } from "@/data/store";
import { useUi } from "@/data/ui";
import { live } from "@/data/selectors";
import { cn } from "@/lib/cn";
import { ago } from "@/lib/time";
import { GitHubMark, itemIcon } from "@/lib/icons";
import { EmptyState, PageHeader } from "@/components/common";
import { Button, Input, Textarea, Spinner } from "@/components/ui";
import { Modal } from "@/components/overlays";
import { Markdown } from "@/components/markdown";

const KIND_LABEL: Record<string, string> = { link: "Link", skill: "Skill", prompt: "Prompt", file: "File" };
const kindLabel = (item: Item): string =>
  item.kind === "link" && item.linkType ? cap(item.linkType) : KIND_LABEL[item.kind] ?? "Item";
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/* ── List page (/packs) ─────────────────────────────────────── */
export function Packs() {
  const backend = useData((s) => s.backend);
  const toast = useUi((s) => s.toast);
  const navigate = useNavigate();
  const [packs, setPacks] = useState<PackListEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await api.listPacks();
      setPacks(r.packs);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load your packs.");
      setPacks([]);
    }
  }, []);

  useEffect(() => {
    if (backend) void load();
    else setPacks([]);
  }, [backend, load]);

  return (
    <div>
      <PageHeader
        title="Context Packs"
        subtitle="Bundle saved items + instructions into a named pack an AI agent loads in one shot over MCP."
        icon={Package}
        actions={
          backend && (
            <Button variant="primary" onClick={() => setNewOpen(true)}>
              <Plus size={16} /> New pack
            </Button>
          )
        }
      />

      {!backend ? (
        <EmptyState icon={Package} title="Context Packs need the API backend" description="Connect the Kosh API to create packs your agents can load. Everything else here still works offline." />
      ) : error ? (
        <EmptyState icon={Package} title="Couldn't load packs" description={error} action={<Button variant="primary" onClick={() => void load()}>Try again</Button>} />
      ) : packs === null ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-32 rounded-[var(--radius-card)] border border-border bg-surface shimmer" />)}
        </div>
      ) : packs.length === 0 ? (
        <EmptyState
          icon={Package}
          title="No context packs yet"
          description="Create a pack, drop in the links, repos, skills and prompts an agent needs, and load it all with one MCP call."
          action={<Button variant="primary" onClick={() => setNewOpen(true)}><Plus size={16} /> New pack</Button>}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {packs.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => navigate(`/packs/${p.id}`)}
              className="pressable group flex flex-col rounded-[var(--radius-card)] border border-border bg-surface p-4 text-left card-hover"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary"><Package size={17} /></span>
                <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-muted tabular">v{p.version}</span>
              </div>
              <h3 className="mt-3 line-clamp-1 break-words text-[15px] font-semibold">{p.name}</h3>
              {p.description && <p className="mt-0.5 line-clamp-2 text-[13px] text-muted">{p.description}</p>}
              <div className="mt-3 flex items-center gap-2 border-t border-border pt-3 text-[11.5px] text-faint">
                <span>{p.itemCount} item{p.itemCount === 1 ? "" : "s"}</span>
                <span className="ml-auto">{ago(p.updatedAt)}</span>
              </div>
            </button>
          ))}
        </div>
      )}

      <NewPackModal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        onCreated={(pack) => { setNewOpen(false); toast({ message: "Pack created", description: pack.name, tone: "ok" }); navigate(`/packs/${pack.id}`); }}
      />
    </div>
  );
}

function NewPackModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (p: ContextPack) => void }) {
  const toast = useUi((s) => s.toast);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [busy, setBusy] = useState(false);

  const reset = () => { setName(""); setDescription(""); setInstructions(""); };
  // Clear any abandoned draft when the modal is dismissed, so it doesn't persist into the next open.
  const close = () => { reset(); onClose(); };
  const save = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const { pack } = await api.createPack({ name: name.trim(), description: description.trim() || undefined, instructions: instructions.trim() || undefined });
      reset();
      onCreated(pack);
    } catch (err) {
      toast({ message: "Couldn't create pack", description: err instanceof Error ? err.message : undefined, tone: "danger" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={close} className="max-w-lg" labelledBy="new-pack-title">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-5 py-4">
        <Package size={18} className="text-primary" />
        <h2 id="new-pack-title" className="text-base font-semibold">New context pack</h2>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name — e.g. “Onboarding for the payments agent”" aria-label="Pack name" className="sm:text-[14px]" />
        <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Short description (optional)" aria-label="Description" />
        <div>
          <span className="mb-1.5 block text-[12px] font-medium text-muted">Instructions — the preamble the agent reads first (optional)</span>
          <Textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="Goals, how to use these items, house rules…" rows={5} className="resize-y" />
        </div>
      </div>
      <div className="flex shrink-0 justify-end gap-2 border-t border-border px-5 py-3.5">
        <Button variant="ghost" onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={() => void save()} disabled={!name.trim()} loading={busy}>Create pack</Button>
      </div>
    </Modal>
  );
}

/* ── Detail page (/packs/:id) ───────────────────────────────── */
export function PackDetail() {
  const { id = "" } = useParams();
  const backend = useData((s) => s.backend);
  const toast = useUi((s) => s.toast);
  const navigate = useNavigate();

  const [pack, setPack] = useState<ContextPack | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [versions, setVersions] = useState<PackVersion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [preview, setPreview] = useState<{ version?: number } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.getPack(id);
      setPack(r.pack);
      setItems(r.items);
      setVersions(r.versions);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load this pack.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (backend) void load();
    else setLoading(false);
  }, [backend, load]);

  // Reflect a freshly-saved version in the local history (a content change always cuts a new version).
  const recordVersion = (fresh: ContextPack) =>
    setVersions((prev) =>
      prev[0]?.version === fresh.version
        ? prev.map((v, i) => (i === 0 ? { ...v, itemCount: fresh.itemIds.length } : v))
        : [{ version: fresh.version, itemCount: fresh.itemIds.length, createdAt: new Date().toISOString(), current: true }, ...prev.map((v) => ({ ...v, current: false }))],
    );

  // Persist a field change (name/description/instructions/itemIds) and adopt the server's fresh version.
  const applyPatch = async (patch: { name?: string; description?: string | null; instructions?: string | null; itemIds?: string[] }) => {
    if (!pack) return;
    try {
      const { pack: next } = await api.updatePack(pack.id, patch);
      setPack(next);
      recordVersion(next);
      return next;
    } catch (err) {
      toast({ message: "Couldn't save", description: err instanceof Error ? err.message : undefined, tone: "danger" });
      void load(); // resync to the server's truth
    }
  };

  const move = async (index: number, dir: -1 | 1) => {
    if (!pack) return;
    const j = index + dir;
    if (j < 0 || j >= items.length) return;
    // Reorder by the VISIBLE items — indexing pack.itemIds directly would mis-swap when it holds ids that
    // no longer resolve. The server prunes any such dead refs on save (they'd be skipped at load anyway).
    const nextItems = [...items];
    [nextItems[index], nextItems[j]] = [nextItems[j]!, nextItems[index]!];
    setItems(nextItems);
    await applyPatch({ itemIds: nextItems.map((it) => it.id) });
  };

  const removeItem = async (itemId: string) => {
    if (!pack) return;
    setItems((prev) => prev.filter((it) => it.id !== itemId));
    try {
      const { pack: next } = await api.removePackItem(pack.id, itemId);
      setPack(next);
      recordVersion(next);
    } catch (err) {
      toast({ message: "Couldn't remove item", description: err instanceof Error ? err.message : undefined, tone: "danger" });
      void load();
    }
  };

  const onAdded = (next: ContextPack, added: Item[]) => {
    setPack(next);
    setItems((prev) => [...prev, ...added.filter((a) => !prev.some((p) => p.id === a.id))]);
    recordVersion(next);
  };

  const del = async () => {
    if (!pack) return;
    try {
      await api.deletePack(pack.id);
      toast({ message: "Pack deleted", tone: "ok" });
      navigate("/packs");
    } catch (err) {
      toast({ message: "Couldn't delete pack", description: err instanceof Error ? err.message : undefined, tone: "danger" });
    }
  };

  if (!backend) {
    return (
      <div>
        <BackLink />
        <EmptyState icon={Package} title="Context Packs need the API backend" description="Connect the Kosh API to manage packs." />
      </div>
    );
  }
  if (loading) {
    return <div className="grid min-h-[40vh] place-items-center text-muted"><Spinner size={22} /></div>;
  }
  if (error || !pack) {
    return (
      <div>
        <BackLink />
        <EmptyState icon={Package} title="Pack not found" description={error ?? "This pack may have been deleted."} action={<Link to="/packs"><Button variant="primary">All packs</Button></Link>} />
      </div>
    );
  }

  return (
    <div>
      <BackLink />
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary"><Package size={20} /></span>
          <div className="min-w-0">
            {/* Inline-editable name (commits on blur / Enter). */}
            <input
              defaultValue={pack.name}
              key={pack.name}
              onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== pack.name) void applyPatch({ name: v }); else e.target.value = pack.name; }}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { (e.target as HTMLInputElement).value = pack.name; (e.target as HTMLInputElement).blur(); } }}
              aria-label="Pack name"
              className="w-full rounded-md bg-transparent font-display text-2xl font-semibold leading-tight outline-none hover:bg-surface-2 focus:bg-surface-2 focus:ring-focus"
            />
            <div className="mt-0.5 flex items-center gap-2 text-sm text-muted">
              <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium tabular">v{pack.version}</span>
              <span>{items.length} item{items.length === 1 ? "" : "s"}</span>
              <span>· updated {ago(pack.updatedAt)}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setPreview({})}><FileText size={15} /> Preview context</Button>
          <Button variant="primary" size="sm" onClick={() => setAddOpen(true)}><Plus size={15} /> Add items</Button>
        </div>
      </div>

      {/* description */}
      <Input
        key={`desc-${pack.id}-${pack.updatedAt}`}
        defaultValue={pack.description ?? ""}
        onBlur={(e) => { const v = e.target.value.trim(); if (v !== (pack.description ?? "")) void applyPatch({ description: v || null }); }}
        placeholder="Add a short description…"
        aria-label="Description"
        className="mb-4"
      />

      {/* instructions */}
      <div className="mb-5 rounded-[var(--radius-card)] border border-border bg-surface p-4">
        <div className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold text-primary"><Sparkles size={13} /> Instructions</div>
        <p className="mb-2 text-[12px] text-muted">The preamble the agent reads before the items — goals, how to use them, house rules.</p>
        <Textarea
          key={`instr-${pack.id}-${pack.updatedAt}`}
          defaultValue={pack.instructions ?? ""}
          onBlur={(e) => { const v = e.target.value; if (v !== (pack.instructions ?? "")) void applyPatch({ instructions: v.trim() || null }); }}
          placeholder="e.g. You are helping with the payments migration. Prefer the linked runbook over your own knowledge…"
          rows={4}
          className="resize-y"
        />
      </div>

      {/* items */}
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-[13px] font-semibold text-muted">Items <span className="text-faint">· in load order</span></h2>
      </div>
      {items.length === 0 ? (
        <EmptyState icon={Package} size="sm" title="No items yet" description="Add links, repos, skills or prompts to this pack." action={<Button variant="primary" size="sm" onClick={() => setAddOpen(true)}><Plus size={15} /> Add items</Button>} />
      ) : (
        <ol className="space-y-1.5">
          {items.map((item, i) => (
            <PackItemRow
              key={item.id}
              item={item}
              index={i}
              count={items.length}
              onMove={(dir) => void move(i, dir)}
              onRemove={() => void removeItem(item.id)}
            />
          ))}
        </ol>
      )}

      {/* version history — pin any retained version */}
      <div className="mt-6">
        <div className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-muted">
          <History size={15} /> Version history
        </div>
        <div className="overflow-hidden rounded-[var(--radius-card)] border border-border">
          {versions.map((v, i) => (
            <div key={v.version} className={cn("flex items-center gap-3 bg-surface px-3 py-2.5", i > 0 && "border-t border-border")}>
              <span className="w-12 shrink-0 text-[13px] font-semibold tabular">v{v.version}</span>
              {v.current ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-primary-soft px-2 py-0.5 text-[11px] font-medium text-primary"><Pin size={11} /> current</span>
              ) : (
                <span className="text-[11px] text-faint">pinnable</span>
              )}
              <span className="ml-auto shrink-0 text-[12px] text-muted">{v.itemCount} item{v.itemCount === 1 ? "" : "s"}</span>
              <span className="hidden shrink-0 text-[11.5px] text-faint sm:inline">{ago(v.createdAt)}</span>
              <Button variant="ghost" size="icon-sm" aria-label={`Preview v${v.version}`} onClick={() => setPreview({ version: v.version })}><FileText size={15} /></Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Copy load call for v${v.version}`}
                onClick={() => {
                  navigator.clipboard?.writeText(`load_context_pack({ name: ${JSON.stringify(pack.name)}, version: ${v.version} })`)
                    .then(() => toast({ message: `Copied load call for v${v.version}`, tone: "ok" }))
                    .catch(() => toast({ message: "Copy failed", tone: "danger" }));
                }}
              >
                <Copy size={15} />
              </Button>
            </div>
          ))}
        </div>
        <p className="mt-1.5 text-[11.5px] text-faint">The 30 most recent versions are retained; item contents are always read live.</p>
      </div>

      {/* MCP usage hint */}
      <div className="mt-6 rounded-[var(--radius-card)] border border-border bg-surface-2 p-4">
        <div className="mb-1.5 text-[12px] font-semibold text-muted">Load this pack from an agent</div>
        <p className="mb-2 text-[12px] text-muted">Over the Kosh MCP server, call <code className="rounded bg-surface px-1 py-0.5 font-mono text-[11.5px]">load_context_pack</code> — add <code className="rounded bg-surface px-1 py-0.5 font-mono text-[11.5px]">version</code> to pin a specific version:</p>
        <code className="block overflow-x-auto whitespace-pre rounded-[var(--radius-control)] border border-border bg-surface px-3 py-2 font-mono text-[12px]">{`load_context_pack({ name: ${JSON.stringify(pack.name)} })            // latest\nload_context_pack({ name: ${JSON.stringify(pack.name)}, version: ${pack.version} })   // pinned`}</code>
        <p className="mt-2 text-[11.5px] text-faint">Agents can also curate packs themselves — <code className="rounded bg-surface px-1 py-0.5 font-mono text-[11px]">create_context_pack</code>, <code className="rounded bg-surface px-1 py-0.5 font-mono text-[11px]">add_to_pack</code> (by url or item), <code className="rounded bg-surface px-1 py-0.5 font-mono text-[11px]">remove_from_pack</code>, <code className="rounded bg-surface px-1 py-0.5 font-mono text-[11px]">update_context_pack</code>.</p>
      </div>

      {/* danger zone */}
      <div className="mt-6 border-t border-border pt-4">
        {confirmDelete ? (
          <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-control)] border border-danger/30 bg-danger-soft/40 px-3 py-2 text-[13px]">
            <span className="text-danger">Delete “{pack.name}”? The saved items themselves are not affected.</span>
            <div className="ml-auto flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>Cancel</Button>
              <Button variant="danger" size="sm" onClick={() => void del()}>Delete pack</Button>
            </div>
          </div>
        ) : (
          <Button variant="ghost" size="sm" className="text-danger hover:bg-danger-soft" onClick={() => setConfirmDelete(true)}><Trash2 size={15} /> Delete pack</Button>
        )}
      </div>

      {addOpen && <AddItemsModal open={addOpen} onClose={() => setAddOpen(false)} pack={pack} onAdded={onAdded} />}
      {preview && <PreviewModal open onClose={() => setPreview(null)} packId={pack.id} packName={pack.name} version={preview.version} latestVersion={pack.version} />}
    </div>
  );
}

function BackLink() {
  return (
    <Link to="/packs" className="mb-3 inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-foreground">
      <ArrowLeft size={15} /> All packs
    </Link>
  );
}

function PackItemRow({ item, index, count, onMove, onRemove }: { item: Item; index: number; count: number; onMove: (dir: -1 | 1) => void; onRemove: () => void }) {
  const Icon = itemIcon(item);
  return (
    <li className="group flex items-center gap-3 rounded-[var(--radius-control)] border border-border bg-surface px-3 py-2.5">
      <span className="w-5 shrink-0 text-center text-[12px] tabular text-faint">{index + 1}</span>
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted">
        {item.linkType === "repo" ? <GitHubMark size={14} /> : <Icon size={15} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block min-w-0 truncate text-[13.5px] font-medium">{item.title || item.url || "Untitled"}</span>
        <span className="mt-0.5 flex items-center gap-2 text-[11px] text-faint">
          <span className="rounded bg-surface-2 px-1.5 py-0.5 font-medium text-muted">{kindLabel(item)}</span>
          {item.url && <span className="min-w-0 truncate [overflow-wrap:anywhere]">{item.url}</span>}
        </span>
      </span>
      {item.url && (
        <a href={item.url} target="_blank" rel="noreferrer noopener" className="hidden sm:block">
          <Button variant="ghost" size="icon-sm" aria-label="Open original"><ArrowUpRight size={15} /></Button>
        </a>
      )}
      <div className="flex shrink-0 flex-col">
        <button onClick={onMove.bind(null, -1)} disabled={index === 0} aria-label="Move up" className="grid h-5 w-6 place-items-center rounded text-faint hover:bg-surface-2 hover:text-foreground disabled:opacity-30 disabled:pointer-events-none"><ChevronUp size={14} /></button>
        <button onClick={onMove.bind(null, 1)} disabled={index === count - 1} aria-label="Move down" className="grid h-5 w-6 place-items-center rounded text-faint hover:bg-surface-2 hover:text-foreground disabled:opacity-30 disabled:pointer-events-none"><ChevronDown size={14} /></button>
      </div>
      <Button variant="ghost" size="icon-sm" onClick={onRemove} aria-label="Remove from pack" className="text-faint hover:bg-danger-soft hover:text-danger"><X size={16} /></Button>
    </li>
  );
}

function AddItemsModal({ open, onClose, pack, onAdded }: { open: boolean; onClose: () => void; pack: ContextPack; onAdded: (p: ContextPack, added: Item[]) => void }) {
  const allItems = useData((s) => s.items);
  const toast = useUi((s) => s.toast);
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const [inPack, setInPack] = useState<Set<string>>(new Set(pack.itemIds));
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => { setInPack(new Set(pack.itemIds)); }, [pack.itemIds]);
  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 50); }, [open]);

  const candidates = useMemo(() => {
    const pool = live(allItems);
    const base = q.trim() ? searchItems(pool, q.trim(), { limit: 50 }).map((h) => h.item) : [...pool].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 50);
    return base;
  }, [allItems, q]);

  const add = async (item: Item) => {
    if (inPack.has(item.id) || busyId) return;
    setBusyId(item.id);
    // Optimistic: mark added; roll back on failure.
    setInPack((prev) => new Set(prev).add(item.id));
    try {
      const { pack: next } = await api.addPackItem(pack.id, item.id);
      onAdded(next, [item]);
    } catch (err) {
      setInPack((prev) => { const s = new Set(prev); s.delete(item.id); return s; });
      toast({ message: "Couldn't add item", description: err instanceof Error ? err.message : undefined, tone: "danger" });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Modal open={open} onClose={onClose} className="max-w-lg" labelledBy="add-items-title">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-5 py-4">
        <Plus size={18} className="text-primary" />
        <h2 id="add-items-title" className="text-base font-semibold">Add items to “{pack.name}”</h2>
      </div>
      <div className="shrink-0 border-b border-border p-3">
        <div className="relative">
          <SearchIcon size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <Input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your vault…" aria-label="Search vault" className="pl-9" />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {candidates.length === 0 ? (
          <div className="px-2 py-8 text-center text-[13px] text-muted">{q.trim() ? "No matches." : "Nothing saved yet."}</div>
        ) : (
          <div className="space-y-1">
            {candidates.map((item) => {
              const added = inPack.has(item.id);
              const Icon = itemIcon(item);
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => void add(item)}
                  disabled={added}
                  className="flex w-full items-center gap-3 rounded-[var(--radius-control)] border border-transparent px-2.5 py-2 text-left transition-colors hover:border-border hover:bg-surface-2 disabled:opacity-60 disabled:pointer-events-none"
                >
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted">
                    {item.linkType === "repo" ? <GitHubMark size={14} /> : <Icon size={15} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block min-w-0 truncate text-[13.5px] font-medium">{item.title || item.url || "Untitled"}</span>
                    <span className="block min-w-0 truncate text-[11.5px] text-faint">{kindLabel(item)}{item.url ? ` · ${item.url}` : ""}</span>
                  </span>
                  <span className="shrink-0 text-[12px] font-medium text-muted">
                    {busyId === item.id ? <Spinner size={14} /> : added ? "Added" : <span className="text-primary">+ Add</span>}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
      <div className="flex shrink-0 justify-end border-t border-border px-5 py-3.5">
        <Button variant="primary" onClick={onClose}>Done</Button>
      </div>
    </Modal>
  );
}

function PreviewModal({ open, onClose, packId, packName, version, latestVersion }: { open: boolean; onClose: () => void; packId: string; packName: string; version?: number; latestVersion: number }) {
  const toast = useUi((s) => s.toast);
  const [ctx, setCtx] = useState<ResolvedPackContext | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setCtx(null);
    setError(null);
    api.getPackContext(packId, version)
      .then((r) => { if (alive) setCtx(r); })
      .catch((err) => { if (alive) setError(err instanceof Error ? err.message : "Couldn't assemble the context."); });
    return () => { alive = false; };
  }, [packId, version]);

  const copy = () => {
    if (!ctx) return;
    navigator.clipboard?.writeText(ctx.markdown).then(() => toast({ message: "Context copied", tone: "ok" })).catch(() => toast({ message: "Copy failed", tone: "danger" }));
  };

  const pinnedLabel = version != null && version !== latestVersion ? ` · v${version} (pinned)` : "";

  return (
    <Modal open={open} onClose={onClose} className="max-w-2xl" labelledBy="preview-title">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-5 py-4">
        <FileText size={18} className="text-primary" />
        <h2 id="preview-title" className="min-w-0 flex-1 truncate text-base font-semibold">Assembled context · {packName}{pinnedLabel}</h2>
        <Button variant="outline" size="sm" onClick={copy} disabled={!ctx}><Copy size={14} /> Copy</Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        {error ? (
          <div className="py-8 text-center text-[13px] text-danger">{error}</div>
        ) : !ctx ? (
          <div className="grid place-items-center py-12 text-muted"><Spinner size={20} /></div>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap gap-2 text-[11.5px] text-muted">
              <span className={cn("rounded px-2 py-0.5", ctx.pinned ? "bg-primary-soft text-primary" : "bg-surface-2")}>v{ctx.version}{ctx.pinned ? ` · pinned (latest v${ctx.latestVersion})` : ""}</span>
              <span className="rounded bg-surface-2 px-2 py-0.5">{ctx.includedCount} item{ctx.includedCount === 1 ? "" : "s"} included</span>
              {ctx.skippedCount > 0 && <span className="rounded bg-warn-soft px-2 py-0.5 text-warn">{ctx.skippedCount} missing skipped</span>}
              {ctx.truncated && <span className="rounded bg-warn-soft px-2 py-0.5 text-warn">truncated to fit</span>}
              <span className="rounded bg-surface-2 px-2 py-0.5">{Math.round(ctx.bytes / 1024)} KB</span>
            </div>
            <div className="rounded-[var(--radius-control)] border border-border bg-surface-2 p-4">
              <Markdown className="text-[13px]">{ctx.markdown}</Markdown>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
