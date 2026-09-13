import { AnimatePresence, motion } from "motion/react";
import { CheckCircle2, Info, X, AlertTriangle, XCircle } from "lucide-react";
import { useUi } from "@/data/ui";
import { cn } from "@/lib/cn";

const TONE_ICON = {
  default: Info,
  ok: CheckCircle2,
  warn: AlertTriangle,
  danger: XCircle,
};
const TONE_COLOR = {
  default: "text-primary",
  ok: "text-ok",
  warn: "text-warn",
  danger: "text-danger",
};

export function Toaster() {
  const toasts = useUi((s) => s.toasts);
  const dismiss = useUi((s) => s.dismissToast);

  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-[70] flex w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 flex-col gap-2 sm:left-auto sm:right-4 sm:translate-x-0">
      <AnimatePresence>
        {toasts.map((t) => {
          const Icon = TONE_ICON[t.tone ?? "default"];
          return (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: 16, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.96 }}
              transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
              className="pointer-events-auto flex items-start gap-3 rounded-[var(--radius-control)] border border-border bg-elevated p-3.5 shadow-[var(--shadow-pop)]"
            >
              <Icon size={18} className={cn("mt-0.5 shrink-0", TONE_COLOR[t.tone ?? "default"])} />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-foreground">{t.message}</div>
                {t.description && <div className="mt-0.5 text-[13px] text-muted">{t.description}</div>}
              </div>
              {t.action && (
                <button
                  onClick={() => {
                    t.action!.onClick();
                    dismiss(t.id);
                  }}
                  className="shrink-0 rounded-md px-2.5 py-1 text-[13px] font-semibold text-primary hover:bg-primary-soft"
                >
                  {t.action.label}
                </button>
              )}
              <button onClick={() => dismiss(t.id)} className="shrink-0 rounded-md p-1 text-faint hover:bg-surface-2 hover:text-foreground" aria-label="Dismiss">
                <X size={15} />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
