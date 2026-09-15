import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/cn";
import { useUi } from "@/data/ui";
import { Button } from "./ui";
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
          <div className="flex items-start gap-3 border-b border-border px-5 py-4">
            <span className={cn("mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full", tone === "danger" ? "bg-danger-soft text-danger" : "bg-primary-soft text-primary")}>
              <AlertTriangle size={18} />
            </span>
            <div className="min-w-0">
              <h2 id="confirm-title" className="text-base font-semibold">{confirm.title}</h2>
              {confirm.message && <p className="mt-0.5 text-[13px] leading-snug text-muted">{confirm.message}</p>}
            </div>
          </div>

          {confirm.input && (
            <div className="px-5 py-4">
              {confirm.input.label && (
                <label htmlFor="confirm-input" className="mb-1.5 block text-[12px] font-medium text-muted">
                  {confirm.input.label}
                </label>
              )}
              <input
                id="confirm-input"
                autoFocus
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()}
                placeholder={confirm.input.placeholder}
                className="w-full rounded-[var(--radius-control)] border border-border bg-surface px-3 py-2 text-[14px] outline-none focus:border-primary focus:ring-focus"
              />
            </div>
          )}

          <div className="flex justify-end gap-2 border-t border-border px-5 py-3.5">
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
