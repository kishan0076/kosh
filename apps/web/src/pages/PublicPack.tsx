import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowUpRight, Copy, FileText, Package, Sparkles } from "lucide-react";
import { api, type PublicPackView } from "@/data/api";
import { useUi } from "@/data/ui";
import { GitHubMark, itemIcon } from "@/lib/icons";
import { ago } from "@/lib/time";
import { Button, Spinner } from "@/components/ui";
import { Markdown } from "@/components/markdown";
import { EmptyState } from "@/components/common";

const KIND_LABEL: Record<string, string> = { link: "Link", skill: "Skill", prompt: "Prompt", file: "File" };
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

type ItemView = PublicPackView["items"][number];
const kindLabel = (it: ItemView): string => (it.kind === "link" && it.linkType ? cap(it.linkType) : KIND_LABEL[it.kind] ?? "Item");

/** Read-only public view of a shared Context Pack (no auth, rendered outside the app shell). */
export function PublicPack() {
  const { slug = "" } = useParams();
  const toast = useUi((s) => s.toast);
  const [pack, setPack] = useState<PublicPackView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showContext, setShowContext] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    api.getPublicPack(slug)
      .then((p) => { if (alive) setPack(p); })
      .catch((err) => { if (alive) setError(err instanceof Error ? err.message : "This shared pack isn't available."); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [slug]);

  const copyContext = () => {
    if (!pack) return;
    navigator.clipboard?.writeText(pack.context).then(() => toast({ message: "Context copied", tone: "ok" })).catch(() => toast({ message: "Copy failed", tone: "danger" }));
  };

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-3xl items-center gap-2 px-4 py-3">
          <Link to="/" className="flex items-center gap-2 text-[15px] font-semibold">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary-soft text-primary"><Package size={16} /></span>
            Kosh
          </Link>
          <span className="text-[12px] text-faint">· shared context pack</span>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8">
        {loading ? (
          <div className="grid min-h-[40vh] place-items-center text-muted"><Spinner size={24} /></div>
        ) : error || !pack ? (
          <EmptyState icon={Package} title="Pack not available" description={error ?? "This shared pack may have been unshared or deleted."} action={<Link to="/"><Button variant="primary">Go to Kosh</Button></Link>} />
        ) : (
          <>
            <div className="mb-1 flex items-center gap-2 text-[11.5px] text-faint">
              <span className="rounded-full bg-surface-2 px-2 py-0.5 font-medium tabular">v{pack.version}</span>
              <span>{pack.items.length} item{pack.items.length === 1 ? "" : "s"}</span>
              <span>· updated {ago(pack.updatedAt)}</span>
            </div>
            <h1 className="font-display text-2xl font-semibold leading-tight">{pack.name}</h1>
            {pack.description && <p className="mt-1 text-[14px] text-muted">{pack.description}</p>}

            {pack.instructions && (
              <div className="mt-5 rounded-[var(--radius-card)] border border-primary/20 bg-primary-soft/30 p-4">
                <div className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold text-primary"><Sparkles size={13} /> Instructions</div>
                <Markdown className="text-[13.5px]">{pack.instructions}</Markdown>
              </div>
            )}

            <h2 className="mt-6 mb-2 text-[13px] font-semibold text-muted">Items</h2>
            <ul className="space-y-1.5">
              {pack.items.map((it, i) => {
                const Icon = itemIcon({ kind: it.kind, linkType: it.linkType } as never);
                return (
                  <li key={i} className="flex items-start gap-3 rounded-[var(--radius-control)] border border-border bg-surface px-3 py-2.5">
                    <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted">
                      {it.linkType === "repo" ? <GitHubMark size={14} /> : <Icon size={15} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        {it.url ? (
                          <a href={it.url} target="_blank" rel="noreferrer noopener" className="group inline-flex min-w-0 items-center gap-1 text-[13.5px] font-medium hover:text-primary">
                            <span className="min-w-0 truncate">{it.title}</span>
                            <ArrowUpRight size={13} className="shrink-0 text-faint opacity-0 transition-opacity group-hover:opacity-100" />
                          </a>
                        ) : (
                          <span className="min-w-0 truncate text-[13.5px] font-medium">{it.title}</span>
                        )}
                      </span>
                      {it.summary && <span className="mt-0.5 line-clamp-2 block break-words text-[12px] text-muted [overflow-wrap:anywhere]">{it.summary}</span>}
                      <span className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-faint">
                        <span className="rounded bg-surface-2 px-1.5 py-0.5 font-medium text-muted">{kindLabel(it)}</span>
                        {it.tags.slice(0, 4).map((t) => <span key={t}>#{t}</span>)}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>

            {/* assembled context — the exact Markdown an agent would load */}
            <div className="mt-6">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-[13px] font-semibold text-muted"><FileText size={15} /> Assembled context</div>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setShowContext((s) => !s)}>{showContext ? "Hide" : "Show"}</Button>
                  <Button variant="outline" size="sm" onClick={copyContext}><Copy size={14} /> Copy</Button>
                </div>
              </div>
              {showContext && (
                <div className="mt-2 rounded-[var(--radius-control)] border border-border bg-surface-2 p-4">
                  <Markdown className="text-[13px]">{pack.context}</Markdown>
                </div>
              )}
            </div>

            <div className="mt-10 border-t border-border pt-4 text-center text-[12px] text-faint">
              Shared with <Link to="/" className="text-primary hover:underline">Kosh</Link> — your library, ready for any agent.
            </div>
          </>
        )}
      </main>
    </div>
  );
}
