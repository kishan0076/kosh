import { useEffect, useMemo, useState } from "react";
import { Blocks, Check } from "lucide-react";
import { TOOL_LABEL, TOOLS, lintSkill, parseFrontmatter, scanSkill, type Tool } from "@kosh/shared";
import { cn } from "@/lib/cn";
import { useData } from "@/data/store";
import { useUi } from "@/data/ui";
import { Button, Chip } from "../ui";
import { Modal } from "../overlays";
import { Markdown } from "../markdown";

const SAMPLE = `---
name: my-skill
description: What this does. Use when the user asks to …
license: MIT
---

# my-skill

Explain what the skill does and when to use it.
`;

type Tab = "lint" | "scan" | "preview";

/** In-app skill editor (§6.8): edit SKILL.md with live lint + scan + rendered preview;
 *  Save writes a new version. Reachable from "New skill" and a skill's "Edit" action. */
export function SkillEditor() {
  const editor = useUi((s) => s.skillEditor);
  const close = useUi((s) => s.closeSkillEditor);
  const openItem = useUi((s) => s.openItem);
  const toast = useUi((s) => s.toast);
  const skills = useData((s) => s.skills);
  const saveSkillEdit = useData((s) => s.saveSkillEdit);

  const existing = editor?.skillId ? skills.find((s) => s.id === editor.skillId) : undefined;
  const [text, setText] = useState(SAMPLE);
  const [tools, setTools] = useState<Tool[]>(["claude"]);
  const [note, setNote] = useState("");
  const [tab, setTab] = useState<Tab>("lint");

  // Seed the textarea when the dialog opens (existing SKILL.md, or the sample for a new skill).
  useEffect(() => {
    if (!editor) return;
    if (existing) {
      const v = existing.versions.at(-1);
      const entry = v?.files.find((f) => /^SKILL\.md$/i.test(f.path)) ?? v?.files[0];
      setText(entry?.content ?? SAMPLE);
      setTools(existing.tools.length ? existing.tools : ["claude"]);
      setNote("");
    } else {
      setText(SAMPLE);
      setTools(["claude"]);
      setNote("");
    }
    setTab("lint");
  }, [editor, existing]);

  const { data: fm, content: body } = useMemo(() => parseFrontmatter(text), [text]);
  const name = (fm.name as string) ?? "";
  const lint = useMemo(() => lintSkill({ frontmatter: fm, body, files: ["SKILL.md"], folderName: name }), [fm, body, name]);
  const scan = useMemo(() => scanSkill(new Map([["SKILL.md", text]])), [text]);

  const save = () => {
    const item = saveSkillEdit({ skillId: existing?.id, name, content: text, tools, note: note.trim() || undefined });
    toast({ message: existing ? `Saved v${existing.latest + 1}` : "Skill saved", description: name, tone: "ok" });
    close();
    if (item) openItem(item.id);
  };

  const toggleTool = (t: Tool) => setTools((ts) => (ts.includes(t) ? ts.filter((x) => x !== t) : [...ts, t]));

  return (
    <Modal open={!!editor} onClose={close} className="max-w-3xl" labelledBy="skill-editor-title">
      <div className="flex items-center gap-2 border-b border-border px-5 py-4">
        <Blocks size={18} className="text-tool-claude" />
        <h2 id="skill-editor-title" className="text-base font-semibold">
          {existing ? `Edit ${existing.name}` : "New skill"}
        </h2>
        {existing && <span className="text-[12px] text-muted">→ saves v{existing.latest + 1}</span>}
      </div>

      <div className="grid gap-4 p-5 md:grid-cols-[1.4fr_1fr]">
        <div>
          <label htmlFor="skill-editor-md" className="mb-1.5 block text-[12px] font-medium text-muted">
            SKILL.md
          </label>
          <textarea
            id="skill-editor-md"
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
            rows={17}
            className="w-full resize-y rounded-[var(--radius-control)] border border-border bg-surface-2 p-3 font-mono text-[12.5px] leading-relaxed outline-none focus:border-primary focus:ring-focus"
          />
          <div className="mt-3">
            <div className="mb-1.5 text-[12px] font-medium text-muted">Tools</div>
            <div className="flex flex-wrap gap-1.5">
              {TOOLS.filter((t) => t !== "generic").map((t) => (
                <Chip key={t} active={tools.includes(t)} onClick={() => toggleTool(t)}>
                  {tools.includes(t) && <Check size={12} />} {TOOL_LABEL[t]}
                </Chip>
              ))}
            </div>
          </div>
          <div className="mt-3">
            <label htmlFor="skill-editor-note" className="mb-1.5 block text-[12px] font-medium text-muted">
              Changelog {existing ? "" : "(optional)"}
            </label>
            <input
              id="skill-editor-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={existing ? "What changed in this version?" : "First cut"}
              className="w-full rounded-[var(--radius-control)] border border-border bg-surface px-3 py-2 text-[13px] outline-none focus:border-primary focus:ring-focus"
            />
          </div>
        </div>

        {/* side panel: lint / scan / preview */}
        <div className="min-w-0">
          <div className="mb-2 flex gap-1">
            {(["lint", "scan", "preview"] as Tab[]).map((t) => (
              <button
                key={t}
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
            <div className="max-h-[360px] overflow-y-auto rounded-[var(--radius-control)] border border-border bg-surface-2 p-3">
              <Markdown>{body}</Markdown>
            </div>
          )}
        </div>
      </div>

      <div className="flex justify-end gap-2 border-t border-border px-5 py-3.5">
        <Button variant="ghost" onClick={close}>
          Cancel
        </Button>
        <Button variant="primary" onClick={save} disabled={!lint.ok}>
          {existing ? "Save new version" : "Save skill"}
        </Button>
      </div>
    </Modal>
  );
}
