import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/cn";
import { useUi } from "@/data/ui";
import { Button, Input } from "./ui";
import { Modal } from "./overlays";

/** Global confirmation dialog for destructive / warning actions — replaces window.confirm/prompt.
 *  Driven by useUi().openConfirm({ title, message, tone, input?, onConfirm }). */
export function ConfirmDialog() {
  const confirm = useUi((s) => s.confirm);
  const close = useUi((s) => s.closeConfirm);
  const [value, setValue] = useState("");

  useEffect(() => {
    if (confirm) setValue(confirm.input?.defaultValue ?? "");
  }, [confirm]);

  const tone = confirm?.tone ?? "danger";
  const submit = () => {
    confirm?.onConfirm(value.trim());
    close();
  };

  return (
    <Modal open={!!confirm} onClose={close} className="max-w-md" labelledBy="confirm-title">
      {confirm && (
        <>
          {/* Body scrolls (a long message, or the sheet under a phone keyboard); the footer stays pinned. */}
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="flex items-start gap-3 px-5 py-4">
              <span className={cn("mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full", tone === "danger" ? "bg-danger-soft text-danger" : "bg-primary-soft text-primary")}>
                <AlertTriangle size={18} />
              </span>
              <div className="min-w-0">
                <h2 id="confirm-title" className="text-base font-semibold">{confirm.title}</h2>
                {/* `overflow-wrap: anywhere` so an e-mail address or URL in the copy wraps instead of clipping. */}
                {confirm.message && <p className="mt-0.5 break-words text-[13px] leading-snug text-muted [overflow-wrap:anywhere]">{confirm.message}</p>}
              </div>
            </div>

            {confirm.input && (
              <div className="border-t border-border px-5 py-4">
                {confirm.input.label && (
                  <label htmlFor="confirm-input" className="mb-1.5 block text-[12px] font-medium text-muted">
                    {confirm.input.label}
                  </label>
                )}
                <Input
                  id="confirm-input"
                  autoFocus
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && submit()}
                  placeholder={confirm.input.placeholder}
                  className="h-11 sm:h-9"
                />
              </div>
            )}
          </div>

          <div className="flex shrink-0 justify-end gap-2 border-t border-border px-5 py-3.5">
            <Button variant="ghost" onClick={close}>
              {confirm.cancelLabel ?? "Cancel"}
            </Button>
            <Button
              variant={tone === "danger" ? "danger" : "primary"}
              onClick={submit}
              disabled={!!confirm.input && !value.trim()}
            >
              {confirm.confirmLabel ?? "Confirm"}
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}
