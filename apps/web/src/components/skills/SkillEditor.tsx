import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Blocks, Check } from "lucide-react";
import { TOOL_LABEL, TOOLS, lintSkill, parseFrontmatter, scanSkill, type Tool } from "@kosh/shared";
import { cn } from "@/lib/cn";
import { useReduced } from "@/lib/motion";
import { useData } from "@/data/store";
import { useUi } from "@/data/ui";
import { Badge, Button, Chip, Input, Textarea } from "../ui";
import { FadeSwap } from "../motion";
import { Markdown } from "../markdown";
import { PageHeader } from "../common";
import { useBottomStack } from "../Toaster";

const SAMPLE = `---
name: my-skill
description: What this does. Use when the user asks to …
license: MIT
---

# my-skill

Explain what the skill does and when to use it.
`;

type Tab = "lint" | "scan" | "preview";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
// Badge-sized pills with a 36px hit box (40px on touch) — the badge is the label, the button is the target.
const STRIP_BTN = "inline-flex min-h-9 items-center rounded-full pressable [@media(pointer:coarse)]:min-h-10";

/** Dedicated skill editor page (§6.8): /skills/new and /skills/:id/edit.
 *  Edit SKILL.md with live lint + scan + rendered preview; Save writes a new version. */
export function SkillEditor() {
  const { id } = useParams(); // present → editing an existing skill
  const navigate = useNavigate();
  const skills = useData((s) => s.skills);
  const saveSkillEdit = useData((s) => s.saveSkillEdit);
  const openItem = useUi((s) => s.openItem);
  const toast = useUi((s) => s.toast);
  const reduced = useReduced();

  const existing = id ? skills.find((s) => s.id === id) : undefined;
  const [text, setText] = useState(SAMPLE);
  const [tools, setTools] = useState<Tool[]>(["claude"]);
  const [note, setNote] = useState("");
  const [tab, setTab] = useState<Tab>("lint");
  const [seeded, setSeeded] = useState(false);
  const checksRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const bounced = useRef(false);

  // Publish the sticky save-bar's height as `--bottom-stack` so toasts rise above it (and the scroll
  // container can pad its bottom by the same amount to keep the caret clear of the bar).
  useBottomStack(barRef);

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

  // A bad /skills/:id/edit URL (or a deleted skill) bounces back once the store is loaded — with a
  // word about why, so the catalog doesn't just silently appear.
  useEffect(() => {
    if (bounced.current) return; // once only — StrictMode double-invokes, and `navigate`'s identity
    if (id && skills.length > 0 && !existing) {
      bounced.current = true; // …changes with location, so the effect can re-run and stack toasts.
      toast({ message: "Skill not found", description: "It may have been deleted.", tone: "warn" });
      navigate("/skills", { replace: true });
    }
  }, [id, skills.length, existing, navigate, toast]);

  const { data: fm, content: body } = useMemo(() => parseFrontmatter(text), [text]);
  const name = (fm.name as string) ?? "";
  const lint = useMemo(() => lintSkill({ frontmatter: fm, body, files: ["SKILL.md"], folderName: name }), [fm, body, name]);
  const scan = useMemo(() => scanSkill(new Map([["SKILL.md", text]])), [text]);
  const nErrors = lint.errors.length;
  const nWarnings = lint.warnings.length;
  const nFindings = scan.risky ? scan.findings.length : 0;

  // Save is optimistic (the store writes the version locally and syncs after), so no loading state.
  const save = () => {
    const item = saveSkillEdit({ skillId: existing?.id, name, content: text, tools, note: note.trim() || undefined });
    toast({ message: existing ? `Saved v${existing.latest + 1}` : "Skill saved", description: name, tone: "ok" });
    navigate("/skills");
    if (item) openItem(item.id);
  };
  const toggleTool = (t: Tool) => setTools((ts) => (ts.includes(t) ? ts.filter((x) => x !== t) : [...ts, t]));
  // On phones the checks panel stacks under the editor; the status strip jumps to it.
  const jumpToChecks = (t: Tab) => {
    setTab(t);
    checksRef.current?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  };

  const saveLabel = existing ? "Save new version" : "Save skill";
  const actions = (
    <>
      <Button variant="ghost" onClick={() => navigate("/skills")}>
        Cancel
      </Button>
      <Button variant="primary" onClick={save} disabled={!lint.ok}>
        {saveLabel}
      </Button>
    </>
  );

  return (
    <div className="pb-2 lg:pb-8">
      <PageHeader
        title={existing ? `Edit ${existing.name}` : "New skill"}
        subtitle={existing ? `Saves version ${existing.latest + 1}` : "Author a SKILL.md — it's linted and security-scanned live."}
        icon={Blocks}
        // Under lg the same actions live in the sticky bar at the bottom (reachable with the keyboard open).
        actions={<div className="hidden items-center gap-2 lg:flex">{actions}</div>}
      />

      <div className="grid gap-5 lg:grid-cols-[1.7fr_1fr]">
        {/* editor */}
        <div>
          <label htmlFor="skill-md" className="mb-1.5 block text-[12px] font-medium text-muted">
            SKILL.md
          </label>
          <Textarea
            id="skill-md"
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
            rows={20}
            className="resize-y bg-surface-2 p-3 font-mono sm:text-[12.5px]"
          />
          {/* Compact status strip (phones/tablets): the checks panel is off-screen below while typing. */}
          <div className="mt-1 flex flex-wrap items-center gap-1.5 lg:hidden" aria-live="polite">
            <button type="button" onClick={() => jumpToChecks("lint")} className={STRIP_BTN} aria-label="Show lint results">
              {nErrors > 0 ? (
                <Badge tone="danger">✗ {plural(nErrors, "error")}</Badge>
              ) : nWarnings > 0 ? (
                <Badge tone="warn">⚠ {plural(nWarnings, "warning")}</Badge>
              ) : (
                <Badge tone="ok">✓ lint ok</Badge>
              )}
            </button>
            {nErrors > 0 && nWarnings > 0 && (
              <button type="button" onClick={() => jumpToChecks("lint")} className={STRIP_BTN} aria-label="Show lint warnings">
                <Badge tone="warn">⚠ {plural(nWarnings, "warning")}</Badge>
              </button>
            )}
            <button type="button" onClick={() => jumpToChecks("scan")} className={STRIP_BTN} aria-label="Show scan findings">
              {nFindings > 0 ? <Badge tone="warn">scan · {plural(nFindings, "finding")}</Badge> : <Badge tone="ok">scan clean</Badge>}
            </button>
          </div>
          <div className="mt-4">
            <div className="mb-1.5 text-[12px] font-medium text-muted">Tools</div>
            <div className="flex flex-wrap gap-1.5">
              {TOOLS.filter((t) => t !== "generic").map((t) => (
                <Chip key={t} active={tools.includes(t)} aria-pressed={tools.includes(t)} onClick={() => toggleTool(t)}>
                  {tools.includes(t) && <Check size={12} />} {TOOL_LABEL[t]}
                </Chip>
              ))}
            </div>
          </div>
          <div className="mt-4 max-w-md">
            <label htmlFor="skill-note" className="mb-1.5 block text-[12px] font-medium text-muted">
              Changelog {existing ? "" : "(optional)"}
            </label>
            <Input
              id="skill-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={existing ? "What changed in this version?" : "First cut"}
              className="sm:text-[13px]"
            />
          </div>
        </div>

        {/* lint / scan / preview */}
        <div ref={checksRef} className="min-w-0 scroll-mt-4">
          <div role="tablist" aria-label="Skill checks" className="mb-2 flex gap-1">
            {(["lint", "scan", "preview"] as Tab[]).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={cn(
                  "h-9 rounded-md px-3 text-[13px] font-medium capitalize transition-colors pressable [@media(pointer:coarse)]:h-10",
                  tab === t ? "bg-primary-soft text-primary" : "text-muted hover:bg-surface-2",
                )}
              >
                {t}
              </button>
            ))}
          </div>

          <FadeSwap k={tab}>
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
          </FadeSwap>
        </div>
      </div>

      {/* Phone/tablet action bar: sticks to the bottom of the scroll container, clears the home
          indicator, and always says why Save is off. */}
      <div ref={barRef} className="sticky bottom-0 z-10 -mx-4 mt-6 flex items-center justify-between gap-3 border-t border-border bg-surface/90 px-4 pt-3 pb-[calc(0.75rem+var(--safe-bottom))] backdrop-blur sm:-mx-5 sm:px-5 lg:hidden">
        <p className="min-w-0 truncate text-[12.5px] text-muted">
          {lint.ok ? (existing ? `Saves version ${existing.latest + 1}` : "Ready to save") : `Fix ${plural(nErrors, "error")} to save`}
        </p>
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      </div>
    </div>
  );
}
