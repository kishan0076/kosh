import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import { forwardRef } from "react";
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

const BUTTON_SIZE: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-[13px] gap-1.5 rounded-[var(--radius-control)]",
  md: "h-9 px-4 text-sm gap-2 rounded-[var(--radius-control)]",
  lg: "h-11 px-5 text-[15px] gap-2 rounded-[var(--radius-control)]",
  icon: "h-9 w-9 rounded-[var(--radius-control)] justify-center",
  "icon-sm": "h-8 w-8 rounded-[var(--radius-control)] justify-center",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "secondary", size = "md", className, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center font-medium select-none",
        "transition-[color,background-color,border-color,box-shadow,transform] duration-150 ease-out",
        "motion-safe:active:scale-[0.97]",
        "disabled:opacity-50 disabled:pointer-events-none",
        "focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2",
        BUTTON_VARIANT[variant],
        BUTTON_SIZE[size],
        className,
      )}
      {...props}
    />
  ),
);
Button.displayName = "Button";

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
        "inline-flex items-center gap-1.5 rounded-full border px-3 h-8 text-[13px] font-medium",
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
  return (
    <div
      className={cn("relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary-soft text-primary font-semibold", className)}
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {src ? <img src={src} alt={name} className="h-full w-full object-cover" /> : initials}
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
