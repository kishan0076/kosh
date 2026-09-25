import { useMemo, useState } from "react";
import { Copy, Sparkles } from "lucide-react";
import { renderPrompt, type Item } from "@kosh/shared";
import { useData } from "@/data/store";
import { useUi } from "@/data/ui";
import { Button, Textarea } from "../ui";
import { Modal } from "../overlays";

export function PromptFill({ item, open, onClose }: { item: Item; open: boolean; onClose: () => void }) {
  const usePrompt = useData((s) => s.usePrompt);
  const toast = useUi((s) => s.toast);
  const vars = item.prompt?.variables ?? [];
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(vars.map((v) => [v.name, v.default ?? ""])),
  );

  const rendered = useMemo(() => renderPrompt(item.prompt?.body ?? "", values), [item.prompt?.body, values]);

  const copy = () => {
    navigator.clipboard?.writeText(rendered).catch(() => {});
    usePrompt(item.id);
    toast({ message: "Prompt copied", description: "Filled and ready to paste", tone: "ok" });
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} className="max-w-2xl" labelledBy="prompt-fill-title">
      <div className="flex shrink-0 items-start gap-2 border-b border-border px-5 py-4">
        <Sparkles size={18} className="mt-0.5 shrink-0 text-primary" />
        <div className="min-w-0">
          <h2 id="prompt-fill-title" className="text-base font-semibold leading-tight">Fill & copy</h2>
          <p className="mt-0.5 truncate text-[13px] text-muted">{item.title}</p>
        </div>
      </div>
      <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto overflow-x-hidden p-5 sm:grid-cols-2">
        <div className="space-y-3">
          {vars.length === 0 && <p className="text-sm text-muted">This prompt has no variables.</p>}
          {vars.map((v) => (
            <label key={v.name} className="block">
              <span className="mb-1 block font-mono text-[12px] text-muted">{`{{${v.name}}}`}</span>
              <Textarea
                value={values[v.name] ?? ""}
                onChange={(e) => setValues((s) => ({ ...s, [v.name]: e.target.value }))}
                placeholder={v.default ?? `Enter ${v.name}`}
                rows={v.name === "diff" ? 4 : 2}
                className="resize-y"
              />
            </label>
          ))}
        </div>
        <div className="min-w-0">
          <span className="mb-1 block text-[12px] font-medium text-muted">Preview</span>
          <div className="h-[calc(100%-1.5rem)] max-h-72 overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-words rounded-[var(--radius-control)] border border-border bg-surface-2 p-3 font-mono text-[12.5px] leading-relaxed [overflow-wrap:anywhere]">
            {rendered}
          </div>
        </div>
      </div>
      {/* Stacked full-width on phones (primary on top), a right-aligned row from sm up — and also a single
          row on a short (keyboard-open) viewport so the buttons don't cover the focused field. */}
      <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-border px-5 py-3.5 sm:flex-row sm:justify-end [@media(max-height:480px)]:flex-row [@media(max-height:480px)]:justify-end">
        <Button variant="ghost" className="w-full sm:w-auto [@media(max-height:480px)]:w-auto" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" className="w-full sm:w-auto [@media(max-height:480px)]:w-auto" onClick={copy}>
          <Copy size={15} />
          Copy filled prompt
        </Button>
      </div>
    </Modal>
  );
}
