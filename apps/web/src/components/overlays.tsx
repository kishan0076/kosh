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
import { DUR, EASE } from "@/lib/motion";
import { PHONE_QUERY, useMediaQuery } from "@/lib/useMediaQuery";

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
  /** Panel width in px, or "trigger" to match the anchor's width (full-width selects). */
  width?: number | "trigger";
}) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const openedAt = useRef(0);

  const toggle = useCallback(() => {
    if (btnRef.current) setRect(btnRef.current.getBoundingClientRect());
    openedAt.current = performance.now();
    setOpen((o) => !o);
  }, []);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node) || btnRef.current?.contains(e.target as Node)) return;
      close();
    };
    // Capture phase + stopPropagation: Escape closes only the menu, not a Modal that hosts it.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      close();
    };
    // Close on an OUTSIDE scroll/resize (the anchor moved), but NOT when scrolling inside the menu
    // itself — otherwise a long, scrollable list would dismiss the moment you scroll it. A resize that
    // only changes the HEIGHT is the on-screen keyboard appearing (Android fires `resize` for it) — keep
    // the menu open then; only a width change (rotation, window resize) really moves the anchor.
    // Scroll events in the first 250ms (momentum settling, a layout shift right after open) and ones
    // that didn't actually move the anchor by more than a few px are ignored, so a tap on an item
    // still lands when the list was still settling underneath.
    const startWidth = window.innerWidth;
    const anchor = btnRef.current?.getBoundingClientRect();
    const onScroll = (e: Event) => {
      if (e.type === "scroll") {
        if (menuRef.current && e.target instanceof Node && menuRef.current.contains(e.target)) return;
        if (performance.now() - openedAt.current < 250) return;
        const now = btnRef.current?.getBoundingClientRect();
        if (anchor && now && Math.abs(now.top - anchor.top) < 8 && Math.abs(now.left - anchor.left) < 8) return;
      }
      if (e.type === "resize" && window.innerWidth === startWidth) return;
      close();
    };
    document.addEventListener("pointerdown", onDown); // pointerdown covers mouse, touch and pen
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open, close]);

  const GAP = 6;
  const MARGIN = 8; // keep the panel off the viewport edges
  // Never wider than the viewport minus the margins (320px phones, split-screen), and "trigger" width
  // lines the panel up exactly with a full-width select.
  const w = rect ? Math.min(width === "trigger" ? rect.width : width, window.innerWidth - MARGIN * 2) : 0;
  const left = rect ? (align === "end" ? Math.max(MARGIN, rect.right - w) : Math.min(rect.left, window.innerWidth - w - MARGIN)) : 0;
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
              transition={{ duration: DUR.fast, ease: EASE.standard }}
              style={{ position: "fixed", top, bottom, left, width: w, maxHeight }}
              className="z-50 overflow-y-auto overscroll-contain rounded-[var(--radius-control)] border border-border bg-elevated p-1.5 shadow-[var(--shadow-pop)]"
              role="menu"
              // Portaled under <body> but still a React child of the trigger's host: stop clicks inside
              // the menu bubbling (synthetically) up to a card/row onClick.
              onClick={(e) => e.stopPropagation()}
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
        // 32px rows with a mouse; 40px rows (and a pressed tint) under a thumb.
        "flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors",
        "[@media(pointer:coarse)]:min-h-10 [@media(pointer:coarse)]:py-2.5",
        "disabled:opacity-40 disabled:pointer-events-none",
        danger ? "text-danger hover:bg-danger-soft active:bg-danger-soft" : "text-foreground hover:bg-surface-2 active:bg-surface-2",
      )}
    >
      {Icon && <Icon className={cn("shrink-0", danger ? "text-danger" : "text-muted")} size={15} />}
      <span className="min-w-0 flex-1 truncate">{children}</span>
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
  // A full-width trigger gets a panel exactly as wide as itself.
  const fullWidth = !!className && /(^|\s)w-full(\s|$)/.test(className);
  return (
    <Menu
      align={align}
      width={fullWidth ? "trigger" : width}
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
            "inline-flex min-w-0 max-w-full items-center justify-between gap-2 rounded-[var(--radius-control)] border border-border bg-surface text-foreground outline-none transition-colors",
            "hover:border-border-strong focus-visible:border-primary focus-visible:ring-focus disabled:opacity-50 disabled:pointer-events-none",
            size === "sm" ? "h-8 px-2.5 text-[13px]" : "h-9 px-3 text-[13.5px]",
            "[@media(pointer:coarse)]:min-h-10",
            className,
          )}
        >
          <span className="min-w-0 flex-1 truncate text-left">{current?.label ?? value}</span>
          <ChevronDown size={15} className={cn("shrink-0 text-faint transition-transform", open && "rotate-180")} />
        </button>
      )}
    >
      {options.map((o) => (
        <MenuItem key={o.value} onClick={() => onChange(o.value)}>
          <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
            <span className="min-w-0 truncate">{o.label}</span>
            {o.value === value && <Check size={14} className="ml-auto shrink-0 text-primary" />}
          </span>
        </MenuItem>
      ))}
    </Menu>
  );
}

/* ── Tooltip ────────────────────────────────────────────────── */
export function Tooltip({ label, children, side: preferred = "top" }: { label: ReactNode; children: ReactNode; side?: "top" | "bottom" }) {
  const [show, setShow] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [shift, setShift] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number>(0);

  const enter = () => {
    timer.current = window.setTimeout(() => {
      // The wrapper is `display: contents` (no box of its own, 0×0 rect) — measure the child instead.
      const el = (ref.current?.firstElementChild as HTMLElement | null) ?? ref.current;
      if (el) setRect(el.getBoundingClientRect());
      setShow(true);
    }, 350);
  };
  // Flip away from a viewport edge: a tip above a topbar control would be clipped, one below a
  // bottom-bar control likewise.
  const side = rect && rect.top < 44 ? "bottom" : rect && rect.bottom + 40 > window.innerHeight ? "top" : preferred;
  const leave = () => {
    window.clearTimeout(timer.current);
    setShow(false);
  };
  // Touch has no hover and no "leave": a tap would open the tip and leave it stuck until the next tap
  // elsewhere. Only a real mouse hover or a keyboard (focus-visible) focus opens it.
  const onPointerEnter = (e: React.PointerEvent) => e.pointerType === "mouse" && enter();
  const onFocus = (e: React.FocusEvent) => e.target instanceof HTMLElement && e.target.matches(":focus-visible") && enter();

  // Keep the bubble inside the viewport: once rendered, measure and nudge it off the edges.
  useLayoutEffect(() => {
    if (!show || !rect || !tipRef.current) return;
    const MARGIN = 8;
    const w = tipRef.current.offsetWidth;
    const center = rect.left + rect.width / 2;
    const min = MARGIN + w / 2;
    const max = window.innerWidth - MARGIN - w / 2;
    setShift(Math.min(max, Math.max(min, center)) - center);
  }, [show, rect]);

  return (
    <>
      <span
        ref={ref}
        onPointerEnter={onPointerEnter}
        onPointerLeave={leave}
        onPointerDown={leave}
        onFocus={onFocus}
        onBlur={leave}
        className="contents"
      >
        {children}
      </span>
      {createPortal(
        <AnimatePresence>
          {show && rect && (
            <motion.div
              ref={tipRef}
              initial={{ opacity: 0, y: side === "top" ? 2 : -2 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: DUR.fast, ease: EASE.standard }}
              style={{
                position: "fixed",
                left: rect.left + rect.width / 2 + shift,
                top: side === "top" ? rect.top - 8 : rect.bottom + 8,
                translate: `-50% ${side === "top" ? "-100%" : "0"}`,
                maxWidth: "calc(100vw - 16px)",
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
/** Under `sm` the dialog is a bottom sheet: full width, rounded top, a drag handle, safe-area padding at
 *  the bottom, slide-up enter/exit. Desktop keeps the centered scale-in. The panel is `flex-col min-h-0`,
 *  so a body with `min-h-0 flex-1 overflow-y-auto` scrolls while header/footer siblings stay pinned. */
const sheetVariants = {
  hidden: { y: "100%" },
  show: { y: 0, transition: { duration: DUR.slow, ease: EASE.emphasized } },
  exit: { y: "100%", transition: { duration: DUR.base, ease: EASE.exit } },
};
const dialogVariants = {
  hidden: { opacity: 0, y: 12, scale: 0.98 },
  show: { opacity: 1, y: 0, scale: 1, transition: { duration: DUR.base, ease: EASE.standard } },
  exit: { opacity: 0, y: 8, scale: 0.98, transition: { duration: DUR.fast, ease: EASE.exit } },
};
const scrimVariants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: DUR.base, ease: EASE.standard } },
  exit: { opacity: 0, transition: { duration: DUR.fast, ease: EASE.exit } },
};

export function Modal({
  open,
  onClose,
  children,
  className,
  labelledBy,
  sheet = "auto",
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  labelledBy?: string;
  /** Bottom-sheet presentation: "auto" (default) under 640px, "always", or "never" (always centered). */
  sheet?: "auto" | "never" | "always";
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const phone = useMediaQuery(PHONE_QUERY);
  const asSheet = sheet === "always" || (sheet === "auto" && phone);

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
        <div
          className={cn(
            "fixed inset-0 z-50 flex justify-center",
            asSheet
              ? "items-end"
              : "items-start overflow-y-auto p-4 pt-[max(1rem,var(--safe-top))] pb-[max(1rem,var(--safe-bottom))] sm:items-center",
          )}
        >
          <motion.div
            variants={scrimVariants}
            initial="hidden"
            animate="show"
            exit="exit"
            className="fixed inset-0 bg-black/45 backdrop-blur-[2px]"
            onClick={onClose}
          />
          <motion.div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={labelledBy}
            tabIndex={-1}
            variants={asSheet ? sheetVariants : dialogVariants}
            initial="hidden"
            animate="show"
            exit="exit"
            className={cn(
              "relative z-10 flex min-h-0 w-full flex-col overflow-hidden border border-border bg-elevated shadow-[var(--shadow-pop)] focus:outline-none",
              // A sheet spans the full width, so its classes win over a consumer's `max-w-*` (twMerge: last wins).
              asSheet
                ? [className, "max-h-[calc(100dvh-var(--safe-top)-1.5rem)] max-w-none rounded-t-[var(--radius-panel)] rounded-b-none border-b-0 pb-safe"]
                : ["max-h-[calc(100dvh-2rem-var(--safe-top)-var(--safe-bottom))] max-w-lg rounded-[var(--radius-panel)]", className],
            )}
          >
            {asSheet && (
              <div className="flex shrink-0 justify-center pt-2" aria-hidden>
                <div data-sheet-handle className="h-1 w-9 rounded-full bg-border-strong" />
              </div>
            )}
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
