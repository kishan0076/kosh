import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Columns3, LayoutGrid, LibraryBig, Search, X } from "lucide-react";
import { STAGE_LABEL, STAGES, type Item, type Stage } from "@kosh/shared";
import { useData } from "@/data/store";
import { live, topTags } from "@/data/selectors";
import { cn } from "@/lib/cn";
import { EmptyState, PageHeader, STAGE_TONE } from "@/components/common";
import { ItemGrid } from "@/components/ItemGrid";
import { ItemCard } from "@/components/cards/ItemCard";
import { FadeSwap } from "@/components/motion";
import { Button, Chip, Input } from "@/components/ui";

type KindSeg = "all" | "repo" | "link" | "skill" | "prompt" | "file";

const SEGMENTS: { key: KindSeg; label: string }[] = [
  { key: "all", label: "All" },
  { key: "repo", label: "Repos" },
  { key: "link", label: "Links" },
  { key: "skill", label: "Skills" },
  { key: "prompt", label: "Prompts" },
  { key: "file", label: "Files" },
];

// On phones each chip group is one edge-to-edge horizontal scroller (no scrollbar, bleeding into the
// page gutter) instead of stacking into a settings form; from `sm` up the chips wrap as before.
const CHIP_ROW =
  "flex items-center gap-1.5 overflow-x-auto -mx-4 px-4 pb-1 snap-x scroll-px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0";
const CHIP = "shrink-0 snap-start";

/** Keystrokes settle for this long before the query is written to the URL. */
const URL_SYNC_MS = 150;

function matchesSeg(i: Item, seg: KindSeg): boolean {
  if (seg === "all") return true;
  if (seg === "repo") return i.kind === "link" && i.linkType === "repo";
  if (seg === "link") return i.kind === "link" && i.linkType !== "repo";
  return i.kind === seg;
}

export function Library() {
  const items = useData((s) => s.items);
  const [params, setParams] = useSearchParams();

  const seg = (params.get("kind") as KindSeg) ?? "all";
  const stage = params.get("stage") as Stage | null;
  const tag = params.get("tag");
  const q = params.get("q") ?? "";
  const view = params.get("view") ?? "cards";

  // Functional update: the next URL is built from the live params, never from a stale closure.
  const setParam = useCallback(
    (key: string, val?: string) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (val) next.set(key, val);
          else next.delete(key);
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  // The search field is local state (router navigation is async, so binding the input straight to the
  // URL dropped keystrokes); the URL follows, debounced, and the list filters on a deferred value so
  // typing never waits on the re-render.
  const [qLocal, setQLocal] = useState(q);
  const qDeferred = useDeferredValue(qLocal);
  const synced = useRef(q);
  useEffect(() => {
    // URL changed from outside (back button, palette deep link) — adopt it.
    if (q !== synced.current) {
      synced.current = q;
      setQLocal(q);
    }
  }, [q]);
  useEffect(() => {
    if (qLocal === synced.current) return;
    const t = setTimeout(() => {
      synced.current = qLocal;
      setParam("q", qLocal || undefined);
    }, URL_SYNC_MS);
    return () => clearTimeout(t);
  }, [qLocal, setParam]);

  const base = useMemo(() => live(items), [items]);
  const tags = useMemo(() => topTags(items, 10), [items]);

  const filtered = useMemo(() => {
    const ql = qDeferred.trim().toLowerCase();
    return base
      .filter((i) => matchesSeg(i, seg))
      .filter((i) => (stage ? i.stage === stage : true))
      .filter((i) => (tag ? i.tags.includes(tag) : true))
      .filter(
        (i) =>
          !ql ||
          i.title?.toLowerCase().includes(ql) ||
          i.description?.toLowerCase().includes(ql) ||
          i.url?.toLowerCase().includes(ql) ||
          i.tags.some((t) => t.toLowerCase().includes(ql)),
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [base, seg, stage, tag, qDeferred]);

  const counts = useMemo(() => {
    const c: Record<KindSeg, number> = { all: 0, repo: 0, link: 0, skill: 0, prompt: 0, file: 0 };
    for (const i of base) {
      c.all++;
      for (const s of SEGMENTS) if (s.key !== "all" && matchesSeg(i, s.key)) c[s.key]++;
    }
    return c;
  }, [base]);

  const filtering = seg !== "all" || !!stage || !!tag || !!qDeferred.trim();
  const clearFilters = () => setParams(view === "board" ? { view } : {}, { replace: true });
  // Remount the grid (→ paging reset + reveal stagger) when the kind/stage/tag filter changes. The
  // search filters live instead, so keystrokes don't re-run the stagger.
  const gridKey = `${seg}|${stage ?? ""}|${tag ?? ""}`;

  return (
    <div>
      <PageHeader
        title="Library"
        subtitle={`${filtered.length} of ${base.length} items`}
        icon={LibraryBig}
        actions={
          <div className="inline-flex items-center gap-0.5 rounded-[var(--radius-control)] border border-border bg-surface p-0.5">
            <button
              type="button"
              onClick={() => setParam("view", undefined)}
              className={cn(
                "grid h-8 w-9 place-items-center rounded-md pressable [@media(pointer:coarse)]:h-9 [@media(pointer:coarse)]:w-10",
                view === "cards" ? "bg-primary-soft text-primary" : "text-faint hover:text-foreground",
              )}
              aria-label="Cards view"
              aria-pressed={view === "cards"}
            >
              <LayoutGrid size={16} />
            </button>
            <button
              type="button"
              onClick={() => setParam("view", "board")}
              className={cn(
                "grid h-8 w-9 place-items-center rounded-md pressable [@media(pointer:coarse)]:h-9 [@media(pointer:coarse)]:w-10",
                view === "board" ? "bg-primary-soft text-primary" : "text-faint hover:text-foreground",
              )}
              aria-label="Board view"
              aria-pressed={view === "board"}
            >
              <Columns3 size={16} />
            </button>
          </div>
        }
      />

      {/* controls */}
      <div className="mb-5 space-y-2">
        {/* segmented kind filter */}
        <div className={CHIP_ROW} role="group" aria-label="Kind">
          {SEGMENTS.map((s) => {
            const on = seg === s.key;
            return (
              <Chip
                key={s.key}
                active={on}
                aria-pressed={on}
                onClick={() => setParam("kind", s.key === "all" ? undefined : s.key)}
                className={cn(CHIP, on && "bg-foreground text-background")}
              >
                {s.label}
                <span className={cn("tabular text-[11px]", on ? "text-background/70" : "text-faint")}>{counts[s.key]}</span>
              </Chip>
            );
          })}
        </div>

        {/* search + stage */}
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="relative sm:min-w-[220px] sm:max-w-xs sm:flex-1">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
            <Input
              value={qLocal}
              onChange={(e) => setQLocal(e.target.value)}
              placeholder="Filter items…"
              aria-label="Filter items"
              className="pl-9 pr-10"
            />
            {qLocal && (
              <button
                type="button"
                onClick={() => setQLocal("")}
                className="absolute right-0 top-0 grid h-9 w-9 place-items-center rounded-md text-faint hover:text-foreground pressable"
                aria-label="Clear search"
              >
                <X size={14} />
              </button>
            )}
          </div>

          <div className={CHIP_ROW} role="group" aria-label="Stage">
            <Chip active={!stage} onClick={() => setParam("stage", undefined)} className={CHIP}>
              Any stage
            </Chip>
            {STAGES.map((s) => (
              <Chip key={s} active={stage === s} onClick={() => setParam("stage", stage === s ? undefined : s)} className={CHIP}>
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: STAGE_TONE[s].dot }} />
                {STAGE_LABEL[s]}
              </Chip>
            ))}
          </div>
        </div>

        {/* tag chips */}
        {tags.length > 0 && (
          <div className={CHIP_ROW} role="group" aria-label="Tags">
            {tag && (
              <Chip active onClick={() => setParam("tag", undefined)} className={cn(CHIP, "text-[12.5px]")}>
                #{tag} <X size={12} />
              </Chip>
            )}
            {!tag &&
              tags.map((t) => (
                <Chip key={t.tag} onClick={() => setParam("tag", t.tag)} className={cn(CHIP, "text-[12.5px]")}>
                  #{t.tag} <span className="tabular text-faint">{t.value}</span>
                </Chip>
              ))}
          </div>
        )}
      </div>

      {/* content */}
      <FadeSwap k={view}>
        {filtered.length === 0 ? (
          filtering && base.length > 0 ? (
            <EmptyState
              icon={Search}
              title="No matches"
              description="Nothing in your library matches this search or filter."
              action={
                <Button variant="outline" size="sm" onClick={clearFilters}>
                  <X size={14} /> Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState icon={LibraryBig} title="Nothing here yet" description="Paste a link in the Quick-Add bar, drop a folder, or send one to your bot." />
          )
        ) : view === "board" ? (
          <BoardView key={gridKey} items={filtered} />
        ) : (
          <ItemGrid key={gridKey} items={filtered} />
        )}
      </FadeSwap>
    </div>
  );
}

function BoardView({ items }: { items: Item[] }) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
      {STAGES.map((stage) => {
        const col = items.filter((i) => i.stage === stage);
        return (
          <div key={stage} className="flex flex-col rounded-[var(--radius-card)] border border-border bg-surface-2/50">
            <div className="flex items-center justify-between px-3 py-2.5">
              <span className="flex items-center gap-1.5 text-[13px] font-semibold">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: STAGE_TONE[stage].dot }} />
                {STAGE_LABEL[stage]}
              </span>
              <span className="tabular text-[12px] text-muted">{col.length}</span>
            </div>
            <div className="min-h-[120px] space-y-2.5 p-2.5 pt-0">
              {col.map((item, i) => (
                <ItemCard key={item.id} item={item} index={i} />
              ))}
              {col.length === 0 && <EmptyState size="sm" icon={LibraryBig} title="Nothing here" className="bg-transparent" />}
            </div>
          </div>
        );
      })}
    </div>
  );
}
