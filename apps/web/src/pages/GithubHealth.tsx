import { useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Activity, ArrowLeft, Archive, CheckCircle2, Clock, FileText, HardDrive, Scale, Settings2, Tag, Upload } from "lucide-react";
import { cn } from "@/lib/cn";
import { ago } from "@/lib/time";
import { type RepoSummary } from "@/data/githubV2Api";
import { useGithubV2 } from "@/data/githubV2";
import { GitHubMark } from "@/lib/icons";
import { revealClass, revealStyle } from "@/lib/motion";
import { Button } from "@/components/ui";
import { EmptyState } from "@/components/common";
import { PageSkeleton } from "@/components/PageSkeleton";

/**
 * Cross-repo health dashboard. The score is driven ONLY by actionable "issues" (stale, oversized, or a
 * public repo with no license). Missing description/topics are treated as optional "suggestions" — shown
 * as nudges but NOT counted against health, so a tidy private repo isn't marked unhealthy just because it
 * has no GitHub topics. Pure aggregation over the repos already in the store — no extra API calls.
 */

const STALE_DAYS = 180;
const LARGE_KB = 100 * 1024; // GitHub reports size in KB; ~100 MB

interface Signal {
  key: string;
  label: string;
  /** Shorter label for the 3-up phone tiles (falls back to `label`). */
  short?: string;
  icon: typeof FileText;
  tone: string;
}
const ISSUE_SIGNALS: Record<string, Signal> = {
  stale: { key: "stale", label: "Stale", icon: Clock, tone: "text-warn" },
  large: { key: "large", label: "Large (>100 MB)", short: "Large", icon: HardDrive, tone: "text-danger" },
  license: { key: "license", label: "Public, no license", short: "No license", icon: Scale, tone: "text-warn" },
};
const SUGGESTION_SIGNALS: Record<string, Signal> = {
  description: { key: "description", label: "No description", icon: FileText, tone: "text-muted" },
  topics: { key: "topics", label: "No topics", icon: Tag, tone: "text-muted" },
};
const ALL_SIGNALS = { ...ISSUE_SIGNALS, ...SUGGESTION_SIGNALS };

function daysSince(iso?: string): number {
  if (!iso) return Infinity;
  return (Date.now() - new Date(iso).getTime()) / 86_400_000;
}

/** Actionable problems that count against the health score. */
function issuesFor(r: RepoSummary): string[] {
  if (r.archived) return []; // archived repos are intentionally frozen — don't nag
  const out: string[] = [];
  if (daysSince(r.pushedAt) > STALE_DAYS) out.push("stale");
  if (r.size > LARGE_KB) out.push("large");
  if (!r.license && !r.private) out.push("license"); // a license only matters for public repos
  return out;
}

/** Optional polish that does NOT count against the score. */
function suggestionsFor(r: RepoSummary): string[] {
  if (r.archived) return [];
  const out: string[] = [];
  if (!r.description) out.push("description");
  if (r.topics.length === 0) out.push("topics");
  return out;
}

export function GithubHealth() {
  const navigate = useNavigate();
  const status = useGithubV2((s) => s.status);
  const repos = useGithubV2((s) => s.repos);
  const load = useGithubV2((s) => s.load);

  useEffect(() => {
    if (useGithubV2.getState().status === "idle") void load();
  }, [load]);

  // Rows appear when a repo has an actionable issue OR an optional suggestion; issues sort first.
  const rows = useMemo(
    () =>
      repos
        .map((r) => ({ repo: r, issues: issuesFor(r), suggestions: suggestionsFor(r) }))
        .filter((x) => x.issues.length + x.suggestions.length > 0)
        .sort((a, b) => b.issues.length - a.issues.length || b.suggestions.length - a.suggestions.length),
    [repos],
  );
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    const bump = (k: string) => { c[k] = (c[k] ?? 0) + 1; };
    for (const r of repos) {
      if (r.archived) { bump("archived"); continue; }
      for (const i of issuesFor(r)) bump(i);
      for (const s of suggestionsFor(r)) bump(s);
    }
    return c;
  }, [repos]);
  const archivedCount = counts.archived ?? 0;

  const active = repos.filter((r) => !r.archived).length;
  const needAttention = repos.filter((r) => !r.archived && issuesFor(r).length > 0).length; // score = issues only
  const healthy = active - needAttention;
  const score = active > 0 ? Math.round((healthy / active) * 100) : 100;

  if (status === "loading" && repos.length === 0) return <PageSkeleton variant="dashboard" />;

  return (
    <div className="w-full space-y-5">
      <Button variant="ghost" size="sm" className="-ml-2" onClick={() => navigate("/github")}><ArrowLeft size={15} /> All repositories</Button>

      <header className="flex flex-wrap items-center gap-4 rounded-[var(--radius-card)] border border-border bg-surface px-4 py-4 sm:px-5">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary"><Activity size={22} /></span>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold leading-tight">Repository health</h1>
          <p className="mt-0.5 text-pretty text-[13px] text-muted">{active} active {active === 1 ? "repo" : "repos"} · {healthy} in good shape · {needAttention} need attention</p>
        </div>
        {/* phones: the score drops to its own row under a divider instead of squeezing the title column */}
        <div className="flex basis-full items-center justify-between gap-3 border-t border-border pt-3 sm:basis-auto sm:border-0 sm:pt-0">
          <div className="text-left sm:text-right">
            <div className={cn("font-display text-[26px] font-semibold leading-none tabular", score >= 80 ? "text-ok" : score >= 50 ? "text-warn" : "text-danger")}>{score}%</div>
            <div className="text-[12px] text-faint">healthy</div>
          </div>
          <span className={cn("grid h-11 w-11 place-items-center rounded-full", score >= 80 ? "bg-ok-soft text-ok" : score >= 50 ? "bg-warn-soft text-warn" : "bg-danger-soft text-danger")}><CheckCircle2 size={22} /></span>
        </div>
      </header>

      {/* actionable issues (drive the score) — 3-up even on phones so the list isn't pushed a screen down */}
      <div>
        <div className="mb-2 px-1 text-[12px] font-semibold uppercase tracking-wide text-faint">Needs action</div>
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          {Object.values(ISSUE_SIGNALS).map((s, i) => (
            <div key={s.key} className={cn("flex flex-col rounded-[var(--radius-card)] border border-border bg-surface p-3 sm:p-4", revealClass(i))} style={revealStyle(i)}>
              <div className="flex items-start gap-1.5 text-[12px] font-medium leading-tight text-muted sm:items-center sm:gap-2"><s.icon size={14} className={cn("mt-px shrink-0 sm:mt-0", s.tone)} /> <span className="sm:hidden">{s.short ?? s.label}</span><span className="hidden text-pretty sm:inline">{s.label}</span></div>
              {/* bottom-align the count so a two-line label (e.g. 'No license' on 360px) doesn't drop its number below the neighbours */}
              <div className="mt-auto pt-2 font-display text-[20px] font-semibold leading-none tabular sm:text-[24px]">{counts[s.key] ?? 0}</div>
            </div>
          ))}
        </div>
      </div>

      {/* optional polish (do not affect the score) */}
      <div>
        <div className="mb-2 px-1 text-[12px] font-semibold uppercase tracking-wide text-faint">Optional polish <span className="font-normal normal-case text-faint">· doesn't affect the score</span></div>
        <div className="grid grid-cols-2 gap-2 sm:gap-3">
          {Object.values(SUGGESTION_SIGNALS).map((s, i) => (
            <div key={s.key} className={cn("rounded-[var(--radius-card)] border border-dashed border-border bg-surface p-3 sm:p-4", revealClass(i + 3))} style={revealStyle(i + 3)}>
              <div className="flex items-center gap-2 text-[12px] font-medium text-muted"><s.icon size={14} className={cn("shrink-0", s.tone)} /> {s.label}</div>
              <div className="mt-2 font-display text-[20px] font-semibold leading-none tabular text-muted sm:text-[24px]">{counts[s.key] ?? 0}</div>
            </div>
          ))}
        </div>
      </div>

      {/* list */}
      {rows.length === 0 ? (
        <EmptyState icon={CheckCircle2} title="Everything looks healthy" description="No active repositories need attention right now." />
      ) : (
        <section className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 border-b border-border px-4 py-3">
            <span className="shrink-0 text-[13px] font-semibold">Review &amp; polish</span>
            <span className="text-right text-[12px] text-muted">{needAttention} need action · {rows.length - needAttentionInRows(rows)} suggestions only</span>
          </div>
          {rows.map(({ repo, issues, suggestions }) => (
            <div key={repo.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-3 last:border-0">
              {/* phones: icon + name span the first line so the name is never crushed by the badge group */}
              <div className="flex min-w-0 basis-full items-center gap-2 sm:basis-auto sm:flex-1">
                <GitHubMark size={16} className="shrink-0 text-muted" />
                <button onClick={() => navigate(`/github/${repo.owner}/${repo.name}`)} className="min-w-0 flex-1 truncate py-1 text-left text-[13.5px] font-semibold hover:text-primary [@media(pointer:coarse)]:min-h-10">{repo.fullName}</button>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {issues.map((i) => {
                  const s = ALL_SIGNALS[i]!;
                  return <span key={i} className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-foreground"><s.icon size={11} className={s.tone} /> {s.label}</span>;
                })}
                {suggestions.map((i) => {
                  const s = ALL_SIGNALS[i]!;
                  return <span key={i} className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] text-faint"><s.icon size={11} /> {s.label}</span>;
                })}
              </div>
              {repo.pushedAt && <span className="hidden shrink-0 items-center gap-1 text-[12px] text-faint sm:inline-flex"><Clock size={11} /> {ago(repo.pushedAt)}</span>}
              <div className="ml-auto flex shrink-0 items-center gap-1.5">
                {issues.includes("large") && <Button variant="ghost" size="sm" onClick={() => navigate(`/github/${repo.owner}/${repo.name}/upload`)}><Upload size={13} /> Upload</Button>}
                {repo.canAdmin && <Button variant="outline" size="sm" onClick={() => navigate(`/github/${repo.owner}/${repo.name}/settings`)}><Settings2 size={13} /> Fix</Button>}
              </div>
            </div>
          ))}
        </section>
      )}

      {archivedCount > 0 && (
        <p className="flex items-center justify-center gap-1.5 text-center text-[12px] text-faint"><Archive size={13} /> {archivedCount} archived {archivedCount === 1 ? "repo is" : "repos are"} excluded from these checks.</p>
      )}
    </div>
  );
}

/** How many listed rows have an actionable issue (vs. suggestions only). */
function needAttentionInRows(rows: { issues: string[] }[]): number {
  return rows.filter((r) => r.issues.length > 0).length;
}
