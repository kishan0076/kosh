import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  Blocks,
  CheckCircle2,
  CircleDot,
  Clock,
  Inbox as InboxIcon,
  LayoutGrid,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  TimerReset,
  TrendingUp,
} from "lucide-react";
import { STAGE_LABEL, formatNumber, type Item } from "@kosh/shared";
import { useData } from "@/data/store";
import { useUi } from "@/data/ui";
import {
  curationHealth,
  homeStats,
  keepRate,
  live,
  needsAttention,
  recommendations,
  savedTrend,
  shortlist,
  stageFunnel,
  weekdayActivity,
} from "@/data/selectors";
import { itemIcon } from "@/lib/icons";
import { cn } from "@/lib/cn";
import { revealClass, revealStyle } from "@/lib/motion";
import { PHONE_QUERY, useMediaQuery } from "@/lib/useMediaQuery";
import { QuickAdd } from "@/components/quickadd/QuickAdd";
import { EmptyState, StageDot, StatTile, DeltaPill, SectionCard, STAGE_TONE } from "@/components/common";
import { AreaTrend, Gauge, MiniBars, Sparkline } from "@/components/charts";
import { Badge, Button, Spinner } from "@/components/ui";

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export function Home() {
  const items = useData((s) => s.items);
  const skills = useData((s) => s.skills);
  const user = useData((s) => s.user);
  const openItem = useUi((s) => s.openItem);
  const navigate = useNavigate();
  const phone = useMediaQuery(PHONE_QUERY);
  // Pinned per data change, not per render: with `Date.now()` inline every toast/snooze/SSE patch
  // re-ran all nine selectors below.
  const now = useMemo(() => Date.now(), [items]);

  const vault = useMemo(() => live(items), [items]);
  const stats = useMemo(() => homeStats(items, skills, now), [items, skills, now]);
  const trend = useMemo(() => savedTrend(items, 30, now), [items, now]);
  const health = useMemo(() => curationHealth(items, skills, now), [items, skills, now]);
  const picks = useMemo(() => shortlist(items, now), [items, now]);
  const attention = useMemo(() => needsAttention(items, skills, now), [items, skills, now]);
  const funnel = useMemo(() => stageFunnel(items), [items]);
  const recs = useMemo(() => recommendations(items, skills), [items, skills]);
  const weekday = useMemo(() => weekdayActivity(items), [items]);
  const recent = useMemo(() => [...vault].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 5), [vault]);
  const keep = keepRate(items);

  const sparks = useMemo(() => {
    const spark = (pred: (i: Item) => boolean) => savedTrend(items.filter(pred), 14, now).map((d) => d.value);
    return { all: spark(() => true), skills: spark((i) => i.kind === "skill"), toTry: spark((i) => i.stage === "to-try") };
  }, [items, now]);
  // Two tiles per row on phones leaves ~140px of content: a narrower sparkline keeps the value readable,
  // the two long labels get their short forms and the "watched" badge (the hint says it) is dropped.
  const sparkW = phone ? 56 : 96;

  const healthColor = health.score >= 75 ? "var(--ok)" : health.score >= 50 ? "var(--warn)" : "var(--danger)";

  return (
    <div className="space-y-6">
      {/* greeting + quick add */}
      <div>
        <h1 className="font-display text-[26px] font-semibold leading-tight">
          {greeting()}, {user.name}
        </h1>
        <p className="mt-1 text-sm text-muted">Your treasury has {formatNumber(vault.length)} things. Here's what to act on today.</p>
      </div>
      <QuickAdd />

      {/* Row A — act */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="lg:col-span-8">
          <TodaysPick picks={picks} onOpen={openItem} />
        </div>
        <div className="lg:col-span-4">
          <NeedsAttention attention={attention} onOpen={openItem} />
        </div>
      </div>

      {/* Row B — KPI tiles */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatTile
          icon={LayoutGrid}
          label={phone ? "Items" : "Total items"}
          value={formatNumber(stats.total.value)}
          delta={<DeltaPill deltaPct={stats.total.deltaPct} direction={stats.total.direction} />}
          hint="vs. last 30 days"
          accent="var(--primary)"
        >
          <Sparkline data={sparks.all} color="var(--primary)" width={sparkW} />
        </StatTile>
        <StatTile
          icon={Blocks}
          label="Skills"
          value={formatNumber(stats.skills.value)}
          delta={<DeltaPill deltaPct={stats.skills.deltaPct} direction={stats.skills.direction} />}
          hint={`${stats.copiedSkills} copied · ${stats.indexOnlySkills} indexed`}
          accent="var(--tool-claude)"
        >
          <Sparkline data={sparks.skills} color="var(--tool-claude)" width={sparkW} />
        </StatTile>
        <StatTile
          icon={InboxIcon}
          label="To try"
          value={formatNumber(stats.toTry.value)}
          delta={<DeltaPill deltaPct={stats.toTry.deltaPct} direction={stats.toTry.direction} invert />}
          hint="a smaller backlog is better"
          accent="var(--c3)"
        >
          <Sparkline data={sparks.toTry} color="var(--c3)" width={sparkW} />
        </StatTile>
        <StatTile
          icon={RefreshCw}
          label={phone ? "Updates" : "Updates waiting"}
          value={formatNumber(stats.watched)}
          delta={phone ? undefined : <Badge tone="primary">watched</Badge>}
          hint="new upstream in watched repos"
          accent="var(--c2)"
        >
          <Sparkline data={weekday.map((w) => w.value)} color="var(--c2)" width={sparkW} />
        </StatTile>
      </div>

      {/* Row C — insight board */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <SectionCard
          className="lg:col-span-8"
          title="Saved over time"
          subtitle="Items captured into your vault"
          action={<Badge tone="neutral">Last 30 days</Badge>}
        >
          <AreaTrend data={trend} height={200} formatValue={(v) => `${v} saved`} />
        </SectionCard>

        <SectionCard className="lg:col-span-4" title="Curation health" subtitle="One number for vault hygiene">
          {vault.length === 0 ? (
            <EmptyState size="sm" icon={CircleDot} title="No score yet" description="Save a few things to get a health score." />
          ) : (
            <div className="flex flex-col items-center pt-2">
              <Gauge value={health.score} label={`${health.score}`} color={healthColor} sublabel="" />
              <div className="mt-2 flex items-center gap-1.5 text-center text-[13px] font-medium">
                <CircleDot size={13} style={{ color: healthColor }} />
                {health.nextBestAction}
              </div>
              <div className="mt-4 grid w-full grid-cols-2 gap-2">
                {health.components.map((c) => (
                  <div key={c.label} className="rounded-lg border border-border bg-surface-2 px-2.5 py-1.5">
                    <div className="text-[11px] text-muted">{c.label}</div>
                    <div className="font-display text-sm font-semibold tabular">{c.value}%</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </SectionCard>
      </div>

      {/* Row D — funnel + recommendations */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <SectionCard
          className="lg:col-span-6"
          title="Adoption funnel"
          subtitle={`You keep ${keep}% of what you try`}
          action={
            <Button variant="ghost" size="sm" onClick={() => navigate("/library?view=board")}>
              Board <ArrowRight size={14} />
            </Button>
          }
        >
          <StageFunnelBars funnel={funnel} onStage={(s) => navigate(`/library?stage=${s}`)} />
        </SectionCard>

        <SectionCard
          className="lg:col-span-6"
          title="Because you saved…"
          subtitle="Picked from what's already in your vault"
          action={<Sparkles size={16} className="text-gold" />}
        >
          {recs.length === 0 ? (
            <EmptyState size="sm" icon={TrendingUp} title="No recommendations yet" description="Save a few repos and skills to get recommendations." />
          ) : (
            <div className="space-y-2">
              {recs.map((r) => (
                <button
                  key={r.id}
                  onClick={() => r.itemId && openItem(r.itemId)}
                  className="flex w-full items-center gap-3 rounded-[var(--radius-control)] border border-border bg-surface px-3 py-2.5 text-left card-hover hover:border-border-strong"
                >
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary">
                    <TrendingUp size={15} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13.5px] font-medium">{r.title}</div>
                    <div className="truncate text-[11.5px] text-muted">{r.reason}</div>
                  </div>
                  <span className="shrink-0 text-[12px] font-semibold text-primary">{r.action}</span>
                </button>
              ))}
            </div>
          )}
        </SectionCard>
      </div>

      {/* Row E — activity */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <SectionCard className="lg:col-span-5" title="Most active day" subtitle="When you capture the most">
          <MiniBars data={weekday} />
        </SectionCard>
        <SectionCard
          className="lg:col-span-7"
          title="Recently saved"
          action={
            recent.length > 0 && (
              <Button variant="ghost" size="sm" onClick={() => navigate("/library")}>
                View all <ArrowRight size={14} />
              </Button>
            )
          }
        >
          {recent.length === 0 ? (
            <EmptyState size="sm" icon={LayoutGrid} title="Nothing saved yet" description="Paste a link above to start your treasury." />
          ) : (
            <RecentList items={recent} onOpen={openItem} />
          )}
        </SectionCard>
      </div>
    </div>
  );
}

/** Stands in for the subtitle while the optimistic row waits for its metadata. */
function EnrichingBadge() {
  return (
    <Badge tone="neutral" className="mt-0.5">
      <Spinner size={10} /> Enriching…
    </Badge>
  );
}

/* ── Today's Pick ───────────────────────────────────────────── */
function TodaysPick({ picks, onOpen }: { picks: Item[]; onOpen: (id: string) => void }) {
  const setStage = useData((s) => s.setStage);
  const snooze = useData((s) => s.snooze);
  const openVerdict = useUi((s) => s.openVerdict);
  const toast = useUi((s) => s.toast);

  return (
    <SectionCard
      title={
        <span className="flex items-center gap-2">
          <Sparkles size={16} className="text-gold" /> Today's pick
        </span>
      }
      subtitle="A short list worth trying next — refreshed daily"
      className="h-full"
    >
      {picks.length === 0 ? (
        <EmptyState size="sm" icon={Sparkles} title="Nothing waiting to try" description="Your inbox is clear ✨" />
      ) : (
        <div className="space-y-2.5">
          {picks.map((p, idx) => {
            const Icon = itemIcon(p);
            return (
              // On phones the text takes the rest of the first line and the Try/Snooze/Drop cluster drops
              // to a row of its own, so titles wrap instead of truncating to a dozen characters.
              <div
                key={p.id}
                className={cn(
                  "flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[var(--radius-control)] border border-border bg-surface-2 p-3 sm:flex-nowrap",
                  revealClass(idx),
                )}
                style={revealStyle(idx)}
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-surface text-muted">
                  <Icon size={16} />
                </span>
                <button onClick={() => onOpen(p.id)} className="min-w-0 flex-1 basis-[calc(100%-3rem)] text-left pressable sm:basis-auto">
                  <div className="line-clamp-2 text-[13.5px] font-semibold leading-snug">{p.title}</div>
                  {p.status === "enriching" ? <EnrichingBadge /> : <div className="truncate text-[12px] text-muted">{p.ai?.summary ?? p.description}</div>}
                </button>
                <div className="flex basis-full items-center justify-end gap-2 sm:basis-auto sm:shrink-0 sm:gap-1">
                  <Button variant="primary" size="sm" onClick={() => { setStage(p.id, "trying"); toast({ message: "Moved to Trying", description: p.title, tone: "ok" }); }}>
                    Try
                  </Button>
                  <Button variant="ghost" size="icon-sm" onClick={() => { snooze(p.id, 7); toast({ message: "Snoozed a week", description: p.title }); }} aria-label="Snooze">
                    <TimerReset size={16} />
                  </Button>
                  <Button variant="ghost" size="icon-sm" onClick={() => openVerdict(p.id)} aria-label="Drop">
                    <Clock size={16} className="rotate-45" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </SectionCard>
  );
}

/* ── Needs Attention ────────────────────────────────────────── */
function NeedsAttention({ attention, onOpen }: { attention: ReturnType<typeof needsAttention>; onOpen: (id: string) => void }) {
  const iconFor = { dead: ShieldAlert, "risky-skill": ShieldAlert, stale: Clock, drift: RefreshCw };
  return (
    <SectionCard
      title="Needs attention"
      subtitle={attention.length ? `${attention.length} to resolve` : "All clear"}
      className="h-full"
    >
      {attention.length === 0 ? (
        <EmptyState size="sm" icon={CheckCircle2} title="Nothing needs attention" description="No dead links, risky skills or drift right now." />
      ) : (
        <div className="space-y-2">
          {attention.map((a, idx) => {
            const Icon = iconFor[a.kind];
            const tone = a.kind === "risky-skill" || a.kind === "dead" ? "text-danger" : "text-warn";
            return (
              <button
                key={a.id}
                onClick={() => onOpen(a.itemId)}
                className={cn(
                  "flex w-full items-start gap-2.5 rounded-[var(--radius-control)] border border-border bg-surface px-3 py-2 text-left card-hover",
                  revealClass(idx),
                )}
                style={revealStyle(idx)}
              >
                <Icon size={15} className={cn("mt-0.5 shrink-0", tone)} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium">{a.title}</div>
                  <div className="truncate text-[11.5px] text-muted">{a.detail}</div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </SectionCard>
  );
}

/* ── Stage funnel bars ──────────────────────────────────────── */
function StageFunnelBars({ funnel, onStage }: { funnel: ReturnType<typeof stageFunnel>; onStage: (s: string) => void }) {
  const max = Math.max(1, ...funnel.map((f) => f.value));
  return (
    <div className="space-y-3">
      {funnel.map((f) => (
        <button key={f.stage} onClick={() => onStage(f.stage)} className="group block w-full text-left pressable">
          <div className="mb-1 flex items-center justify-between text-[12px]">
            <span className="flex items-center gap-1.5 font-medium">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: STAGE_TONE[f.stage].dot }} />
              {STAGE_LABEL[f.stage]}
            </span>
            <span className="tabular text-muted">{f.value}</span>
          </div>
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-surface-3">
            <div
              className="h-full rounded-full group-hover:brightness-110"
              style={{ width: `${(f.value / max) * 100}%`, backgroundColor: STAGE_TONE[f.stage].dot }}
            />
          </div>
        </button>
      ))}
    </div>
  );
}

/* ── Recent list ────────────────────────────────────────────── */
function RecentList({ items, onOpen }: { items: Item[]; onOpen: (id: string) => void }) {
  return (
    <div className="divide-y divide-border">
      {items.map((i) => {
        const Icon = itemIcon(i);
        return (
          <button key={i.id} onClick={() => onOpen(i.id)} className="flex w-full items-center gap-3 py-2.5 text-left first:pt-0 last:pb-0 pressable hover:opacity-80">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted">
              <Icon size={15} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13.5px] font-medium">{i.title}</div>
              {i.status === "enriching" ? <EnrichingBadge /> : <div className="truncate text-[11.5px] text-muted">{i.meta?.siteName ?? i.description}</div>}
            </div>
            <StageDot stage={i.stage} />
          </button>
        );
      })}
    </div>
  );
}
