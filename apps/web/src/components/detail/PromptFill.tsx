import { useMemo, useState } from "react";
import { Copy, Sparkles } from "lucide-react";
import { renderPrompt, type Item } from "@kosh/shared";
import { useData } from "@/data/store";
import { useUi } from "@/data/ui";
import { Button } from "../ui";
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
    <Modal open={open} onClose={onClose} className="max-w-2xl">
      <div className="flex items-center gap-2 border-b border-border px-5 py-4">
        <Sparkles size={18} className="text-primary" />
        <h2 className="text-base font-semibold">Fill & copy — {item.title}</h2>
      </div>
      <div className="grid gap-4 p-5 sm:grid-cols-2">
        <div className="space-y-3">
          {vars.length === 0 && <p className="text-sm text-muted">This prompt has no variables.</p>}
          {vars.map((v) => (
            <label key={v.name} className="block">
              <span className="mb-1 block font-mono text-[12px] text-muted">{`{{${v.name}}}`}</span>
              <textarea
                value={values[v.name] ?? ""}
                onChange={(e) => setValues((s) => ({ ...s, [v.name]: e.target.value }))}
                placeholder={v.default ?? `Enter ${v.name}`}
                rows={v.name === "diff" ? 4 : 2}
                className="w-full resize-y rounded-[var(--radius-control)] border border-border bg-surface px-3 py-2 text-[13px] outline-none focus:border-primary focus:ring-focus"
              />
            </label>
          ))}
        </div>
        <div className="min-w-0">
          <span className="mb-1 block text-[12px] font-medium text-muted">Preview</span>
          <div className="h-[calc(100%-1.5rem)] max-h-72 overflow-y-auto whitespace-pre-wrap rounded-[var(--radius-control)] border border-border bg-surface-2 p-3 font-mono text-[12.5px] leading-relaxed">
            {rendered}
          </div>
        </div>
      </div>
      <div className="flex justify-end gap-2 border-t border-border px-5 py-3.5">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" onClick={copy}>
          <Copy size={15} />
          Copy filled prompt
        </Button>
      </div>
    </Modal>
  );
}
