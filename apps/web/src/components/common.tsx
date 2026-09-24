import type { ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, Check, Minus, Star } from "lucide-react";
import type { Stage, Trust } from "@kosh/shared";
import { STAGE_LABEL, STAGES, TRUST_LABEL } from "@kosh/shared";
import { cn } from "@/lib/cn";
import type { IconType } from "@/lib/icons";
import { Badge } from "./ui";
import { Menu, MenuItem, MenuLabel } from "./overlays";

/* ── Delta pill (KPI up/down) ───────────────────────────────────
   Color reflects *sentiment*, not direction. `invert` marks a metric
   where growth is bad (e.g. a rising to-try backlog): the arrow still
   points up, but the pill goes red. Arrow glyph is always shown so the
   sign survives grayscale / colorblindness. */
export function DeltaPill({ deltaPct, direction, invert }: { deltaPct: number | null; direction: "up" | "down" | "flat"; invert?: boolean }) {
  if (deltaPct === null) return <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-[11px] font-medium text-muted">new</span>;
  const Icon = direction === "up" ? ArrowUpRight : direction === "down" ? ArrowDownRight : Minus;
  const good = direction === "flat" ? "flat" : (direction === "up") !== !!invert ? "good" : "bad";
  const tone = good === "good" ? "text-ok" : good === "bad" ? "text-danger" : "text-muted";
  const bg = good === "good" ? "bg-ok-soft" : good === "bad" ? "bg-danger-soft" : "bg-surface-2";
  const abs = Math.abs(deltaPct);
  const display = abs >= 1000 ? `${Math.round(abs / 100)}×` : `${abs}%`;
  return (
    <span className={cn("inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular", tone, bg)}>
      <Icon size={12} strokeWidth={2.5} />
      {display}
    </span>
  );
}

/* ── KPI stat tile ──────────────────────────────────────────── */
export function StatTile({
  icon: Icon,
  label,
  value,
  hint,
  delta,
  accent = "var(--primary)",
  children,
}: {
  icon: IconType;
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  delta?: ReactNode;
  accent?: string;
  children?: ReactNode;
}) {
  return (
    <div className="group relative overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface p-4 card-hover">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-[13px] font-medium text-muted">
          <span className="grid h-7 w-7 place-items-center rounded-lg" style={{ backgroundColor: `color-mix(in oklab, ${accent} 14%, transparent)`, color: accent }}>
            <Icon size={15} strokeWidth={2} />
          </span>
          {label}
        </div>
        {delta}
      </div>
      <div className="mt-3 flex items-end justify-between gap-2">
        <div className="font-display text-[27px] font-semibold leading-none">{value}</div>
        {children}
      </div>
      {hint && <div className="mt-2 text-[11.5px] text-muted">{hint}</div>}
    </div>
  );
}

/* ── Section card ───────────────────────────────────────────── */
export function SectionCard({
  title,
  subtitle,
  action,
  menu,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  menu?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn("rounded-[var(--radius-card)] border border-border bg-surface", className)}>
      {(title || action || menu) && (
        // Titles wrap and subtitles clamp to two lines; the action keeps its width and drops to its own
        // row when the title needs the space (no more "GitHub conn…" on phones).
        <header className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 px-5 pt-4 pb-3">
          <div className="min-w-0 flex-1 basis-40">
            {title && <h3 className="break-words text-[15px] font-semibold">{title}</h3>}
            {subtitle && <p className="mt-0.5 line-clamp-2 text-xs text-muted">{subtitle}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {action}
            {menu}
          </div>
        </header>
      )}
      <div className={cn("px-5 pb-5", !title && "pt-5", bodyClassName)}>{children}</div>
    </section>
  );
}

/* ── Page header ────────────────────────────────────────────── */
export function PageHeader({ title, subtitle, actions, icon: Icon }: { title: string; subtitle?: ReactNode; actions?: ReactNode; icon?: IconType }) {
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        {Icon && (
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary">
            <Icon size={20} />
          </span>
        )}
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-semibold leading-tight">{title}</h1>
          {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

/* ── Empty state ────────────────────────────────────────────── */
/** `md` for page-level empties, `sm` for in-card ones (Home lists, tab panes) so they share one look. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  size = "md",
  className,
}: {
  icon: IconType;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  size?: "sm" | "md";
  className?: string;
}) {
  const sm = size === "sm";
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-[var(--radius-card)] border border-dashed border-border-strong bg-surface/50 text-center",
        sm ? "px-4 py-8" : "px-6 py-14",
        className,
      )}
    >
      <span className={cn("grid place-items-center bg-surface-2 text-muted", sm ? "mb-3 h-10 w-10 rounded-xl" : "mb-4 h-14 w-14 rounded-2xl")}>
        <Icon size={sm ? 20 : 26} strokeWidth={1.6} />
      </span>
      <h3 className={cn("font-semibold", sm ? "text-sm" : "text-base")}>{title}</h3>
      {description && <p className={cn("max-w-md text-muted", sm ? "mt-1 text-[13px]" : "mt-1.5 text-sm")}>{description}</p>}
      {action && <div className={sm ? "mt-3" : "mt-5"}>{action}</div>}
    </div>
  );
}

/* ── Stage chip (interactive) ───────────────────────────────── */
export const STAGE_TONE: Record<Stage, { dot: string; text: string; bg: string }> = {
  "to-try": { dot: "var(--faint)", text: "text-muted", bg: "bg-surface-2" },
  trying: { dot: "var(--info)", text: "text-info", bg: "bg-info-soft" },
  using: { dot: "var(--ok)", text: "text-ok", bg: "bg-ok-soft" },
  dropped: { dot: "var(--danger)", text: "text-danger", bg: "bg-danger-soft" },
};

export function StageDot({ stage, className }: { stage: Stage; className?: string }) {
  return <span className={cn("h-2 w-2 shrink-0 rounded-full", className)} style={{ backgroundColor: STAGE_TONE[stage].dot }} />;
}

export function StageChip({ stage, onChange, size = "md" }: { stage: Stage; onChange: (s: Stage) => void; size?: "sm" | "md" }) {
  const tone = STAGE_TONE[stage];
  return (
    <Menu
      width={170}
      trigger={({ toggle, ref }) => (
        <button
          ref={ref}
          onClick={(e) => {
            e.stopPropagation();
            toggle();
          }}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border border-transparent font-medium transition-colors",
            tone.bg,
            tone.text,
            // 32px on touch: this is the card's primary triage control, next to the card's own tap target.
            size === "sm" ? "h-6 px-2 text-[11px] [@media(pointer:coarse)]:h-8 [@media(pointer:coarse)]:px-2.5" : "h-7 px-2.5 text-xs [@media(pointer:coarse)]:h-8",
          )}
        >
          <StageDot stage={stage} />
          {STAGE_LABEL[stage]}
        </button>
      )}
    >
      <MenuLabel>Stage</MenuLabel>
      {STAGES.map((s) => (
        <MenuItem key={s} onClick={() => onChange(s)}>
          <span className="flex items-center gap-2">
            <StageDot stage={s} />
            {STAGE_LABEL[s]}
            {s === stage && <Check size={13} className="ml-auto text-primary" />}
          </span>
        </MenuItem>
      ))}
    </Menu>
  );
}

/* ── Trust badge ────────────────────────────────────────────── */
export function TrustBadge({ trust }: { trust: Trust }) {
  const map = { mine: "primary", reviewed: "ok", unreviewed: "warn" } as const;
  return <Badge tone={map[trust]}>{TRUST_LABEL[trust]}</Badge>;
}

/* ── Star rating ────────────────────────────────────────────── */
export function StarRating({ value = 0, onChange, size = 15 }: { value?: number; onChange?: (v: number) => void; size?: number }) {
  return (
    // Each star keeps its 15px glyph inside a 36px hit box (negative margins keep the row's height).
    <div className="flex items-center">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          disabled={!onChange}
          onClick={(e) => {
            e.stopPropagation();
            onChange?.(n === value ? 0 : n);
          }}
          className={cn("-my-2 grid h-9 w-9 place-items-center rounded-md transition-transform", onChange && "hover:scale-110 motion-safe:active:scale-90")}
          aria-label={`${n} star${n > 1 ? "s" : ""}`}
        >
          <Star size={size} className={n <= value ? "fill-gold text-gold" : "text-border-strong"} strokeWidth={1.5} />
        </button>
      ))}
    </div>
  );
}

