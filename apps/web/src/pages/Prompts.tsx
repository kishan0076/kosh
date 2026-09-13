import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Copy, Plus, Quote } from "lucide-react";
import { extractVariables, type Item } from "@kosh/shared";
import { useData } from "@/data/store";
import { useUi } from "@/data/ui";
import { live } from "@/data/selectors";
import { ago } from "@/lib/time";
import { useSetStage } from "@/lib/useSetStage";
import { EmptyState, PageHeader, StageChip } from "@/components/common";
import { Button } from "@/components/ui";
import { Modal } from "@/components/overlays";
import { PromptFill } from "@/components/detail/PromptFill";

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
          {prompts.map((p) => (
            <article key={p.id} className="flex flex-col rounded-[var(--radius-card)] border border-border bg-surface p-4 card-hover">
              <div className="flex items-start justify-between gap-2">
                <button onClick={() => openItem(p.id)} className="min-w-0 text-left">
                  <h3 className="truncate text-[15px] font-semibold">{p.title}</h3>
                  <p className="mt-0.5 line-clamp-1 text-[13px] text-muted">{p.description}</p>
                </button>
                <StageChip stage={p.stage} onChange={(s) => setStage(p.id, s)} size="sm" />
              </div>
              <div className="mt-3 line-clamp-3 rounded-[var(--radius-control)] border border-border bg-surface-2 px-3 py-2 font-mono text-[12px] leading-snug text-muted">
                {p.prompt?.body}
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {(p.prompt?.variables ?? []).map((v) => (
                  <span key={v.name} className="rounded bg-primary-soft px-1.5 py-0.5 font-mono text-[11px] text-primary">
                    {`{{${v.name}}}`}
                  </span>
                ))}
              </div>
              <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
                <span className="text-[11px] text-faint">used {p.prompt?.usedCount ?? 0}× · {ago(p.updatedAt)}</span>
                <Button variant="secondary" size="sm" onClick={() => setFill(p)}>
                  <Copy size={14} /> Fill & copy
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}

      {fill && <PromptFill item={fill} open={!!fill} onClose={() => setFill(null)} />}
      <NewPromptModal open={newOpen} onClose={() => { setNewOpen(false); const n = new URLSearchParams(params); n.delete("new"); setParams(n, { replace: true }); }} />
    </div>
  );
}

function NewPromptModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const createPrompt = useData((s) => s.createPrompt);
  const openItem = useUi((s) => s.openItem);
  const toast = useUi((s) => s.toast);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const vars = extractVariables(body);

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
    <Modal open={open} onClose={onClose} className="max-w-xl">
      <div className="flex items-center gap-2 border-b border-border px-5 py-4">
        <Quote size={18} className="text-primary" />
        <h2 className="text-base font-semibold">New prompt</h2>
      </div>
      <div className="space-y-3 p-5">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title"
          className="w-full rounded-[var(--radius-control)] border border-border bg-surface px-3 py-2 text-[14px] outline-none focus:border-primary focus:ring-focus"
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Prompt body — use {{variables}} for fill-in fields"
          rows={7}
          className="w-full resize-y rounded-[var(--radius-control)] border border-border bg-surface-2 p-3 font-mono text-[12.5px] leading-relaxed outline-none focus:border-primary focus:ring-focus"
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
      <div className="flex justify-end gap-2 border-t border-border px-5 py-3.5">
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
