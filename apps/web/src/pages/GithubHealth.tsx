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
 * Cross-repo health dashboard: scores every loaded repository against a set of hygiene signals
 * (description, topics, license, staleness, size) and routes each finding one click into the page that
 * fixes it. Pure aggregation over the repos already in the store — no extra API calls.
 */

const STALE_DAYS = 180;
const LARGE_KB = 100 * 1024; // GitHub reports size in KB; ~100 MB

interface Signal {
  key: string;
  label: string;
  icon: typeof FileText;
  tone: string;
}
const SIGNALS: Record<string, Signal> = {
  description: { key: "description", label: "No description", icon: FileText, tone: "text-info" },
  topics: { key: "topics", label: "No topics", icon: Tag, tone: "text-info" },
  license: { key: "license", label: "No license", icon: Scale, tone: "text-warn" },
  stale: { key: "stale", label: "Stale", icon: Clock, tone: "text-warn" },
  large: { key: "large", label: "Large (>100 MB)", icon: HardDrive, tone: "text-danger" },
};

function daysSince(iso?: string): number {
  if (!iso) return Infinity;
  return (Date.now() - new Date(iso).getTime()) / 86_400_000;
}

function issuesFor(r: RepoSummary): string[] {
  if (r.archived) return []; // archived repos are intentionally frozen — don't nag
  const out: string[] = [];
  if (!r.description) out.push("description");
  if (r.topics.length === 0) out.push("topics");
  if (!r.license && !r.private) out.push("license"); // license mainly matters for public repos
  if (daysSince(r.pushedAt) > STALE_DAYS) out.push("stale");
  if (r.size > LARGE_KB) out.push("large");
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

  const scored = useMemo(
    () => repos.map((r) => ({ repo: r, issues: issuesFor(r) })).filter((x) => x.issues.length > 0).sort((a, b) => b.issues.length - a.issues.length),
    [repos],
  );
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    const bump = (k: string) => { c[k] = (c[k] ?? 0) + 1; };
    for (const r of repos) {
      if (r.archived) { bump("archived"); continue; }
      for (const i of issuesFor(r)) bump(i);
    }
    return c;
  }, [repos]);
  const archivedCount = counts.archived ?? 0;

  const active = repos.filter((r) => !r.archived).length;
  const healthy = active - scored.length;
  const score = active > 0 ? Math.round((healthy / active) * 100) : 100;

  if (status === "loading" && repos.length === 0) return <div className="grid min-h-[40vh] place-items-center"><Spinner size={24} className="text-primary" /></div>;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5">
      <button onClick={() => navigate("/github")} className="inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-foreground"><ArrowLeft size={15} /> All repositories</button>

      <header className="flex flex-wrap items-center gap-4 rounded-[var(--radius-card)] border border-border bg-surface px-5 py-4">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary"><Activity size={22} /></span>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold leading-tight">Repository health</h1>
          <p className="mt-0.5 text-[13px] text-muted">{active} active {active === 1 ? "repo" : "repos"} · {healthy} in good shape · {scored.length} need attention</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className={cn("font-display text-[26px] font-semibold leading-none tabular", score >= 80 ? "text-ok" : score >= 50 ? "text-warn" : "text-danger")}>{score}%</div>
            <div className="text-[11px] text-faint">healthy</div>
          </div>
          <span className={cn("grid h-11 w-11 place-items-center rounded-full", score >= 80 ? "bg-ok-soft text-ok" : score >= 50 ? "bg-warn-soft text-warn" : "bg-danger-soft text-danger")}><CheckCircle2 size={22} /></span>
        </div>
      </header>

      {/* signal summary */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {Object.values(SIGNALS).map((s) => (
          <div key={s.key} className="rounded-[var(--radius-card)] border border-border bg-surface p-4">
            <div className="flex items-center gap-2 text-[12px] font-medium text-muted"><s.icon size={14} className={s.tone} /> {s.label}</div>
            <div className="mt-2 font-display text-[24px] font-semibold leading-none">{counts[s.key] ?? 0}</div>
          </div>
        ))}
      </div>

      {/* needs attention */}
      {scored.length === 0 ? (
        <div className="rounded-[var(--radius-card)] border border-border bg-surface px-6 py-16 text-center">
          <span className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-ok-soft text-ok"><CheckCircle2 size={24} /></span>
          <p className="text-[14px] font-medium">Everything looks healthy</p>
          <p className="mt-1 text-[13px] text-muted">No active repositories need attention right now.</p>
        </div>
      ) : (
        <section className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <span className="text-[13px] font-semibold">Needs attention</span>
            <span className="text-[12px] text-muted">{scored.length} {scored.length === 1 ? "repo" : "repos"}</span>
          </div>
          {scored.map(({ repo, issues }) => (
            <div key={repo.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-3 last:border-0">
              <GitHubMark size={16} className="shrink-0 text-muted" />
              <button onClick={() => navigate(`/github/${repo.owner}/${repo.name}`)} className="min-w-0 flex-1 truncate text-left text-[13.5px] font-semibold hover:text-primary">{repo.fullName}</button>
              <div className="flex flex-wrap items-center gap-1.5">
                {issues.map((i) => {
                  const s = SIGNALS[i]!;
                  return <span key={i} className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-muted"><s.icon size={11} className={s.tone} /> {s.label}</span>;
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
