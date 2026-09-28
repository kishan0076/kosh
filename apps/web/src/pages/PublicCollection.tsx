import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowUpRight, FolderOpen } from "lucide-react";
import { api } from "@/data/api";
import { GitHubMark, itemIcon } from "@/lib/icons";
import { Button, Spinner } from "@/components/ui";
import { EmptyState } from "@/components/common";

type PublicCollection = Awaited<ReturnType<typeof api.getPublicCollection>>;
type ItemView = PublicCollection["items"][number];

const KIND_LABEL: Record<string, string> = { link: "Link", skill: "Skill", prompt: "Prompt", file: "File" };
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const kindLabel = (it: ItemView): string => (it.kind === "link" && it.linkType ? cap(it.linkType) : KIND_LABEL[it.kind] ?? "Item");

/** Read-only public view of a shared collection (no auth, outside the app shell). */
export function PublicCollection() {
  const { slug = "" } = useParams();
  const [col, setCol] = useState<PublicCollection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    api.getPublicCollection(slug)
      .then((c) => { if (alive) setCol(c); })
      .catch((err) => { if (alive) setError(err instanceof Error ? err.message : "This shared collection isn't available."); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [slug]);

  const accent = col?.color || "var(--primary)";

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-3xl items-center gap-2 px-4 py-3">
          <Link to="/" className="flex items-center gap-2 text-[15px] font-semibold">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary-soft text-primary"><FolderOpen size={16} /></span>
            Kosh
          </Link>
          <span className="text-[12px] text-faint">· shared collection</span>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8">
        {loading ? (
          <div className="grid min-h-[40vh] place-items-center text-muted"><Spinner size={24} /></div>
        ) : error || !col ? (
          <EmptyState icon={FolderOpen} title="Collection not available" description={error ?? "This shared collection may have been unshared or deleted."} action={<Link to="/"><Button variant="primary">Go to Kosh</Button></Link>} />
        ) : (
          <>
            <div className="mb-5 flex items-center gap-3">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl" style={{ backgroundColor: `color-mix(in oklab, ${accent} 16%, transparent)`, color: accent }}>
                <FolderOpen size={22} />
              </span>
              <div className="min-w-0">
                <h1 className="font-display text-2xl font-semibold leading-tight">{col.name}</h1>
                <p className="text-[13px] text-muted">{col.items.length} item{col.items.length === 1 ? "" : "s"}</p>
              </div>
            </div>

            {col.items.length === 0 ? (
              <EmptyState icon={FolderOpen} size="sm" title="Empty collection" description="Nothing here yet." />
            ) : (
              <ul className="space-y-1.5">
                {col.items.map((it, i) => {
                  const Icon = itemIcon({ kind: it.kind, linkType: it.linkType } as never);
                  const body = (
                    <>
                      <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted">
                        {it.linkType === "repo" ? <GitHubMark size={14} /> : <Icon size={15} />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className="min-w-0 truncate text-[13.5px] font-medium">{it.title}</span>
                          {it.url && <ArrowUpRight size={13} className="shrink-0 text-faint" />}
                        </span>
                        {it.summary && <span className="mt-0.5 line-clamp-2 block break-words text-[12px] text-muted [overflow-wrap:anywhere]">{it.summary}</span>}
                        <span className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-faint">
                          <span className="rounded bg-surface-2 px-1.5 py-0.5 font-medium text-muted">{kindLabel(it)}</span>
                          {it.tags.slice(0, 4).map((t) => <span key={t}>#{t}</span>)}
                        </span>
                      </span>
                    </>
                  );
                  return (
                    <li key={i}>
                      {it.url ? (
                        <a href={it.url} target="_blank" rel="noreferrer noopener" className="flex items-start gap-3 rounded-[var(--radius-control)] border border-border bg-surface px-3 py-2.5 transition-colors hover:border-border-strong hover:bg-surface-2">{body}</a>
                      ) : (
                        <div className="flex items-start gap-3 rounded-[var(--radius-control)] border border-border bg-surface px-3 py-2.5">{body}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="mt-10 border-t border-border pt-4 text-center text-[12px] text-faint">
              Shared with <Link to="/" className="text-primary hover:underline">Kosh</Link> — your unified treasury.
            </div>
          </>
        )}
      </main>
    </div>
  );
}
