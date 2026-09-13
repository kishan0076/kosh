import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { Columns3, LayoutGrid, LibraryBig, Search, X } from "lucide-react";
import { STAGE_LABEL, STAGES, type Item, type Stage } from "@kosh/shared";
import { useData } from "@/data/store";
import { live, topTags } from "@/data/selectors";
import { cn } from "@/lib/cn";
import { EmptyState, PageHeader, STAGE_TONE } from "@/components/common";
import { ItemGrid } from "@/components/ItemGrid";
import { ItemCard } from "@/components/cards/ItemCard";
import { Chip } from "@/components/ui";

type KindSeg = "all" | "repo" | "link" | "skill" | "prompt" | "file";

const SEGMENTS: { key: KindSeg; label: string }[] = [
  { key: "all", label: "All" },
  { key: "repo", label: "Repos" },
  { key: "link", label: "Links" },
  { key: "skill", label: "Skills" },
  { key: "prompt", label: "Prompts" },
  { key: "file", label: "Files" },
];

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

  const setParam = (key: string, val?: string) => {
    const next = new URLSearchParams(params);
    if (val) next.set(key, val);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const base = useMemo(() => live(items), [items]);
  const tags = useMemo(() => topTags(items, 10), [items]);

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
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
  }, [base, seg, stage, tag, q]);

  const counts = useMemo(() => {
    const c: Record<KindSeg, number> = { all: 0, repo: 0, link: 0, skill: 0, prompt: 0, file: 0 };
    for (const i of base) {
      c.all++;
      for (const s of SEGMENTS) if (s.key !== "all" && matchesSeg(i, s.key)) c[s.key]++;
    }
    return c;
  }, [base]);

  return (
    <div>
      <PageHeader
        title="Library"
        subtitle={`${filtered.length} of ${base.length} items`}
        icon={LibraryBig}
        actions={
          <div className="inline-flex items-center gap-0.5 rounded-[var(--radius-control)] border border-border bg-surface p-0.5">
            <button
              onClick={() => setParam("view", undefined)}
              className={cn("grid h-8 w-9 place-items-center rounded-md", view === "cards" ? "bg-primary-soft text-primary" : "text-faint hover:text-foreground")}
              aria-label="Cards view"
            >
              <LayoutGrid size={16} />
            </button>
            <button
              onClick={() => setParam("view", "board")}
              className={cn("grid h-8 w-9 place-items-center rounded-md", view === "board" ? "bg-primary-soft text-primary" : "text-faint hover:text-foreground")}
              aria-label="Board view"
            >
              <Columns3 size={16} />
            </button>
          </div>
        }
      />

      {/* controls */}
      <div className="mb-5 space-y-3">
        {/* segmented kind filter */}
        <div className="flex flex-wrap items-center gap-1.5">
          {SEGMENTS.map((s) => (
            <button
              key={s.key}
              onClick={() => setParam("kind", s.key === "all" ? undefined : s.key)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 h-8 text-[13px] font-medium transition-colors",
                seg === s.key ? "border-transparent bg-foreground text-background" : "border-border bg-surface text-muted hover:bg-surface-2 hover:text-foreground",
              )}
            >
              {s.label}
              <span className={cn("tabular text-[11px]", seg === s.key ? "text-background/70" : "text-faint")}>{counts[s.key]}</span>
            </button>
          ))}
        </div>

        {/* search + stage + tags */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex h-9 min-w-[220px] flex-1 items-center gap-2 rounded-[var(--radius-control)] border border-border bg-surface px-3 sm:max-w-xs">
            <Search size={15} className="text-faint" />
            <input
              value={q}
              onChange={(e) => setParam("q", e.target.value || undefined)}
              placeholder="Filter items…"
              className="h-full flex-1 bg-transparent text-[13.5px] outline-none placeholder:text-faint"
            />
            {q && (
              <button onClick={() => setParam("q", undefined)} className="text-faint hover:text-foreground">
                <X size={14} />
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <Chip active={!stage} onClick={() => setParam("stage", undefined)}>
              Any stage
            </Chip>
            {STAGES.map((s) => (
              <Chip key={s} active={stage === s} onClick={() => setParam("stage", stage === s ? undefined : s)}>
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: STAGE_TONE[s].dot }} />
                {STAGE_LABEL[s]}
              </Chip>
            ))}
          </div>
        </div>

        {/* tag chips */}
        {tags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {tag && (
              <Chip active onClick={() => setParam("tag", undefined)}>
                #{tag} <X size={12} />
              </Chip>
            )}
            {!tag &&
              tags.map((t) => (
                <button
                  key={t.tag}
                  onClick={() => setParam("tag", t.tag)}
                  className="rounded-full border border-border bg-surface px-2.5 py-1 text-[12px] text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
                >
                  #{t.tag} <span className="text-faint">{t.value}</span>
                </button>
              ))}
          </div>
        )}
      </div>

      {/* content */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={LibraryBig}
          title="Nothing here yet"
          description="Paste a link in the Quick-Add bar, drop a folder, or adjust your filters."
        />
      ) : view === "board" ? (
        <BoardView items={filtered} />
      ) : (
        <ItemGrid items={filtered} />
      )}
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
              {col.length === 0 && <div className="rounded-lg border border-dashed border-border py-6 text-center text-[12px] text-faint">Empty</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
