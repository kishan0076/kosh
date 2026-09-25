import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Copy, Plus, Quote } from "lucide-react";
import { extractVariables, type Item, type Stage } from "@kosh/shared";
import { useData } from "@/data/store";
import { useUi } from "@/data/ui";
import { live } from "@/data/selectors";
import { cn } from "@/lib/cn";
import { ago } from "@/lib/time";
import { useSetStage } from "@/lib/useSetStage";
import { EmptyState, PageHeader, StageChip } from "@/components/common";
import { Button, Input, Textarea } from "@/components/ui";
import { Modal } from "@/components/overlays";
import { PromptFill } from "@/components/detail/PromptFill";
import { useReveal } from "@/components/cards/ItemCard";

export function Prompts() {
  const items = useData((s) => s.items);
  const setStage = useSetStage();
  const openItem = useUi((s) => s.openItem);
  const [params, setParams] = useSearchParams();
  const [newOpen, setNewOpen] = useState(params.get("new") === "1");
  const [fill, setFill] = useState<Item | null>(null);

  const prompts = useMemo(
    () => live(items).filter((i) => i.kind === "prompt").sort((a, b) => (b.prompt?.usedCount ?? 0) - (a.prompt?.usedCount ?? 0)),
    [items],
  );

  return (
    <div>
      <PageHeader
        title="Prompts"
        subtitle={`${prompts.length} reusable prompts with fill-and-copy`}
        icon={Quote}
        actions={
          <Button variant="primary" onClick={() => setNewOpen(true)}>
            <Plus size={16} /> New prompt
          </Button>
        }
      />

      {prompts.length === 0 ? (
        <EmptyState
          icon={Quote}
          title="No prompts yet"
          description="Save a reusable prompt with {{variables}} and fill it in one click when you need it."
          action={
            <Button variant="primary" onClick={() => setNewOpen(true)}>
              <Plus size={16} /> New prompt
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {prompts.map((p, i) => (
            <PromptCard key={p.id} p={p} index={i} onOpen={() => openItem(p.id)} onFill={() => setFill(p)} onStage={(s) => setStage(p.id, s)} />
          ))}
        </div>
      )}

      {fill && <PromptFill item={fill} open={!!fill} onClose={() => setFill(null)} />}
      <NewPromptModal open={newOpen} onClose={() => { setNewOpen(false); const n = new URLSearchParams(params); n.delete("new"); setParams(n, { replace: true }); }} />
    </div>
  );
}

function PromptCard({ p, index, onOpen, onFill, onStage }: { p: Item; index: number; onOpen: () => void; onFill: () => void; onStage: (s: Stage) => void }) {
  const reveal = useReveal(index);
  return (
    <article
      onAnimationEnd={reveal.onAnimationEnd}
      style={reveal.style}
      className={cn("flex flex-col rounded-[var(--radius-card)] border border-border bg-surface p-4 card-hover", reveal.className)}
    >
      <div className="flex items-start justify-between gap-2">
        <button type="button" onClick={onOpen} className="min-w-0 rounded-md text-left pressable">
          <h3 className="line-clamp-2 break-words text-[15px] font-semibold leading-snug">{p.title}</h3>
          <p className="mt-0.5 line-clamp-1 text-[13px] text-muted">{p.description}</p>
        </button>
        <StageChip stage={p.stage} onChange={onStage} size="sm" />
      </div>
      {/* Clamp the text, not the padded box, so no 4th line peeks into the padding; long tokens wrap. */}
      <div className="mt-3 rounded-[var(--radius-control)] border border-border bg-surface-2 px-3 py-2 font-mono text-[12px] leading-snug text-muted">
        <span className="line-clamp-3 break-words [overflow-wrap:anywhere]">{p.prompt?.body}</span>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {(p.prompt?.variables ?? []).map((v) => (
          <span key={v.name} className="rounded bg-primary-soft px-1.5 py-0.5 font-mono text-[11px] text-primary">
            {`{{${v.name}}}`}
          </span>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3">
        <span className="min-w-0 truncate text-[11.5px] text-faint">used {p.prompt?.usedCount ?? 0}× · {ago(p.updatedAt)}</span>
        <Button variant="secondary" size="sm" className="shrink-0" onClick={onFill}>
          <Copy size={14} /> Fill & copy
        </Button>
      </div>
    </article>
  );
}

function NewPromptModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const createPrompt = useData((s) => s.createPrompt);
  const openItem = useUi((s) => s.openItem);
  const toast = useUi((s) => s.toast);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const vars = extractVariables(body);

  // Optimistic: the store returns the item at once and syncs behind it, so no loading state.
  const save = () => {
    if (!title.trim() || !body.trim()) return;
    const item = createPrompt({ title: title.trim(), body: body.trim() });
    toast({ message: "Prompt saved", description: title, tone: "ok" });
    onClose();
    setTitle("");
    setBody("");
    openItem(item.id);
  };

  return (
    <Modal open={open} onClose={onClose} className="max-w-xl" labelledBy="new-prompt-title">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-5 py-4">
        <Quote size={18} className="text-primary" />
        <h2 id="new-prompt-title" className="text-base font-semibold">New prompt</h2>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" aria-label="Title" className="sm:text-[14px]" />
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Prompt body — use {{variables}} for fill-in fields"
          aria-label="Prompt body"
          rows={7}
          className="resize-y bg-surface-2 p-3 font-mono sm:text-[12.5px]"
        />
        {vars.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-muted">
            Variables:
            {vars.map((v) => (
              <span key={v} className="rounded bg-primary-soft px-1.5 py-0.5 font-mono text-[11px] text-primary">{`{{${v}}}`}</span>
            ))}
          </div>
        )}
      </div>
      <div className="flex shrink-0 justify-end gap-2 border-t border-border px-5 py-3.5">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" onClick={save} disabled={!title.trim() || !body.trim()}>
          Save prompt
        </Button>
      </div>
    </Modal>
  );
}
