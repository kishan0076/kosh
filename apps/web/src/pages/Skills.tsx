import { useCallback, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Blocks, Plus } from "lucide-react";
import { TOOL_LABEL, TOOLS, TRUST_LABEL, type Tool, type Trust } from "@kosh/shared";
import { useData } from "@/data/store";
import { live } from "@/data/selectors";
import { EmptyState, PageHeader } from "@/components/common";
import { ItemGrid } from "@/components/ItemGrid";
import { Button, Chip } from "@/components/ui";

const TRUSTS: Trust[] = ["mine", "reviewed", "unreviewed"];

// On phones each chip group is one edge-to-edge horizontal scroller (no scrollbar, bleeding into the
// page gutter) so the first card stays above the fold; from `sm` up the chips wrap as before.
const CHIP_ROW =
  "flex items-center gap-1.5 overflow-x-auto -mx-4 px-4 pb-1 snap-x scroll-px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0";
const CHIP = "shrink-0 snap-start";

export function Skills() {
  const items = useData((s) => s.items);
  const skills = useData((s) => s.skills);
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const tool = params.get("tool") as Tool | null;
  const trust = params.get("trust") as Trust | null;

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

  const skillItems = useMemo(() => {
    return live(items)
      .filter((i) => i.kind === "skill")
      .filter((i) => {
        const sk = skills.find((s) => s.id === i.skillId);
        if (!sk) return false;
        if (tool && !sk.tools.includes(tool)) return false;
        if (trust && sk.trust !== trust) return false;
        return true;
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [items, skills, tool, trust]);

  return (
    <div>
      <PageHeader
        title="Skills"
        subtitle={`${skillItems.length} skills · installable into Claude, Codex, Cursor & more`}
        icon={Blocks}
        actions={
          <Button variant="primary" onClick={() => navigate("/skills/new")}>
            <Plus size={16} /> New skill
          </Button>
        }
      />

      <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <div className={CHIP_ROW} role="group" aria-label="Tool">
          <Chip active={!tool} onClick={() => setParam("tool", undefined)} className={CHIP}>
            All tools
          </Chip>
          {TOOLS.filter((t) => t !== "generic").map((t) => (
            <Chip key={t} active={tool === t} onClick={() => setParam("tool", tool === t ? undefined : t)} className={CHIP}>
              {TOOL_LABEL[t]}
            </Chip>
          ))}
        </div>
        {/* Only meaningful when both groups share a row. */}
        <span className="mx-1 hidden h-5 w-px bg-border sm:block" aria-hidden />
        <div className={CHIP_ROW} role="group" aria-label="Trust">
          <Chip active={!trust} onClick={() => setParam("trust", undefined)} className={CHIP}>
            Any trust
          </Chip>
          {TRUSTS.map((t) => (
            <Chip key={t} active={trust === t} onClick={() => setParam("trust", trust === t ? undefined : t)} className={CHIP}>
              {TRUST_LABEL[t]}
            </Chip>
          ))}
        </div>
      </div>

      {skillItems.length === 0 ? (
        <EmptyState
          icon={Blocks}
          title={tool || trust ? "No skills match" : "No skills yet"}
          description={
            tool || trust
              ? "Nothing matches this tool/trust filter."
              : "Drop a folder with a SKILL.md, paste one below, run kosh import-local, or send one to your Telegram bot."
          }
          action={
            tool || trust ? (
              <Button variant="outline" size="sm" onClick={() => setParams({}, { replace: true })}>
                Clear filters
              </Button>
            ) : (
              <Button variant="primary" onClick={() => navigate("/skills/new")}>
                <Plus size={16} /> New skill
              </Button>
            )
          }
        />
      ) : (
        // Keyed by the filter so a change remounts the grid → paging reset + reveal stagger.
        <ItemGrid key={`${tool ?? ""}|${trust ?? ""}`} items={skillItems} />
      )}
    </div>
  );
}
