import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";

/* ── Menu (dropdown) ────────────────────────────────────────── */
interface MenuCtx {
  close: () => void;
}
const MenuContext = createContext<MenuCtx>({ close: () => {} });

export function Menu({
  trigger,
  children,
  align = "start",
  width = 220,
}: {
  trigger: (props: { open: boolean; toggle: () => void; ref: React.Ref<HTMLButtonElement> }) => ReactNode;
  children: ReactNode;
  align?: "start" | "end";
  width?: number;
}) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const toggle = useCallback(() => {
    if (btnRef.current) setRect(btnRef.current.getBoundingClientRect());
    setOpen((o) => !o);
  }, []);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node) || btnRef.current?.contains(e.target as Node)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    // Close on an OUTSIDE scroll/resize (the anchor moved), but NOT when scrolling inside the menu
    // itself — otherwise a long, scrollable list would dismiss the moment you scroll it.
    const onScroll = (e: Event) => {
      if (e.type === "scroll" && menuRef.current && e.target instanceof Node && menuRef.current.contains(e.target)) return;
      close();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open, close]);

  const GAP = 6;
  const MARGIN = 8; // keep the panel off the viewport edges
  const left = rect ? (align === "end" ? Math.max(MARGIN, rect.right - width) : Math.min(rect.left, window.innerWidth - width - MARGIN)) : 0;
  // Prefer opening downward; flip up when there's little room below and more above. Cap the height to the
  // available space either way and let the list scroll inside — so a long menu never runs off-screen.
  const spaceBelow = rect ? window.innerHeight - rect.bottom - GAP - MARGIN : 0;
  const spaceAbove = rect ? rect.top - GAP - MARGIN : 0;
  const openUp = rect ? spaceBelow < 240 && spaceAbove > spaceBelow : false;
  const maxHeight = Math.max(160, openUp ? spaceAbove : spaceBelow);
  const top = rect && !openUp ? rect.bottom + GAP : undefined;
  const bottom = rect && openUp ? window.innerHeight - rect.top + GAP : undefined;

  return (
    <MenuContext.Provider value={{ close }}>
      {trigger({ open, toggle, ref: btnRef })}
      {createPortal(
        <AnimatePresence>
          {open && rect && (
            <motion.div
              ref={menuRef}
              initial={{ opacity: 0, y: openUp ? 4 : -4, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: openUp ? 4 : -4, scale: 0.98 }}
              transition={{ duration: 0.14, ease: [0.2, 0.8, 0.2, 1] }}
              style={{ position: "fixed", top, bottom, left, width, maxHeight }}
              className="z-50 overflow-y-auto overscroll-contain rounded-[var(--radius-control)] border border-border bg-elevated p-1.5 shadow-[var(--shadow-pop)]"
              role="menu"
            >
              {children}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </MenuContext.Provider>
  );
}

export function MenuItem({
  children,
  onClick,
  icon: Icon,
  danger,
  disabled,
  shortcut,
}: {
  children: ReactNode;
  onClick?: () => void;
  icon?: React.ComponentType<{ className?: string; size?: number }>;
  danger?: boolean;
  disabled?: boolean;
  shortcut?: string;
}) {
  const { close } = useContext(MenuContext);
  return (
    <button
      role="menuitem"
      disabled={disabled}
      onClick={() => {
        onClick?.();
        close();
      }}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors",
        "disabled:opacity-40 disabled:pointer-events-none",
        danger ? "text-danger hover:bg-danger-soft" : "text-foreground hover:bg-surface-2",
      )}
    >
      {Icon && <Icon className={cn("shrink-0", danger ? "text-danger" : "text-muted")} size={15} />}
      <span className="flex-1 truncate">{children}</span>
      {shortcut && <span className="font-mono text-[11px] text-faint">{shortcut}</span>}
    </button>
  );
}

/** Close the enclosing Menu from a custom (non-MenuItem) child, e.g. a row with its own controls. */
export function useMenuClose() {
  return useContext(MenuContext).close;
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <div className="px-2.5 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-faint">{children}</div>;
}
export function MenuSeparator() {
  return <div className="my-1 h-px bg-border" />;
}

/* ── SelectMenu (dropdown value picker) ─────────────────────────
   A Menu-backed replacement for native <select>: keeps light/dark theming and matches every other
   dropdown in the app (account/space picker, context menus) instead of the OS-native select chrome. */
export interface SelectOption {
  value: string;
  label: ReactNode;
}
export function SelectMenu({
  value,
  options,
  onChange,
  align = "start",
  width = 200,
  size = "md",
  disabled,
  ariaLabel,
  className,
}: {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  align?: "start" | "end";
  width?: number;
  size?: "sm" | "md";
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
}) {
  const current = options.find((o) => o.value === value);
  return (
    <Menu
      align={align}
      width={width}
      trigger={({ open, toggle, ref }) => (
        <button
          ref={ref}
          type="button"
          disabled={disabled}
          aria-label={ariaLabel}
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={(e) => {
            e.stopPropagation();
            toggle();
          }}
          className={cn(
            "inline-flex items-center justify-between gap-2 rounded-[var(--radius-control)] border border-border bg-surface text-foreground outline-none transition-colors",
            "hover:border-border-strong focus-visible:border-primary focus-visible:ring-focus disabled:opacity-50 disabled:pointer-events-none",
            size === "sm" ? "h-8 px-2.5 text-[13px]" : "h-9 px-3 text-[13.5px]",
            className,
          )}
        >
          <span className="truncate">{current?.label ?? value}</span>
          <ChevronDown size={15} className={cn("shrink-0 text-faint transition-transform", open && "rotate-180")} />
        </button>
      )}
    >
      {options.map((o) => (
        <MenuItem key={o.value} onClick={() => onChange(o.value)}>
          <span className="flex flex-1 items-center justify-between gap-2">
            <span className="truncate">{o.label}</span>
            {o.value === value && <Check size={14} className="ml-auto shrink-0 text-primary" />}
          </span>
        </MenuItem>
      ))}
    </Menu>
  );
}

/* ── Tooltip ────────────────────────────────────────────────── */
export function Tooltip({ label, children, side = "top" }: { label: ReactNode; children: ReactNode; side?: "top" | "bottom" }) {
  const [show, setShow] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  const timer = useRef<number>(0);

  const enter = () => {
    timer.current = window.setTimeout(() => {
      if (ref.current) setRect(ref.current.getBoundingClientRect());
      setShow(true);
    }, 350);
  };
  const leave = () => {
    window.clearTimeout(timer.current);
    setShow(false);
  };

  return (
    <>
      <span ref={ref} onMouseEnter={enter} onMouseLeave={leave} onFocus={enter} onBlur={leave} className="contents">
        {children}
      </span>
      {createPortal(
        <AnimatePresence>
          {show && rect && (
            <motion.div
              initial={{ opacity: 0, y: side === "top" ? 2 : -2 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.12 }}
              style={{
                position: "fixed",
                left: rect.left + rect.width / 2,
                top: side === "top" ? rect.top - 8 : rect.bottom + 8,
                transform: `translate(-50%, ${side === "top" ? "-100%" : "0"})`,
              }}
              className="pointer-events-none z-[60] rounded-md bg-foreground px-2 py-1 text-[11px] font-medium text-background shadow-[var(--shadow-pop)]"
            >
              {label}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}

/* ── Modal ──────────────────────────────────────────────────── */
export function Modal({
  open,
  onClose,
  children,
  className,
  labelledBy,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  labelledBy?: string;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  // Focus trap + restore: move focus into the dialog on open, keep Tab cycling within it, and return
  // focus to the trigger on close — so keyboard/AT users aren't stranded on the page behind the modal.
  useEffect(() => {
    if (!open) return;
    const node = dialogRef.current;
    const restoreTo = document.activeElement as HTMLElement | null;
    const focusables = () =>
      node
        ? Array.from(node.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])')).filter((el) => el.offsetParent !== null || el === document.activeElement)
        : [];
    // Defer the initial focus a frame so entrance animation / async children are mounted.
    const raf = requestAnimationFrame(() => (focusables()[0] ?? node)?.focus());
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const items = focusables();
      if (!items.length) { e.preventDefault(); node?.focus(); return; }
      const first = items[0]!, last = items[items.length - 1]!;
      if (e.shiftKey && (document.activeElement === first || document.activeElement === node)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    node?.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(raf);
      node?.removeEventListener("keydown", onKey);
      restoreTo?.focus?.();
    };
  }, [open]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:items-center">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 bg-black/45 backdrop-blur-[2px]"
            onClick={onClose}
          />
          <motion.div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={labelledBy}
            tabIndex={-1}
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
            className={cn(
              "relative z-10 flex max-h-[calc(100dvh-2rem)] w-full max-w-lg flex-col overflow-hidden rounded-[var(--radius-panel)] border border-border bg-elevated shadow-[var(--shadow-pop)] focus:outline-none",
              className,
            )}
          >
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/** Lock body scroll while `active`. */
export function useBodyScrollLock(active: boolean) {
  useLayoutEffect(() => {
    if (!active) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [active]);
}
