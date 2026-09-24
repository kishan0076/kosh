import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";
import { forwardRef, useEffect, useState } from "react";
import { cn } from "@/lib/cn";

/* ── Button ─────────────────────────────────────────────────── */
type ButtonVariant = "primary" | "secondary" | "ghost" | "outline" | "danger" | "gold";
type ButtonSize = "sm" | "md" | "lg" | "icon" | "icon-sm";

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary:
    "bg-primary text-primary-foreground hover:bg-primary-hover shadow-sm border border-transparent",
  secondary:
    "bg-surface text-foreground border border-border hover:bg-surface-2 hover:border-border-strong",
  ghost: "text-muted hover:text-foreground hover:bg-surface-2 border border-transparent",
  outline: "border border-border text-foreground hover:bg-surface-2 hover:border-border-strong",
  danger: "bg-danger text-white hover:brightness-110 border border-transparent",
  gold: "bg-gold text-white hover:brightness-105 border border-transparent shadow-sm",
};

// Desktop sizes as designed; on touch screens (pointer: coarse) every size grows to the 40px floor
// without changing its look at rest — the extra height is hit area, not chrome.
const BUTTON_SIZE: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-[13px] gap-1.5 rounded-[var(--radius-control)] [@media(pointer:coarse)]:min-h-10",
  md: "h-9 px-4 text-sm gap-2 rounded-[var(--radius-control)] [@media(pointer:coarse)]:min-h-10",
  lg: "h-11 px-5 text-[15px] gap-2 rounded-[var(--radius-control)]",
  icon: "h-9 w-9 rounded-[var(--radius-control)] justify-center [@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:w-10",
  "icon-sm": "h-8 w-8 rounded-[var(--radius-control)] justify-center [@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:w-10",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Network-bound work in flight: disables the button, sets aria-busy and swaps the leading icon for a
   *  Spinner (the label stays, so the width doesn't jump). Optimistic store actions must NOT use this. */
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "secondary", size = "md", loading, disabled, className, children, ...props }, ref) => (
    <button
      ref={ref}
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      className={cn(
        "relative inline-flex items-center justify-center font-medium select-none",
        "transition-[color,background-color,border-color,box-shadow,transform] duration-150 ease-out",
        "motion-safe:active:scale-[0.97]",
        "disabled:opacity-50 disabled:pointer-events-none",
        "focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2",
        BUTTON_VARIANT[variant],
        BUTTON_SIZE[size],
        // The Spinner takes the leading icon's slot: hide the icon that follows it.
        loading && "[&>svg:nth-child(2)]:hidden",
        className,
      )}
      {...props}
    >
      {loading && <Spinner size={size === "sm" || size === "icon-sm" ? 13 : 15} />}
      {children}
    </button>
  ),
);
Button.displayName = "Button";

/* ── Input / Textarea ───────────────────────────────────────── */
// The app-standard text field: semantic-token surface + border, primary focus ring. Replaces the
// hand-rolled inline classes (and the dead `.input` class) scattered across forms.
const FIELD_BASE =
  "w-full rounded-[var(--radius-control)] border border-border bg-surface text-foreground outline-none transition-colors placeholder:text-faint focus:border-primary focus:ring-focus disabled:opacity-50 disabled:pointer-events-none";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    // 16px on phones: iOS Safari zooms the page into any focused input smaller than that.
    <input ref={ref} className={cn(FIELD_BASE, "h-9 px-3 text-base sm:text-[13.5px]", className)} {...props} />
  ),
);
Input.displayName = "Input";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea ref={ref} className={cn(FIELD_BASE, "min-h-[80px] px-3 py-2 text-base leading-relaxed sm:text-[13.5px]", className)} {...props} />
  ),
);
Textarea.displayName = "Textarea";

/* ── Toggle (switch) ────────────────────────────────────────── */
// The single source of truth for on/off switches. Previously hand-built (twice) from a bare
// role="switch" button and an appearance-none checkbox — both now route through this.
export function Toggle({
  checked,
  onChange,
  disabled,
  label,
  id,
  className,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label?: string;
  id?: string;
  className?: string;
}) {
  return (
    // The button is the 48×40 hit box (negative margins keep the row's 40×24 layout footprint); the
    // pill inside is the visual track, so the look is unchanged while taps get a real target.
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "-mx-1 -my-2 inline-flex h-10 w-12 shrink-0 items-center justify-center rounded-full outline-none",
        "[&:focus-visible>span]:outline-2 [&:focus-visible>span]:outline-primary [&:focus-visible>span]:outline-offset-2",
        "disabled:opacity-50 disabled:pointer-events-none",
        className,
      )}
    >
      <span className={cn("relative inline-flex h-6 w-10 items-center rounded-full transition-colors", checked ? "bg-primary" : "bg-surface-3")}>
        <span
          className={cn(
            "pointer-events-none absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform",
            checked ? "translate-x-[18px]" : "translate-x-0.5",
          )}
        />
      </span>
    </button>
  );
}

/* ── Badge / Chip ───────────────────────────────────────────── */
export function Badge({
  children,
  className,
  tone = "neutral",
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: "neutral" | "primary" | "ok" | "warn" | "danger" | "gold" | "info" }) {
  const tones: Record<string, string> = {
    neutral: "bg-surface-2 text-muted border-border",
    primary: "bg-primary-soft text-primary border-transparent",
    ok: "bg-ok-soft text-ok border-transparent",
    warn: "bg-warn-soft text-warn border-transparent",
    danger: "bg-danger-soft text-danger border-transparent",
    gold: "bg-gold-soft text-gold border-transparent",
    info: "bg-info-soft text-info border-transparent",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-none whitespace-nowrap",
        tones[tone],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}

export function Chip({
  children,
  active,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 h-8 text-[13px] font-medium [@media(pointer:coarse)]:h-9",
        "transition-[color,background-color,border-color,transform] duration-150 ease-out motion-safe:active:scale-[0.97]",
        active
          ? "bg-primary text-primary-foreground border-transparent"
          : "bg-surface text-muted border-border hover:text-foreground hover:bg-surface-2 hover:border-border-strong",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

/* ── Kbd ────────────────────────────────────────────────────── */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-[5px] border border-border bg-surface-2 px-1.5 font-mono text-[11px] text-muted",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

/* ── Skeleton ───────────────────────────────────────────────── */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("shimmer rounded-md", className)} />;
}

/* ── Progress ───────────────────────────────────────────────── */
export function Progress({ value, className, tone = "primary" }: { value: number; className?: string; tone?: "primary" | "ok" | "warn" | "danger" | "gold" }) {
  const tones = { primary: "bg-primary", ok: "bg-ok", warn: "bg-warn", danger: "bg-danger", gold: "bg-gold" };
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-surface-3", className)}>
      <div className={cn("h-full rounded-full transition-[width] duration-500", tones[tone])} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}

/* ── Avatar ─────────────────────────────────────────────────── */
export function Avatar({ name, src, size = 32, className }: { name: string; src?: string; size?: number; className?: string }) {
  const initials = name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  // Google/GitHub avatar hosts (lh3.googleusercontent.com, avatars.githubusercontent.com) reject
  // requests carrying a cross-origin Referer → the image 403s. `no-referrer` fixes it; on any other
  // load failure we fall back to the initials rather than a broken-image glyph.
  const [broken, setBroken] = useState(false);
  useEffect(() => { setBroken(false); }, [src]);
  return (
    <div
      className={cn("relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary-soft text-primary font-semibold", className)}
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {src && !broken ? <img src={src} alt={name} referrerPolicy="no-referrer" onError={() => setBroken(true)} className="h-full w-full object-cover" /> : initials}
    </div>
  );
}

/* ── Divider ────────────────────────────────────────────────── */
export function Divider({ className, vertical }: { className?: string; vertical?: boolean }) {
  return <div className={cn(vertical ? "w-px self-stretch" : "h-px w-full", "bg-border", className)} />;
}

/* ── Spinner ────────────────────────────────────────────────── */
export function Spinner({ className, size = 16 }: { className?: string; size?: number }) {
  return (
    <svg className={cn("animate-spin text-current", className)} width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.2" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
