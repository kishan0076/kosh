import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowUpRight, MessageSquareText, Search as SearchIcon, Sparkles, X } from "lucide-react";
import { searchItems, type Item } from "@kosh/shared";
import { useData } from "@/data/store";
import { useUi } from "@/data/ui";
import { live } from "@/data/selectors";
import { api } from "@/data/api";
import { cn } from "@/lib/cn";
import { ago } from "@/lib/time";
import { GitHubMark, itemIcon } from "@/lib/icons";
import { EmptyState, PageHeader } from "@/components/common";
import { Button, Input } from "@/components/ui";
import { Markdown } from "@/components/markdown";
import { SkeletonText } from "@/components/PageSkeleton";

type Mode = "search" | "ask";

interface AskState {
  loading: boolean;
  answer: string | null;
  aiAvailable: boolean;
  capReached: boolean;
  citations: { n: number; itemId: string; title: string }[];
  results: Item[];
  error: string | null;
  asked: string; // the question this state is for
}
const EMPTY_ASK: AskState = { loading: false, answer: null, aiAvailable: true, capReached: false, citations: [], results: [], error: null, asked: "" };

const KIND_LABEL: Record<string, string> = { link: "Link", skill: "Skill", prompt: "Prompt", file: "File" };
const kindLabel = (item: Item): string => (item.kind === "link" && item.linkType ? cap(item.linkType) : KIND_LABEL[item.kind] ?? "Item");
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function SearchPage() {
  const items = useData((s) => s.items);
  const backend = useData((s) => s.backend);
  const openItem = useUi((s) => s.openItem);
  const [params, setParams] = useSearchParams();

  const [mode, setMode] = useState<Mode>(params.get("mode") === "ask" ? "ask" : "search");
  const [q, setQ] = useState(params.get("q") ?? "");
  const [ask, setAsk] = useState<AskState>(EMPTY_ASK);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);
  // Keep the URL in sync so a search/question is shareable + survives refresh.
  useEffect(() => {
    const next = new URLSearchParams();
    if (q.trim()) next.set("q", q.trim());
    if (mode === "ask") next.set("mode", "ask");
    setParams(next, { replace: true });
  }, [q, mode, setParams]);

  // Live, client-side unified search across every kind (instant, works offline).
  const results = useMemo(() => {
    if (mode !== "search" || !q.trim()) return [];
    return searchItems(live(items), q.trim(), { limit: 50 }).map((h) => h.item);
  }, [items, q, mode]);

  const runAsk = async () => {
    const question = q.trim();
    if (!question || !backend) return;
    setAsk({ ...EMPTY_ASK, loading: true, asked: question });
    try {
      const r = await api.ask(question);
      setAsk({ loading: false, answer: r.answer, aiAvailable: r.aiAvailable, capReached: !!r.capReached, citations: r.citations, results: r.results, error: null, asked: question });
    } catch (err) {
      setAsk({ ...EMPTY_ASK, loading: false, error: err instanceof Error ? err.message : "Couldn't ask your treasury.", asked: question });
    }
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === "ask") void runAsk();
  };

  const citedById = useMemo(() => new Map(ask.citations.map((c) => [c.itemId, c.n])), [ask.citations]);

  return (
    <div>
      <PageHeader title="Search & Ask" subtitle="One search across links, repos, skills, prompts and files — or ask a question about everything you've saved." icon={SearchIcon} />

      {/* mode toggle */}
      <div className="mb-3 inline-flex rounded-[var(--radius-control)] border border-border p-0.5">
        <ModeBtn active={mode === "search"} onClick={() => setMode("search")} icon={SearchIcon}>Search</ModeBtn>
        <ModeBtn active={mode === "ask"} onClick={() => setMode("ask")} icon={Sparkles}>Ask</ModeBtn>
      </div>

      <form onSubmit={onSubmit} className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <SearchIcon size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <Input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={mode === "search" ? "Search your vault… (try tag:pdf, kind:skill, is:pinned)" : "Ask anything about what you've saved…"}
            aria-label={mode === "search" ? "Search" : "Ask a question"}
            className="h-11 w-full pl-9 pr-9 sm:text-[14px]"
          />
          {q && (
            <button type="button" onClick={() => { setQ(""); inputRef.current?.focus(); }} aria-label="Clear" className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-foreground">
              <X size={15} />
            </button>
          )}
        </div>
        {mode === "ask" && (
          <Button type="submit" variant="primary" className="h-11 shrink-0" disabled={!q.trim() || ask.loading || !backend} loading={ask.loading}>
            <Sparkles size={16} /> Ask
          </Button>
        )}
      </form>

      {mode === "ask" && !backend && (
        <p className="mt-3 text-[13px] text-muted">Ask needs the API backend connected. Search still works here.</p>
      )}

      {/* ── search results ── */}
      {mode === "search" && (
        <div className="mt-4">
          {!q.trim() ? (
            <EmptyState icon={SearchIcon} title="Search everything" description="Find any link, repo, skill, prompt or file. Operators: tag:, kind:, stage:, is:pinned, is:repo." />
          ) : results.length === 0 ? (
            <EmptyState icon={SearchIcon} title="No matches" description={`Nothing matches “${q.trim()}”. Try fewer words, or switch to Ask.`} />
          ) : (
            <>
              <div className="mb-2 text-[12px] text-muted">{results.length} result{results.length === 1 ? "" : "s"}</div>
              <div className="space-y-1.5">
                {results.map((item) => (
                  <ResultRow key={item.id} item={item} onOpen={() => openItem(item.id)} />
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── ask ── */}
      {mode === "ask" && (
        <div className="mt-4">
          {ask.loading ? (
            <div className="rounded-[var(--radius-card)] border border-border bg-surface p-4">
              <div className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold text-primary"><Sparkles size={13} /> Reading your treasury…</div>
              <SkeletonText lines={4} />
            </div>
          ) : ask.error ? (
            <EmptyState icon={MessageSquareText} title="Couldn't answer" description={ask.error} action={<Button variant="primary" onClick={() => void runAsk()}>Try again</Button>} />
          ) : !ask.asked ? (
            <EmptyState icon={Sparkles} title="Ask your treasury" description="Ask a question in plain language — the answer is grounded only in what you've saved, with sources you can open." />
          ) : ask.answer ? (
            <div className="space-y-4">
              <div className="rounded-[var(--radius-card)] border border-primary/20 bg-primary-soft/30 p-4">
                <div className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold text-primary"><Sparkles size={13} /> Answer</div>
                <Markdown className="text-[13.5px]">{ask.answer}</Markdown>
              </div>
              {ask.results.length > 0 && (
                <div>
                  <div className="mb-2 text-[12px] font-semibold text-muted">
                    {ask.citations.length > 0 ? "Sources" : "Related items"}
                  </div>
                  <div className="space-y-1.5">
                    {ask.results.map((item) => (
                      <ResultRow key={item.id} item={item} onOpen={() => openItem(item.id)} citation={citedById.get(item.id)} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : !ask.aiAvailable ? (
            <EmptyState
              icon={Sparkles}
              title="AI isn't configured"
              description="Add an API key for an AI provider to ask questions about your library. Free providers (Gemini, Groq) work with no card."
              action={<Link to="/settings"><Button variant="primary">Open Settings</Button></Link>}
            />
          ) : ask.capReached ? (
            <EmptyState icon={Sparkles} title="Daily AI limit reached" description="You've hit today's AI spend cap. Try again tomorrow, or raise the cap in Settings." action={<Link to="/settings"><Button variant="outline">Settings</Button></Link>} />
          ) : (
            <EmptyState icon={MessageSquareText} title="Nothing found" description="I couldn't find anything in your library about that yet." />
          )}
        </div>
      )}
    </div>
  );
}

function ModeBtn({ active, onClick, icon: Icon, children }: { active: boolean; onClick: () => void; icon: typeof SearchIcon; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "pressable inline-flex h-8 items-center gap-1.5 rounded-[6px] px-3 text-[13px] font-medium transition-colors",
        active ? "bg-primary-soft text-primary" : "text-muted hover:bg-surface-2 hover:text-foreground",
      )}
      aria-pressed={active}
    >
      <Icon size={15} /> {children}
    </button>
  );
}

/** A compact, clickable search/ask result row (opens the detail drawer). */
function ResultRow({ item, onOpen, citation }: { item: Item; onOpen: () => void; citation?: number }) {
  const Icon = itemIcon(item);
  const snippet = item.ai?.summary || item.description || item.archive?.excerpt || item.prompt?.body || item.url || "";
  return (
    <button
      type="button"
      onClick={onOpen}
      className="pressable group flex w-full items-start gap-3 rounded-[var(--radius-control)] border border-border bg-surface px-3 py-2.5 text-left transition-colors hover:border-border-strong hover:bg-surface-2"
    >
      <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted">
        {item.linkType === "repo" ? <GitHubMark size={14} /> : <Icon size={15} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          {citation != null && <span className="grid h-4 min-w-4 shrink-0 place-items-center rounded bg-primary px-1 text-[10px] font-bold text-primary-foreground tabular">{citation}</span>}
          <span className="min-w-0 truncate text-[13.5px] font-semibold">{item.title || item.url || "Untitled"}</span>
        </span>
        {snippet && <span className="mt-0.5 line-clamp-1 block break-words text-[12px] text-muted [overflow-wrap:anywhere]">{snippet}</span>}
        <span className="mt-1 flex items-center gap-2 text-[11px] text-faint">
          <span className="rounded bg-surface-2 px-1.5 py-0.5 font-medium text-muted">{kindLabel(item)}</span>
          {item.tags.slice(0, 3).map((t) => <span key={t}>#{t}</span>)}
          <span className="ml-auto shrink-0">{ago(item.updatedAt)}</span>
        </span>
      </span>
      <ArrowUpRight size={15} className="mt-0.5 shrink-0 text-faint opacity-0 transition-opacity group-hover:opacity-100" />
    </button>
  );
}
