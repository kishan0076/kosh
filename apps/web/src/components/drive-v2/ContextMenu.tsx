import { useEffect, useLayoutEffect, useRef, useState, type ComponentType } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";

export interface MenuAction {
  label: string;
  icon?: ComponentType<{ size?: number; className?: string }>;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  shortcut?: string;
  separatorBefore?: boolean;
}

/** A right-click / more-menu positioned at a viewport point, clamped on-screen. Portaled to body. */
export function ContextMenu({ x, y, actions, onClose }: { x: number; y: number; actions: MenuAction[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const nx = Math.min(x, window.innerWidth - width - 8);
    const ny = Math.min(y, window.innerHeight - height - 8);
    setPos({ x: Math.max(8, nx), y: Math.max(8, ny) });
  }, [x, y]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[60]" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }}>
      <div
        ref={ref}
        role="menu"
        style={{ left: pos.x, top: pos.y }}
        onClick={(e) => e.stopPropagation()}
        className="fixed min-w-52 max-h-[calc(100dvh-1rem)] overflow-y-auto rounded-[var(--radius-panel)] border border-border bg-elevated p-1 shadow-[var(--shadow-pop)]"
      >
        {actions.map((a, i) => (
          <div key={i}>
            {a.separatorBefore && <div className="my-1 h-px bg-border" />}
            <button
              role="menuitem"
              disabled={a.disabled}
              onClick={() => { a.onClick(); onClose(); }}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors disabled:pointer-events-none disabled:opacity-40",
                a.danger ? "text-danger hover:bg-danger-soft" : "text-foreground hover:bg-surface-2",
              )}
            >
              {a.icon && <a.icon size={15} className={cn("shrink-0", a.danger ? "text-danger" : "text-muted")} />}
              <span className="flex-1 truncate">{a.label}</span>
              {a.shortcut && <span className="font-mono text-[11px] text-faint">{a.shortcut}</span>}
            </button>
          </div>
        ))}
      </div>
    </div>,
    document.body,
  );
}
