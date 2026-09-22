import { useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Activity, ArrowLeft, Archive, CheckCircle2, Clock, FileText, HardDrive, Scale, Settings2, Tag, Upload } from "lucide-react";
import { cn } from "@/lib/cn";
import { ago } from "@/lib/time";
import { type RepoSummary } from "@/data/githubV2Api";
import { useGithubV2 } from "@/data/githubV2";
import { GitHubMark } from "@/lib/icons";
import { Button, Spinner } from "@/components/ui";

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
  icon: typeof FileText;
  tone: string;
}
const ISSUE_SIGNALS: Record<string, Signal> = {
  stale: { key: "stale", label: "Stale", icon: Clock, tone: "text-warn" },
  large: { key: "large", label: "Large (>100 MB)", icon: HardDrive, tone: "text-danger" },
  license: { key: "license", label: "Public, no license", icon: Scale, tone: "text-warn" },
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

  if (status === "loading" && repos.length === 0) return <div className="grid min-h-[40vh] place-items-center"><Spinner size={24} className="text-primary" /></div>;

  return (
    <div className="w-full space-y-5">
      <button onClick={() => navigate("/github")} className="inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-foreground"><ArrowLeft size={15} /> All repositories</button>

      <header className="flex flex-wrap items-center gap-4 rounded-[var(--radius-card)] border border-border bg-surface px-5 py-4">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary"><Activity size={22} /></span>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold leading-tight">Repository health</h1>
          <p className="mt-0.5 text-[13px] text-muted">{active} active {active === 1 ? "repo" : "repos"} · {healthy} in good shape · {needAttention} need attention</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className={cn("font-display text-[26px] font-semibold leading-none tabular", score >= 80 ? "text-ok" : score >= 50 ? "text-warn" : "text-danger")}>{score}%</div>
            <div className="text-[11px] text-faint">healthy</div>
          </div>
          <span className={cn("grid h-11 w-11 place-items-center rounded-full", score >= 80 ? "bg-ok-soft text-ok" : score >= 50 ? "bg-warn-soft text-warn" : "bg-danger-soft text-danger")}><CheckCircle2 size={22} /></span>
        </div>
      </header>

      {/* actionable issues (drive the score) */}
      <div>
        <div className="mb-2 px-1 text-[12px] font-semibold uppercase tracking-wide text-faint">Needs action</div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {Object.values(ISSUE_SIGNALS).map((s) => (
            <div key={s.key} className="rounded-[var(--radius-card)] border border-border bg-surface p-4">
              <div className="flex items-center gap-2 text-[12px] font-medium text-muted"><s.icon size={14} className={s.tone} /> {s.label}</div>
              <div className="mt-2 font-display text-[24px] font-semibold leading-none">{counts[s.key] ?? 0}</div>
            </div>
          ))}
        </div>
      </div>

      {/* optional polish (do not affect the score) */}
      <div>
        <div className="mb-2 px-1 text-[12px] font-semibold uppercase tracking-wide text-faint">Optional polish <span className="font-normal normal-case text-faint">· doesn't affect the score</span></div>
        <div className="grid grid-cols-2 gap-3">
          {Object.values(SUGGESTION_SIGNALS).map((s) => (
            <div key={s.key} className="rounded-[var(--radius-card)] border border-dashed border-border bg-surface p-4">
              <div className="flex items-center gap-2 text-[12px] font-medium text-muted"><s.icon size={14} className={s.tone} /> {s.label}</div>
              <div className="mt-2 font-display text-[24px] font-semibold leading-none text-muted">{counts[s.key] ?? 0}</div>
            </div>
          ))}
        </div>
      </div>

      {/* list */}
      {rows.length === 0 ? (
        <div className="rounded-[var(--radius-card)] border border-border bg-surface px-6 py-16 text-center">
          <span className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-ok-soft text-ok"><CheckCircle2 size={24} /></span>
          <p className="text-[14px] font-medium">Everything looks healthy</p>
          <p className="mt-1 text-[13px] text-muted">No active repositories need attention right now.</p>
        </div>
      ) : (
        <section className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <span className="text-[13px] font-semibold">Review &amp; polish</span>
            <span className="text-[12px] text-muted">{needAttention} need action · {rows.length - needAttentionInRows(rows)} suggestions only</span>
          </div>
          {rows.map(({ repo, issues, suggestions }) => (
            <div key={repo.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-3 last:border-0">
              <GitHubMark size={16} className="shrink-0 text-muted" />
              <button onClick={() => navigate(`/github/${repo.owner}/${repo.name}`)} className="min-w-0 flex-1 truncate text-left text-[13.5px] font-semibold hover:text-primary">{repo.fullName}</button>
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
              {repo.pushedAt && <span className="hidden shrink-0 items-center gap-1 text-[11.5px] text-faint sm:inline-flex"><Clock size={11} /> {ago(repo.pushedAt)}</span>}
              <div className="flex shrink-0 items-center gap-1.5">
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
