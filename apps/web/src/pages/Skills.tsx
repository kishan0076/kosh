import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Blocks, Plus } from "lucide-react";
import {
  TOOL_LABEL,
  TOOLS,
  TRUST_LABEL,
  lintSkill,
  parseFrontmatter,
  scanSkill,
  type Tool,
  type Trust,
} from "@kosh/shared";
import { useData } from "@/data/store";
import { useUi } from "@/data/ui";
import { live } from "@/data/selectors";
import { EmptyState, PageHeader } from "@/components/common";
import { ItemGrid } from "@/components/ItemGrid";
import { Button, Chip } from "@/components/ui";
import { Modal } from "@/components/overlays";

const TRUSTS: Trust[] = ["mine", "reviewed", "unreviewed"];

export function Skills() {
  const items = useData((s) => s.items);
  const skills = useData((s) => s.skills);
  const [params, setParams] = useSearchParams();
  const [newOpen, setNewOpen] = useState(params.get("new") === "1");

  const tool = params.get("tool") as Tool | null;
  const trust = params.get("trust") as Trust | null;

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
          <Button variant="primary" onClick={() => setNewOpen(true)}>
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
            <Button variant="primary" onClick={() => setNewOpen(true)}>
              <Plus size={16} /> New skill
            </Button>
          }
        />
      ) : (
        <ItemGrid items={skillItems} />
      )}

      <NewSkillModal open={newOpen} onClose={() => { setNewOpen(false); setParam("new", undefined); }} />
    </div>
  );
}

const SAMPLE = `---
name: my-skill
description: What this does. Use when the user asks to …
license: MIT
---

# my-skill

Explain what the skill does and when to use it.
`;

function NewSkillModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const finalizeDrafts = useData((s) => s.finalizeDrafts);
  const toast = useUi((s) => s.toast);
  const openItem = useUi((s) => s.openItem);
  const [text, setText] = useState(SAMPLE);

  const { data: fm, content } = parseFrontmatter(text);
  const name = (fm.name as string) ?? "";
  const lint = lintSkill({ frontmatter: fm, body: content, files: ["SKILL.md"], folderName: name });
  const scan = scanSkill(new Map([["SKILL.md", text]]));

  const save = () => {
    const [item] = finalizeDrafts(
      [{ kind: "skill", name: name || "new-skill", files: [{ path: "SKILL.md", size: text.length, mime: "text/markdown", content: text }], lint, scan }],
      "web",
    );
    toast({ message: "Skill saved", description: name, tone: "ok" });
    onClose();
    if (item) openItem(item.id);
  };

  return (
    <Modal open={open} onClose={onClose} className="max-w-3xl">
      <div className="flex items-center gap-2 border-b border-border px-5 py-4">
        <Blocks size={18} className="text-tool-claude" />
        <h2 className="text-base font-semibold">New skill</h2>
      </div>
      <div className="grid gap-4 p-5 md:grid-cols-[1.4fr_1fr]">
        <div>
          <label className="mb-1.5 block text-[12px] font-medium text-muted">SKILL.md</label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
            rows={16}
            className="w-full resize-y rounded-[var(--radius-control)] border border-border bg-surface-2 p-3 font-mono text-[12.5px] leading-relaxed outline-none focus:border-primary focus:ring-focus"
          />
        </div>
        <div className="space-y-3">
          <div>
            <div className="mb-1.5 text-[12px] font-medium text-muted">Lint</div>
            {lint.ok && lint.warnings.length === 0 ? (
              <div className="rounded-lg border border-ok/30 bg-ok-soft px-3 py-2 text-[13px] text-ok">✓ Looks good</div>
            ) : (
              <div className="space-y-1">
                {lint.errors.map((e, i) => (
                  <div key={`e${i}`} className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-1.5 text-[12px] text-danger">✗ {e}</div>
                ))}
                {lint.warnings.map((w, i) => (
                  <div key={`w${i}`} className="rounded-lg border border-warn/30 bg-warn-soft px-3 py-1.5 text-[12px] text-warn">⚠ {w}</div>
                ))}
              </div>
            )}
          </div>
          <div>
            <div className="mb-1.5 text-[12px] font-medium text-muted">Security scan</div>
            {scan.risky ? (
              <div className="space-y-1">
                {scan.findings.map((f, i) => (
                  <div key={i} className="rounded-lg border border-warn/30 bg-warn-soft px-3 py-1.5 text-[12px] text-warn">⚠ {f.text}</div>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-ok/30 bg-ok-soft px-3 py-2 text-[13px] text-ok">✓ Clean</div>
            )}
          </div>
        </div>
      </div>
      <div className="flex justify-end gap-2 border-t border-border px-5 py-3.5">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" onClick={save} disabled={!lint.ok}>
          Save skill
        </Button>
      </div>
    </Modal>
  );
}
