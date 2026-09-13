import { useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { Blocks, Plus } from "lucide-react";
import { TOOL_LABEL, TOOLS, TRUST_LABEL, type Tool, type Trust } from "@kosh/shared";
import { useData } from "@/data/store";
import { useUi } from "@/data/ui";
import { live } from "@/data/selectors";
import { EmptyState, PageHeader } from "@/components/common";
import { ItemGrid } from "@/components/ItemGrid";
import { Button, Chip } from "@/components/ui";

const TRUSTS: Trust[] = ["mine", "reviewed", "unreviewed"];

export function Skills() {
  const items = useData((s) => s.items);
  const skills = useData((s) => s.skills);
  const openSkillEditor = useUi((s) => s.openSkillEditor);
  const [params, setParams] = useSearchParams();

  const tool = params.get("tool") as Tool | null;
  const trust = params.get("trust") as Trust | null;

  // Support the ?new=1 deep link (e.g. from the command palette) to open the editor.
  useEffect(() => {
    if (params.get("new") === "1") {
      openSkillEditor();
      const next = new URLSearchParams(params);
      next.delete("new");
      setParams(next, { replace: true });
    }
  }, [params, openSkillEditor, setParams]);

  const setParam = (key: string, val?: string) => {
    const next = new URLSearchParams(params);
    if (val) next.set(key, val);
    else next.delete(key);
    setParams(next, { replace: true });
  };

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
          <Button variant="primary" onClick={() => openSkillEditor()}>
            <Plus size={16} /> New skill
          </Button>
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <Chip active={!tool} onClick={() => setParam("tool", undefined)}>
            All tools
          </Chip>
          {TOOLS.filter((t) => t !== "generic").map((t) => (
            <Chip key={t} active={tool === t} onClick={() => setParam("tool", tool === t ? undefined : t)}>
              {TOOL_LABEL[t]}
            </Chip>
          ))}
        </div>
        <span className="mx-1 h-5 w-px bg-border" />
        <div className="flex flex-wrap items-center gap-1.5">
          <Chip active={!trust} onClick={() => setParam("trust", undefined)}>
            Any trust
          </Chip>
          {TRUSTS.map((t) => (
            <Chip key={t} active={trust === t} onClick={() => setParam("trust", trust === t ? undefined : t)}>
              {TRUST_LABEL[t]}
            </Chip>
          ))}
        </div>
      </div>

      {skillItems.length === 0 ? (
        <EmptyState
          icon={Blocks}
          title="No skills yet"
          description="Drop a folder with a SKILL.md, paste one below, run kosh import-local, or send one to your Telegram bot."
          action={
            <Button variant="primary" onClick={() => openSkillEditor()}>
              <Plus size={16} /> New skill
            </Button>
          }
        />
      ) : (
        <ItemGrid items={skillItems} />
      )}
    </div>
  );
}
