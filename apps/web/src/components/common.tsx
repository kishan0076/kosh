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
  if (deltaPct === null) return <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-[11px] font-medium text-faint">new</span>;
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
      {hint && <div className="mt-2 text-[11px] text-faint">{hint}</div>}
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
        <header className="flex items-center justify-between gap-3 px-5 pt-4 pb-3">
          <div className="min-w-0">
            {title && <h3 className="truncate text-[15px] font-semibold">{title}</h3>}
            {subtitle && <p className="mt-0.5 truncate text-xs text-muted">{subtitle}</p>}
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
      <div className="flex items-center gap-3">
        {Icon && (
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary-soft text-primary">
            <Icon size={20} />
          </span>
        )}
        <div>
          <h1 className="font-display text-2xl font-semibold leading-tight">{title}</h1>
          {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

/* ── Empty state ────────────────────────────────────────────── */
export function EmptyState({ icon: Icon, title, description, action }: { icon: IconType; title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-[var(--radius-card)] border border-dashed border-border-strong bg-surface/50 px-6 py-14 text-center">
      <span className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-surface-2 text-muted">
        <Icon size={26} strokeWidth={1.6} />
      </span>
      <h3 className="text-base font-semibold">{title}</h3>
      {description && <p className="mt-1.5 max-w-md text-sm text-muted">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
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
            size === "sm" ? "h-6 px-2 text-[11px]" : "h-7 px-2.5 text-xs",
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
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          disabled={!onChange}
          onClick={(e) => {
            e.stopPropagation();
            onChange?.(n === value ? 0 : n);
          }}
          className={cn("transition-transform", onChange && "hover:scale-110")}
          aria-label={`${n} star${n > 1 ? "s" : ""}`}
        >
          <Star size={size} className={n <= value ? "fill-gold text-gold" : "text-border-strong"} strokeWidth={1.5} />
        </button>
      ))}
    </div>
  );
}

