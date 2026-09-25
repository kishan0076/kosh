import { useEffect, type RefObject } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CheckCircle2, Info, X, AlertTriangle, XCircle } from "lucide-react";
import { useUi } from "@/data/ui";
import { cn } from "@/lib/cn";
import { DUR, EASE } from "@/lib/motion";
import { PHONE_QUERY, useMediaQuery } from "@/lib/useMediaQuery";
import { Button } from "./ui";

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

/** Publish a bottom-anchored bar's height as `--bottom-stack` (px, on <html>) while it is mounted, so the
 *  Toaster rises above it instead of covering it (Drive V2's upload tray, GitHub's selection bar). */
export function useBottomStack(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement;
    // Publish 0 when the bar has no visible content (e.g. an empty upload/bulk stack that still has
    // its own padding) so the Toaster isn't permanently lifted on pages that always mount the wrapper.
    const publish = () => root.style.setProperty("--bottom-stack", el.firstElementChild ? `${el.scrollHeight}px` : "0px");
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    return () => { ro.disconnect(); root.style.removeProperty("--bottom-stack"); };
  }, [ref]);
}

export function Toaster() {
  const toasts = useUi((s) => s.toasts);
  const dismiss = useUi((s) => s.dismissToast);
  const phone = useMediaQuery(PHONE_QUERY);
  // A phone bottom-sheet lands its footer exactly where a bottom-anchored toast sits, so while one is
  // open we lift the stack to the top (the CSS below); the enter then drops in from above instead of up.
  const topAnchored = phone && typeof document !== "undefined" && document.documentElement.hasAttribute("data-sheet-open");

  return (
    <div className="pointer-events-none fixed bottom-[calc(1rem+var(--bottom-stack,0px))] left-1/2 z-[70] flex w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 flex-col gap-2 pb-safe [[data-sheet-open]_&]:bottom-auto [[data-sheet-open]_&]:top-[calc(var(--safe-top)+4.5rem)] sm:left-auto sm:right-4 sm:translate-x-0 sm:[[data-sheet-open]_&]:top-auto sm:[[data-sheet-open]_&]:bottom-4">
      <AnimatePresence>
        {toasts.map((t) => {
          const Icon = TONE_ICON[t.tone ?? "default"];
          return (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: topAnchored ? -16 : 16, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: topAnchored ? -8 : 8, scale: 0.96, transition: { duration: DUR.fast, ease: EASE.exit } }}
              transition={{ duration: DUR.base, ease: EASE.standard }}
              // Swipe sideways to dismiss (the X is small even at 36px); a short drag snaps back.
              drag="x"
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={0.7}
              dragSnapToOrigin
              onDragEnd={(_, info) => Math.abs(info.offset.x) > 80 && dismiss(t.id)}
              className="pointer-events-auto flex touch-pan-y items-start gap-3 rounded-[var(--radius-control)] border border-border bg-elevated p-3.5 shadow-[var(--shadow-pop)]"
            >
              <Icon size={18} className={cn("mt-0.5 shrink-0", TONE_COLOR[t.tone ?? "default"])} />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-foreground">{t.message}</div>
                {t.description && <div className="mt-0.5 text-[13px] text-muted">{t.description}</div>}
              </div>
              {t.action && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    t.action!.onClick();
                    dismiss(t.id);
                  }}
                  className="-my-1.5 shrink-0 font-semibold text-primary hover:bg-primary-soft hover:text-primary"
                >
                  {t.action.label}
                </Button>
              )}
              <Button variant="ghost" size="icon-sm" onClick={() => dismiss(t.id)} className="-my-1.5 -mr-1.5 shrink-0 text-faint" aria-label="Dismiss">
                <X size={15} />
              </Button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
