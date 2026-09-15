import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ExternalLink, PanelRight } from "lucide-react";
import { languageColor } from "@kosh/shared";
import { GitHubMark, itemIcon, TOOL_COLOR_VAR } from "@/lib/icons";
import { ago } from "@/lib/time";
import { useData } from "@/data/store";
import { useUi } from "@/data/ui";
import { Button } from "@/components/ui";
import { ItemDetailContent } from "@/components/detail/DetailPanel";

/** Dedicated full-page view of an item (skill / prompt / link / file) — the second viewing
 *  option alongside the drawer. Reuses the exact detail content so the two never diverge. */
export function ItemPage() {
  const { id } = useParams();
  const items = useData((s) => s.items);
  const skills = useData((s) => s.skills);
  const openItem = useUi((s) => s.openItem);
  const navigate = useNavigate();

  const item = id ? items.find((i) => i.id === id) : undefined;

  // A bad /items/:id URL (or a purged item) bounces back once the store has loaded.
  useEffect(() => {
    if (id && items.length > 0 && !item) navigate("/library", { replace: true });
  }, [id, items.length, item, navigate]);

  if (!item) return null;

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
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
          <ArrowLeft size={16} /> Back
        </Button>
        <div className="ml-auto flex items-center gap-2">
          {item.url && (
            <a href={item.url} target="_blank" rel="noreferrer noopener">
              <Button variant="outline" size="sm">
                <ExternalLink size={15} /> Open original
              </Button>
            </a>
          )}
          <Button variant="ghost" size="sm" onClick={() => { navigate(-1); openItem(item.id); }}>
            <PanelRight size={15} /> Open in drawer
          </Button>
        </div>
      </div>

      {/* detail card */}
      <div className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
        <div className="flex items-center gap-2.5 border-b border-border px-4 py-3.5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg" style={{ backgroundColor: `color-mix(in oklab, ${edge} 15%, transparent)`, color: edge }}>
            {item.linkType === "repo" ? <GitHubMark size={17} /> : <Icon size={17} />}
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-semibold">{item.title}</h1>
            <div className="text-[12px] text-muted">Updated {ago(item.updatedAt)}</div>
          </div>
        </div>
        <ItemDetailContent item={item} />
      </div>
    </div>
  );
}
