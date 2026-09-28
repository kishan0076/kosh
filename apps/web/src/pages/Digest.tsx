import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, BookmarkPlus, Check, Inbox, Newspaper, Sparkles, Unlink } from "lucide-react";
import { api, type Digest as DigestData } from "@/data/api";
import { useData } from "@/data/store";
import { useUi } from "@/data/ui";
import { cn } from "@/lib/cn";
import { ago } from "@/lib/time";
import { GitHubMark, itemIcon } from "@/lib/icons";
import { EmptyState, PageHeader, StatTile } from "@/components/common";
import { Button } from "@/components/ui";

export function Digest() {
  const backend = useData((s) => s.backend);
  const openItem = useUi((s) => s.openItem);
  const toast = useUi((s) => s.toast);
  const [days, setDays] = useState(7);
  const [digest, setDigest] = useState<DigestData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);

  const load = useCallback(async (d: number) => {
    setError(null);
    try {
      setDigest(await api.getDigest(d));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load your digest.");
    }
  }, []);

  useEffect(() => {
    if (backend) void load(days);
  }, [backend, days, load]);

  const markSeen = async () => {
    setClearing(true);
    try {
      await api.markDigestSeen();
      setDigest((d) => (d ? { ...d, watched: [], watchedNewTotal: 0 } : d));
      toast({ message: "Marked all as seen", tone: "ok" });
    } catch (err) {
      toast({ message: "Couldn't update", description: err instanceof Error ? err.message : undefined, tone: "danger" });
    } finally {
      setClearing(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="What's new"
        subtitle="Changes in the repos you watch, plus a review of what you've saved."
        icon={Newspaper}
        actions={
          <div className="inline-flex rounded-[var(--radius-control)] border border-border p-0.5">
            {[7, 30].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDays(d)}
                className={cn("pressable h-8 rounded-[6px] px-3 text-[13px] font-medium", days === d ? "bg-primary-soft text-primary" : "text-muted hover:bg-surface-2 hover:text-foreground")}
                aria-pressed={days === d}
              >
                {d}d
              </button>
            ))}
          </div>
        }
      />

      {!backend ? (
        <EmptyState icon={Newspaper} title="The digest needs the API backend" description="Connect the Kosh API to see what's new across your vault." />
      ) : error ? (
        <EmptyState icon={Newspaper} title="Couldn't load the digest" description={error} action={<Button variant="primary" onClick={() => void load(days)}>Try again</Button>} />
      ) : !digest ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-24 rounded-[var(--radius-card)] border border-border bg-surface shimmer" />)}
        </div>
      ) : (
        <div className="space-y-6">
          {/* activity tiles (weekly review) */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile icon={BookmarkPlus} label={`Saved · ${days}d`} value={digest.savedCount} hint={digest.enrichedCount ? `${digest.enrichedCount} enriched` : undefined} />
            <StatTile icon={Sparkles} label="Using" value={digest.usingCount} accent="var(--ok)" />
            <StatTile icon={Inbox} label="To-try" value={digest.toTryCount} accent="var(--gold)" hint={<Link className="text-primary hover:underline" to="/inbox">Triage →</Link>} />
            <StatTile icon={Unlink} label="Dead links" value={digest.deadCount} accent="var(--danger)" hint={digest.deadCount ? <Link className="text-primary hover:underline" to="/library?kind=link">Review →</Link> : "all healthy"} />
          </div>

          {/* watched repos with new items */}
          <section className="rounded-[var(--radius-card)] border border-border bg-surface">
            <header className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4 pb-3">
              <div>
                <h3 className="text-[15px] font-semibold">Watched repos</h3>
                <p className="mt-0.5 text-xs text-muted">{digest.watchedNewTotal > 0 ? `${digest.watchedNewTotal} new item${digest.watchedNewTotal === 1 ? "" : "s"} across ${digest.watched.length} repo${digest.watched.length === 1 ? "" : "s"}` : "No new changes since you last checked."}</p>
              </div>
              {digest.watched.length > 0 && <Button variant="outline" size="sm" onClick={() => void markSeen()} loading={clearing}><Check size={14} /> Mark all seen</Button>}
            </header>
            <div className="px-5 pb-5">
              {digest.watched.length === 0 ? (
                <p className="text-[13px] text-muted">Turn on “Watch for changes” on a repo card to track new releases and skills here.</p>
              ) : (
                <div className="space-y-1.5">
                  {digest.watched.map((w) => (
                    <button
                      key={w.itemId}
                      type="button"
                      onClick={() => openItem(w.itemId)}
                      className="pressable group flex w-full items-center gap-3 rounded-[var(--radius-control)] border border-border bg-surface px-3 py-2.5 text-left transition-colors hover:border-border-strong hover:bg-surface-2"
                    >
                      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted"><GitHubMark size={14} /></span>
                      <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">{w.title}</span>
                      <span className="shrink-0 rounded-full bg-primary px-2 py-0.5 text-[11px] font-bold text-primary-foreground tabular">+{w.newSince}</span>
                      <ArrowUpRight size={15} className="shrink-0 text-faint opacity-0 transition-opacity group-hover:opacity-100" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* top tags */}
          {digest.topTags.length > 0 && (
            <section>
              <h3 className="mb-2 text-[13px] font-semibold text-muted">Top tags this period</h3>
              <div className="flex flex-wrap gap-1.5">
                {digest.topTags.map((t) => (
                  <Link key={t.tag} to={`/library?tag=${encodeURIComponent(t.tag)}`} className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-1 text-[12px] text-muted hover:bg-surface-3 hover:text-foreground">
                    #{t.tag} <span className="text-faint tabular">{t.count}</span>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {/* recently saved */}
          <section>
            <h3 className="mb-2 text-[13px] font-semibold text-muted">Recently saved</h3>
            {digest.recent.length === 0 ? (
              <EmptyState icon={BookmarkPlus} size="sm" title="Nothing saved in this window" description="Capture a link, repo, or prompt and it'll show up here." action={<Link to="/add"><Button variant="primary" size="sm">Add something</Button></Link>} />
            ) : (
              <div className="space-y-1.5">
                {digest.recent.map((item) => {
                  const Icon = itemIcon(item);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => openItem(item.id)}
                      className="pressable group flex w-full items-center gap-3 rounded-[var(--radius-control)] border border-border bg-surface px-3 py-2.5 text-left transition-colors hover:border-border-strong hover:bg-surface-2"
                    >
                      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted">{item.linkType === "repo" ? <GitHubMark size={14} /> : <Icon size={15} />}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block min-w-0 truncate text-[13.5px] font-medium">{item.title || item.url || "Untitled"}</span>
                        {(item.ai?.summary || item.description) && <span className="mt-0.5 line-clamp-1 block break-words text-[12px] text-muted [overflow-wrap:anywhere]">{item.ai?.summary || item.description}</span>}
                      </span>
                      <span className="shrink-0 text-[11px] text-faint">{ago(item.createdAt)}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
