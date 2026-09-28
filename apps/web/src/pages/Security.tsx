import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowRight, CheckCircle2, Info, KeyRound, Lock, ShieldAlert, ShieldCheck, Share2 } from "lucide-react";
import { securityPosture, type PostureCategory, type PostureCategoryId, type PostureFinding, type SecurityPosture } from "@kosh/shared";
import { api, type ApiKeyPublic, type PackListEntry } from "@/data/api";
import { useData } from "@/data/store";
import { useUi } from "@/data/ui";
import { live } from "@/data/selectors";
import { cn } from "@/lib/cn";
import { EmptyState, PageHeader, SectionCard } from "@/components/common";
import { Spinner } from "@/components/ui";

const CATEGORY_ICON: Record<PostureCategoryId, typeof ShieldCheck> = {
  skills: ShieldCheck,
  secrets: Lock,
  sharing: Share2,
  keys: KeyRound,
};

/** Grade → semantic tone (never raw hex; light/dark swap for free). */
function gradeTone(grade: SecurityPosture["grade"]): { text: string; ring: string; soft: string } {
  if (grade === "A" || grade === "B") return { text: "text-ok", ring: "text-ok", soft: "bg-ok-soft" };
  if (grade === "C") return { text: "text-gold", ring: "text-gold", soft: "bg-gold-soft" };
  if (grade === "D") return { text: "text-warn", ring: "text-warn", soft: "bg-warn-soft" };
  return { text: "text-danger", ring: "text-danger", soft: "bg-danger-soft" };
}

const SEV = {
  critical: { icon: ShieldAlert, chip: "bg-danger-soft text-danger", label: "Critical" },
  warning: { icon: AlertTriangle, chip: "bg-warn-soft text-warn", label: "Warning" },
  info: { icon: Info, chip: "bg-info-soft text-info", label: "Review" },
} as const;

export function Security() {
  const backend = useData((s) => s.backend);
  const items = useData((s) => s.items);
  const skills = useData((s) => s.skills);
  const collections = useData((s) => s.collections);
  const openItem = useUi((s) => s.openItem);

  // Packs + API keys aren't in the core store — fetch them best-effort so their signals count when present.
  const [packs, setPacks] = useState<PackListEntry[] | null>(null);
  const [apiKeys, setApiKeys] = useState<ApiKeyPublic[] | null>(null);
  const [loadingExtra, setLoadingExtra] = useState(backend);

  useEffect(() => {
    if (!backend) { setLoadingExtra(false); return; }
    let alive = true;
    setLoadingExtra(true);
    void Promise.allSettled([api.listPacks(), api.listApiKeys()]).then(([p, k]) => {
      if (!alive) return;
      if (p.status === "fulfilled") setPacks(p.value.packs);
      if (k.status === "fulfilled") setApiKeys(k.value.apiKeys);
      setLoadingExtra(false);
    });
    return () => { alive = false; };
  }, [backend]);

  const posture = useMemo<SecurityPosture>(
    () => securityPosture({
      items: live(items),
      skills,
      collections,
      packs: packs ?? [],
      apiKeys: apiKeys ?? [],
      now: Date.now(),
    }),
    [items, skills, collections, packs, apiKeys],
  );

  const tone = gradeTone(posture.grade);

  return (
    <div>
      <PageHeader
        title="Security"
        subtitle="One score across skill trust, secret exposure, public links, and API keys — recomputed live from your vault."
        icon={ShieldCheck}
      />

      {/* score + category ring */}
      <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <SectionCard bodyClassName="flex flex-col items-center gap-3 py-7 text-center">
          <ScoreRing score={posture.score} tone={tone} grade={posture.grade} />
          <div>
            <div className="text-[15px] font-semibold">{summaryLine(posture)}</div>
            <p className="mt-0.5 text-[12.5px] text-muted">
              {posture.counts.critical + posture.counts.warning + posture.counts.info === 0
                ? "Nothing needs your attention right now."
                : [
                    posture.counts.critical && `${posture.counts.critical} critical`,
                    posture.counts.warning && `${posture.counts.warning} warning${posture.counts.warning === 1 ? "" : "s"}`,
                    posture.counts.info && `${posture.counts.info} to review`,
                  ].filter(Boolean).join(" · ")}
            </p>
          </div>
        </SectionCard>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
          {posture.categories.map((c) => <CategoryTile key={c.id} category={c} />)}
        </div>
      </div>

      {/* findings */}
      <div className="mt-4">
        <SectionCard
          title="Findings"
          subtitle={loadingExtra ? "Loading packs and API keys…" : `${posture.findings.length} across your vault`}
          action={loadingExtra ? <Spinner size={15} className="text-muted" /> : undefined}
        >
          {posture.findings.length === 0 ? (
            <EmptyState
              icon={CheckCircle2}
              size="sm"
              title="All clear"
              description="No risky skills, exposed secrets, unexpected public links, or stale keys were found."
            />
          ) : (
            <ul className="space-y-2">
              {posture.findings.map((f) => (
                <FindingRow key={f.id} finding={f} onOpenItem={openItem} />
              ))}
            </ul>
          )}
        </SectionCard>
      </div>
    </div>
  );
}

function summaryLine(p: SecurityPosture): string {
  if (p.grade === "A") return "Your vault looks secure";
  if (p.grade === "B") return "In good shape — a couple of things to tidy";
  if (p.grade === "C") return "A few things worth fixing";
  if (p.grade === "D") return "Several risks to address";
  return "Needs attention now";
}

/** SVG progress ring for the overall score — pure presentation, respects the semantic grade tone. */
function ScoreRing({ score, tone, grade }: { score: number; tone: ReturnType<typeof gradeTone>; grade: string }) {
  const R = 52;
  const C = 2 * Math.PI * R;
  const dash = (score / 100) * C;
  return (
    <div className="relative grid h-36 w-36 place-items-center">
      <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
        <circle cx="60" cy="60" r={R} fill="none" strokeWidth="10" className="text-border" stroke="currentColor" />
        <circle
          cx="60" cy="60" r={R} fill="none" strokeWidth="10" strokeLinecap="round"
          className={cn(tone.ring, "transition-[stroke-dasharray] duration-700 ease-[var(--ease-standard)] motion-reduce:transition-none")}
          stroke="currentColor" strokeDasharray={`${dash} ${C}`}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className={cn("font-display text-[34px] font-semibold leading-none", tone.text)}>{score}</span>
        <span className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-faint">Grade {grade}</span>
      </div>
    </div>
  );
}

function CategoryTile({ category }: { category: PostureCategory }) {
  const Icon = CATEGORY_ICON[category.id];
  const clean = category.issues === 0;
  return (
    <div className="rounded-[var(--radius-card)] border border-border bg-surface p-3.5">
      <div className="flex items-center justify-between">
        <span className={cn("grid h-8 w-8 place-items-center rounded-lg", clean ? "bg-ok-soft text-ok" : "bg-surface-2 text-muted")}>
          <Icon size={16} />
        </span>
        <span className={cn("font-mono text-[15px] font-semibold tabular", clean ? "text-foreground" : category.score < 65 ? "text-danger" : "text-gold")}>
          {category.score}
        </span>
      </div>
      <div className="mt-2 text-[13px] font-medium">{category.label}</div>
      <p className="mt-0.5 line-clamp-2 text-[11.5px] text-muted">{category.summary}</p>
      {/* mini bar */}
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface-3">
        <div
          className={cn("h-full rounded-full transition-[width] duration-700 ease-[var(--ease-standard)] motion-reduce:transition-none", clean ? "bg-ok" : category.score < 65 ? "bg-danger" : "bg-gold")}
          style={{ width: `${category.score}%` }}
        />
      </div>
    </div>
  );
}

function FindingRow({ finding, onOpenItem }: { finding: PostureFinding; onOpenItem: (id: string) => void }) {
  const sev = SEV[finding.severity];
  const SevIcon = sev.icon;
  const target = findingTarget(finding);

  const body = (
    <>
      <span className={cn("mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg", sev.chip)}>
        <SevIcon size={16} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">{finding.title}</span>
          <span className={cn("shrink-0 rounded-[var(--radius-chip)] px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide", sev.chip)}>{sev.label}</span>
        </div>
        <p className="mt-0.5 text-[12.5px] text-muted">{finding.detail}</p>
        {finding.action && (
          <span className="mt-1 inline-flex items-center gap-1 text-[12px] font-medium text-primary">
            {finding.action} {target && <ArrowRight size={12} />}
          </span>
        )}
      </div>
    </>
  );

  const rowClass = "flex items-start gap-3 rounded-[var(--radius-control)] border border-border bg-surface-2 px-3 py-2.5 text-left transition-colors";

  if (target?.kind === "item") {
    return <li><button onClick={() => onOpenItem(target.id)} className={cn(rowClass, "w-full hover:bg-surface-3")}>{body}</button></li>;
  }
  if (target?.to) {
    return <li><Link to={target.to} className={cn(rowClass, "hover:bg-surface-3")}>{body}</Link></li>;
  }
  return <li className={rowClass}>{body}</li>;
}

/** Where a finding's row should take you. */
function findingTarget(f: PostureFinding): { kind?: "item"; id: string; to?: string } | null {
  if (f.itemId && f.category !== "skills") return { kind: "item", id: f.itemId };
  if (f.skillId) return { id: f.skillId, to: "/skills" };
  if (f.collectionId) return { id: f.collectionId, to: "/collections" };
  if (f.packId) return { id: f.packId, to: `/packs/${f.packId}` };
  if (f.category === "keys") return { id: "keys", to: "/settings" };
  if (f.itemId) return { kind: "item", id: f.itemId };
  return null;
}
