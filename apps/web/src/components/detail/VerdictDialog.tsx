import { useState } from "react";
import { XCircle } from "lucide-react";
import { useData } from "@/data/store";
import { useUi } from "@/data/ui";
import { Button } from "../ui";
import { Modal } from "../overlays";

/** Prompted when an item is dropped — capture a one-line verdict for future-you (§7). */
export function VerdictDialog() {
  const id = useUi((s) => s.verdictItemId);
  const close = useUi((s) => s.closeVerdict);
  const items = useData((s) => s.items);
  const setStage = useData((s) => s.setStage);
  const setVerdict = useData((s) => s.setVerdict);
  const toast = useUi((s) => s.toast);
  const [text, setText] = useState("");

  const item = id ? items.find((i) => i.id === id) : undefined;

  const drop = (withVerdict: boolean) => {
    if (!id) return;
    if (withVerdict && text.trim()) setVerdict(id, text.trim());
    setStage(id, "dropped");
    toast({ message: "Dropped", description: item?.title, tone: "warn" });
    setText("");
    close();
  };

  return (
    <Modal open={!!id} onClose={close} className="max-w-md">
      <div className="flex items-center gap-2 border-b border-border px-5 py-4">
        <XCircle size={18} className="text-danger" />
        <h2 className="text-base font-semibold">Why are you dropping this?</h2>
      </div>
      <div className="p-5">
        <p className="mb-2 text-[13px] text-muted">A one-line verdict so future-you knows why — {item?.title}.</p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoFocus
          rows={3}
          placeholder="e.g. Overlaps with X and heavier to set up"
          className="w-full resize-y rounded-[var(--radius-control)] border border-border bg-surface px-3 py-2 text-[13px] outline-none focus:border-primary focus:ring-focus"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) drop(true);
          }}
        />
      </div>
      <div className="flex justify-end gap-2 border-t border-border px-5 py-3.5">
        <Button variant="ghost" onClick={() => drop(false)}>
          Drop without a note
        </Button>
        <Button variant="primary" onClick={() => drop(true)}>
          Drop with verdict
        </Button>
      </div>
    </Modal>
  );
}
