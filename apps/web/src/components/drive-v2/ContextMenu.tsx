import { useEffect, useLayoutEffect, useRef, useState, type ComponentType } from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";
import { cn } from "@/lib/cn";
import { DUR, EASE } from "@/lib/motion";
import { PHONE_QUERY, useMediaQuery } from "@/lib/useMediaQuery";

export interface MenuAction {
  label: string;
  icon?: ComponentType<{ size?: number; className?: string }>;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  shortcut?: string;
  separatorBefore?: boolean;
}

/** The device's bottom safe inset (home indicator) in px — 0 on desktop browsers. */
function safeBottom(): number {
  const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--safe-bottom"));
  return Number.isFinite(v) ? v : 0;
}

/** A right-click / more-menu positioned at a viewport point, clamped on-screen. Portaled to body.
 *  On phones it is a bottom sheet instead: twelve stacked rows anchored to a fingertip are a mis-tap
 *  magnet ("Move to trash" sits right under "Move to…"), and a sheet gives every row full width. */
export function ContextMenu({ x, y, actions, onClose }: { x: number; y: number; actions: MenuAction[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const phone = useMediaQuery(PHONE_QUERY);
  // Start off-screen until the clamp has measured the panel, so a not-yet-finite point never becomes
  // `left: NaN` (the marquee/keyboard paths can open a menu before a rect exists).
  const [pos, setPos] = useState({ x: Number.isFinite(x) ? x : 8, y: Number.isFinite(y) ? y : 8 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || phone) return;
    const { width, height } = el.getBoundingClientRect();
    const nx = Math.min(Number.isFinite(x) ? x : 8, window.innerWidth - width - 8);
    const ny = Math.min(Number.isFinite(y) ? y : 8, window.innerHeight - height - 8 - safeBottom());
    setPos({ x: Math.max(8, nx), y: Math.max(8, ny) });
  }, [x, y, phone]);

  useEffect(() => {
    // Capture phase + stopPropagation (as overlays Menu does): Escape closes only the menu — it must not
    // also reach the shell's key handler, which clears the selection the menu was opened for.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return createPortal(
    <div className={cn("fixed inset-0 z-[60]", phone && "bg-black/35")} onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }}>
      <motion.div
        ref={ref}
        role="menu"
        initial={phone ? { y: "100%" } : { opacity: 0, scale: 0.98 }}
        animate={phone ? { y: 0 } : { opacity: 1, scale: 1 }}
        transition={phone ? { duration: DUR.slow, ease: EASE.emphasized } : { duration: DUR.fast, ease: EASE.standard }}
        style={phone ? undefined : { left: pos.x, top: pos.y }}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "fixed overflow-y-auto overscroll-contain border border-border bg-elevated p-1 shadow-[var(--shadow-pop)]",
          // Capped at 70dvh so a scrim strip always stays tappable above it (a 12-row file menu would
          // otherwise fill an iPhone SE); the rows scroll inside.
          phone
            ? "inset-x-0 bottom-0 max-h-[min(70dvh,calc(100dvh-var(--safe-top)-3rem))] rounded-t-[var(--radius-panel)] border-b-0 px-2 pb-[calc(0.5rem+var(--safe-bottom))] pt-1"
            : "min-w-52 max-h-[calc(100dvh-1rem-var(--safe-bottom))] rounded-[var(--radius-panel)]",
        )}
      >
        {phone && (
          <div className="flex justify-center py-1.5" aria-hidden>
            <span className="h-1 w-9 rounded-full bg-border-strong" />
          </div>
        )}
        {actions.map((a, i) => (
          <div key={i}>
            {a.separatorBefore && <div className="my-1 h-px bg-border" />}
            <button
              role="menuitem"
              disabled={a.disabled}
              onClick={() => { a.onClick(); onClose(); }}
              className={cn(
                "pressable flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors disabled:pointer-events-none disabled:opacity-40 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:text-[14px]",
                a.danger ? "text-danger hover:bg-danger-soft" : "text-foreground hover:bg-surface-2",
              )}
            >
              {a.icon && <a.icon size={15} className={cn("shrink-0", a.danger ? "text-danger" : "text-muted")} />}
              <span className="flex-1 truncate">{a.label}</span>
              {a.shortcut && <span className="font-mono text-[11px] text-faint">{a.shortcut}</span>}
            </button>
          </div>
        ))}
      </motion.div>
    </div>,
    document.body,
  );
}
