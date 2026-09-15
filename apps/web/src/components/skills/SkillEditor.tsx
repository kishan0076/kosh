import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Blocks, Check } from "lucide-react";
import { TOOL_LABEL, TOOLS, lintSkill, parseFrontmatter, scanSkill, type Tool } from "@kosh/shared";
import { cn } from "@/lib/cn";
import { useData } from "@/data/store";
import { useUi } from "@/data/ui";
import { Button, Chip } from "../ui";
import { Markdown } from "../markdown";
import { PageHeader } from "../common";

const SAMPLE = `---
name: my-skill
description: What this does. Use when the user asks to …
license: MIT
---

# my-skill

Explain what the skill does and when to use it.
`;

type Tab = "lint" | "scan" | "preview";

/** Dedicated skill editor page (§6.8): /skills/new and /skills/:id/edit.
 *  Edit SKILL.md with live lint + scan + rendered preview; Save writes a new version. */
export function SkillEditor() {
  const { id } = useParams(); // present → editing an existing skill
  const navigate = useNavigate();
  const skills = useData((s) => s.skills);
  const saveSkillEdit = useData((s) => s.saveSkillEdit);
  const openItem = useUi((s) => s.openItem);
  const toast = useUi((s) => s.toast);

  const existing = id ? skills.find((s) => s.id === id) : undefined;
  const [text, setText] = useState(SAMPLE);
  const [tools, setTools] = useState<Tool[]>(["claude"]);
  const [note, setNote] = useState("");
  const [tab, setTab] = useState<Tab>("lint");
  const [seeded, setSeeded] = useState(false);

  // Seed once — from the existing SKILL.md when editing, or the sample for a new skill.
  useEffect(() => {
    if (seeded || !id) {
      if (!id && !seeded) setSeeded(true);
      return;
    }
    if (!existing) return; // wait for the store to hydrate
    const v = existing.versions.at(-1);
    const entry = v?.files.find((f) => /^SKILL\.md$/i.test(f.path)) ?? v?.files[0];
    setText(entry?.content ?? SAMPLE);
    setTools(existing.tools.length ? existing.tools : ["claude"]);
    setSeeded(true);
  }, [id, existing, seeded]);

  // A bad /skills/:id/edit URL (or a deleted skill) bounces back once the store is loaded.
  useEffect(() => {
    if (id && skills.length > 0 && !existing) navigate("/skills", { replace: true });
  }, [id, skills.length, existing, navigate]);

  const { data: fm, content: body } = useMemo(() => parseFrontmatter(text), [text]);
  const name = (fm.name as string) ?? "";
  const lint = useMemo(() => lintSkill({ frontmatter: fm, body, files: ["SKILL.md"], folderName: name }), [fm, body, name]);
  const scan = useMemo(() => scanSkill(new Map([["SKILL.md", text]])), [text]);

  const save = () => {
    const item = saveSkillEdit({ skillId: existing?.id, name, content: text, tools, note: note.trim() || undefined });
    toast({ message: existing ? `Saved v${existing.latest + 1}` : "Skill saved", description: name, tone: "ok" });
    navigate("/skills");
    if (item) openItem(item.id);
  };
  const toggleTool = (t: Tool) => setTools((ts) => (ts.includes(t) ? ts.filter((x) => x !== t) : [...ts, t]));

  return (
    <div className="pb-8">
      <PageHeader
        title={existing ? `Edit ${existing.name}` : "New skill"}
        subtitle={existing ? `Saves version ${existing.latest + 1}` : "Author a SKILL.md — it's linted and security-scanned live."}
        icon={Blocks}
        actions={
          <>
            <Button variant="ghost" onClick={() => navigate("/skills")}>
              Cancel
            </Button>
            <Button variant="primary" onClick={save} disabled={!lint.ok}>
              {existing ? "Save new version" : "Save skill"}
            </Button>
          </>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[1.7fr_1fr]">
        {/* editor */}
        <div>
          <label htmlFor="skill-md" className="mb-1.5 block text-[12px] font-medium text-muted">
            SKILL.md
          </label>
          <textarea
            id="skill-md"
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
            rows={20}
            className="w-full resize-y rounded-[var(--radius-control)] border border-border bg-surface-2 p-3 font-mono text-[12.5px] leading-relaxed outline-none focus:border-primary focus:ring-focus"
          />
          <div className="mt-4">
            <div className="mb-1.5 text-[12px] font-medium text-muted">Tools</div>
            <div className="flex flex-wrap gap-1.5">
              {TOOLS.filter((t) => t !== "generic").map((t) => (
                <Chip key={t} active={tools.includes(t)} onClick={() => toggleTool(t)}>
                  {tools.includes(t) && <Check size={12} />} {TOOL_LABEL[t]}
                </Chip>
              ))}
            </div>
          </div>
          <div className="mt-4 max-w-md">
            <label htmlFor="skill-note" className="mb-1.5 block text-[12px] font-medium text-muted">
              Changelog {existing ? "" : "(optional)"}
            </label>
            <input
              id="skill-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={existing ? "What changed in this version?" : "First cut"}
              className="w-full rounded-[var(--radius-control)] border border-border bg-surface px-3 py-2 text-[13px] outline-none focus:border-primary focus:ring-focus"
            />
          </div>
        </div>

        {/* lint / scan / preview */}
        <div className="min-w-0">
          <div role="tablist" aria-label="Skill checks" className="mb-2 flex gap-1">
            {(["lint", "scan", "preview"] as Tab[]).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-[12px] font-medium capitalize transition-colors",
                  tab === t ? "bg-primary-soft text-primary" : "text-muted hover:bg-surface-2",
                )}
              >
                {t}
              </button>
            ))}
          </div>

          {tab === "lint" && (
            <div className="space-y-1">
              {lint.ok && lint.warnings.length === 0 ? (
                <div className="rounded-lg border border-ok/30 bg-ok-soft px-3 py-2 text-[13px] text-ok">✓ Looks good</div>
              ) : (
                <>
                  {lint.errors.map((e, i) => (
                    <div key={`e${i}`} className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-1.5 text-[12px] text-danger">✗ {e}</div>
                  ))}
                  {lint.warnings.map((w, i) => (
                    <div key={`w${i}`} className="rounded-lg border border-warn/30 bg-warn-soft px-3 py-1.5 text-[12px] text-warn">⚠ {w}</div>
                  ))}
                </>
              )}
            </div>
          )}

          {tab === "scan" && (
            <div className="space-y-1">
              {scan.risky ? (
                scan.findings.map((f, i) => (
                  <div key={i} className="rounded-lg border border-warn/30 bg-warn-soft px-3 py-1.5 text-[12px] text-warn">⚠ {f.text}</div>
                ))
              ) : (
                <div className="rounded-lg border border-ok/30 bg-ok-soft px-3 py-2 text-[13px] text-ok">✓ Clean</div>
              )}
            </div>
          )}

          {tab === "preview" && (
            <div className="rounded-[var(--radius-control)] border border-border bg-surface-2 p-3">
              <Markdown>{body}</Markdown>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
