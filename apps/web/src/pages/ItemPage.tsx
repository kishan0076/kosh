import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ExternalLink, FileQuestion, PanelRight } from "lucide-react";
import { languageColor } from "@kosh/shared";
import { GitHubMark, itemIcon, TOOL_COLOR_VAR } from "@/lib/icons";
import { ago } from "@/lib/time";
import { useData } from "@/data/store";
import { useUi } from "@/data/ui";
import { Button } from "@/components/ui";
import { EmptyState } from "@/components/common";
import { PageSkeleton } from "@/components/PageSkeleton";
import { ItemDetailContent } from "@/components/detail/DetailPanel";

/** Dedicated full-page view of an item (skill / prompt / link / file) — the second viewing
 *  option alongside the drawer. Reuses the exact detail content so the two never diverge. */
export function ItemPage() {
  const { id } = useParams();
  const items = useData((s) => s.items);
  const skills = useData((s) => s.skills);
  const hydrated = useData((s) => s.hydrated);
  const openItem = useUi((s) => s.openItem);
  const navigate = useNavigate();

  const item = id ? items.find((i) => i.id === id) : undefined;

  if (!item) {
    // A deep link before the vault has loaded keeps the page's silhouette; once it has (or the API is
    // down), say so instead of leaving the shell blank.
    if (!hydrated) return <PageSkeleton variant="detail" />;
    return (
      <EmptyState
        icon={FileQuestion}
        title="Item not found"
        description="It may have been deleted, or the link is wrong."
        action={
          <Button variant="primary" onClick={() => navigate("/library")}>
            <ArrowLeft size={15} /> Back to Library
          </Button>
        }
      />
    );
  }

  const skill = item.skillId ? skills.find((s) => s.id === item.skillId) : undefined;
  const Icon = itemIcon(item);
  const edge =
    item.kind === "skill"
      ? TOOL_COLOR_VAR[skill?.tools[0] ?? "generic"]
      : item.github?.language
        ? languageColor(item.github.language)
        : "var(--primary)";

  return (
    <div className="mx-auto max-w-3xl">
      {/* toolbar */}
      <div className="mb-4 flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
          <ArrowLeft size={16} /> Back
        </Button>
        <div className="flex min-w-0 items-center gap-2">
          {item.url && (
            <a href={item.url} target="_blank" rel="noreferrer noopener" className="shrink-0">
              <Button variant="outline" size="sm">
                <ExternalLink size={15} /> Open original
              </Button>
            </a>
          )}
          {/* The drawer is full-screen on phones and shows this same content — desktop only. */}
          <Button variant="ghost" size="sm" className="hidden lg:inline-flex" onClick={() => { navigate(-1); openItem(item.id); }}>
            <PanelRight size={15} /> Open in drawer
          </Button>
        </div>
      </div>

      {/* detail card */}
      <div className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
        <div className="flex items-start gap-2.5 border-b border-border px-4 py-3.5">
          <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg" style={{ backgroundColor: `color-mix(in oklab, ${edge} 15%, transparent)`, color: edge }}>
            {item.linkType === "repo" ? <GitHubMark size={17} /> : <Icon size={17} />}
          </span>
          <div className="min-w-0 flex-1">
            {/* The full title is the point of this page: wrap to two lines rather than ellipsize. */}
            <h1 className="line-clamp-2 break-words text-lg font-semibold leading-snug [overflow-wrap:anywhere]">{item.title}</h1>
            <div className="text-[12px] text-muted">Updated {ago(item.updatedAt)}</div>
          </div>
        </div>
        <ItemDetailContent item={item} />
      </div>
    </div>
  );
}
