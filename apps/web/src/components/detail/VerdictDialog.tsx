import { useEffect, useState } from "react";
import { XCircle } from "lucide-react";
import { useData } from "@/data/store";
import { useUi } from "@/data/ui";
import { Button, Textarea } from "../ui";
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

  // Each open starts empty so a reason abandoned for one item never leaks to the next.
  useEffect(() => {
    if (!id) setText("");
  }, [id]);

  const drop = (withVerdict: boolean) => {
    if (!id) return;
    if (withVerdict && text.trim()) setVerdict(id, text.trim());
    setStage(id, "dropped");
    toast({ message: "Dropped", description: item?.title, tone: "warn" });
    setText("");
    close();
  };

  return (
    <Modal open={!!id} onClose={close} className="max-w-md" labelledBy="verdict-dialog-title">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-5 py-4">
        <XCircle size={18} className="shrink-0 text-danger" />
        <h2 id="verdict-dialog-title" className="text-base font-semibold">Why are you dropping this?</h2>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <p className="mb-2 break-words text-[13px] text-muted [overflow-wrap:anywhere]">A one-line verdict so future-you knows why — {item?.title}.</p>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoFocus
          rows={3}
          placeholder="e.g. Overlaps with X and heavier to set up"
          className="resize-y"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) drop(true);
          }}
        />
      </div>
      {/* Stacked full-width on phones (primary on top), a right-aligned row from sm up. */}
      <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-border px-5 py-3.5 sm:flex-row sm:justify-end">
        <Button variant="ghost" className="w-full sm:w-auto" onClick={() => drop(false)}>
          Drop without a note
        </Button>
        <Button variant="primary" className="w-full sm:w-auto" onClick={() => drop(true)}>
          Drop with verdict
        </Button>
      </div>
    </Modal>
  );
}
