import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowUpRight,
  Bookmark,
  Check,
  ChevronDown,
  Copy,
  Download,
  ExternalLink,
  Eye,
  FileCode2,
  FileText,
  GitBranch,
  Maximize2,
  Pencil,
  Pin,
  Sparkles,
  Star,
  Terminal,
  Trash2,
  X,
} from "lucide-react";
import {
  REPO_KIND_LABEL,
  TOOL_LABEL,
  formatBytes,
  formatCompact,
  languageColor,
  parseFrontmatter,
  type Item,
  type Skill,
  type SkillFile,
} from "@kosh/shared";
import { cn } from "@/lib/cn";
import { ago, shortDate } from "@/lib/time";
import { GitHubMark, itemIcon, TOOL_COLOR_VAR } from "@/lib/icons";
import { useSetStage } from "@/lib/useSetStage";
import { useData } from "@/data/store";
import { useUi } from "@/data/ui";
import { live } from "@/data/selectors";
import { Badge, Button, Divider, Toggle } from "../ui";
import { Menu, MenuItem } from "../overlays";
import { StageChip, StarRating, TrustBadge } from "../common";
import { Markdown } from "../markdown";
import { CodeViewer } from "../CodeViewer";
import { InstallMenu } from "./InstallMenu";
import { PromptFill } from "./PromptFill";

export function DetailPanel() {
  const panel = useUi((s) => s.panel);
  const closePanel = useUi((s) => s.closePanel);
  const openItem = useUi((s) => s.openItem);
  const items = useData((s) => s.items);
  const navigate = useNavigate();

  const ordered = useMemo(() => live(items).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [items]);
  const item = panel ? items.find((i) => i.id === panel.id) : undefined;
  const idx = item ? ordered.findIndex((i) => i.id === item.id) : -1;

  useEffect(() => {
    if (!panel) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "Escape") closePanel();
      if ((e.key === "j" || e.key === "ArrowDown") && idx >= 0 && idx < ordered.length - 1) openItem(ordered[idx + 1]!.id);
      if ((e.key === "k" || e.key === "ArrowUp") && idx > 0) openItem(ordered[idx - 1]!.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panel, idx, ordered, closePanel, openItem]);

  return (
    <AnimatePresence>
      {panel && item && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-black/30 lg:hidden"
            onClick={closePanel}
          />
          <motion.aside
            key="panel"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 380, damping: 38 }}
            className="fixed inset-y-0 right-0 z-40 flex w-full max-w-[480px] flex-col border-l border-border bg-surface shadow-[var(--shadow-pop)]"
          >
            <PanelBody item={item} onClose={closePanel} onExpand={() => { closePanel(); navigate(`/items/${item.id}`); }} />
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

/** The scrollable detail content (summary, actions, meta, type-specific body) — shared by the
 *  drawer and the dedicated /items/:id page so both stay in sync. */
export function ItemDetailContent({ item }: { item: Item }) {
  const skills = useData((s) => s.skills);
  const skill = item.skillId ? skills.find((s) => s.id === item.skillId) : undefined;
  return skill ? <SkillBody item={item} skill={skill} /> : <ItemBody item={item} />;
}

function PanelBody({ item, onClose, onExpand }: { item: Item; onClose: () => void; onExpand: () => void }) {
  const skills = useData((s) => s.skills);
  const skill = item.skillId ? skills.find((s) => s.id === item.skillId) : undefined;

  const Icon = itemIcon(item);
  const edge =
    item.kind === "skill"
      ? TOOL_COLOR_VAR[skill?.tools[0] ?? "generic"]
      : item.github?.language
        ? languageColor(item.github.language)
        : "var(--primary)";

  return (
    <>
      {/* header */}
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg" style={{ backgroundColor: `color-mix(in oklab, ${edge} 15%, transparent)`, color: edge }}>
          {item.linkType === "repo" ? <GitHubMark size={15} /> : <Icon size={15} />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{item.title}</div>
          <div className="text-[11px] text-muted">Updated {ago(item.updatedAt)}</div>
        </div>
        {item.url && (
          <a href={item.url} target="_blank" rel="noreferrer noopener">
            <Button variant="ghost" size="icon-sm" aria-label="Open original">
              <ExternalLink size={16} />
            </Button>
          </a>
        )}
        <Button variant="ghost" size="icon-sm" onClick={onExpand} aria-label="Open as page">
          <Maximize2 size={16} />
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close">
          <X size={17} />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <ItemDetailContent item={item} />
      </div>
    </>
  );
}

/* ── Shared metadata rail ───────────────────────────────────── */
function MetaRail({ item }: { item: Item }) {
  const setStage = useSetStage();
  const setRating = useData((s) => s.setRating);
  const patchItem = useData((s) => s.patchItem);
  const collections = useData((s) => s.collections);
  const toggleItemCollection = useData((s) => s.toggleItemCollection);
  const [tagInput, setTagInput] = useState("");
  const [foundEdit, setFoundEdit] = useState(false);
  const foundCancelled = useRef(false);

  const addTag = () => {
    const t = tagInput.trim().replace(/^#/, "");
    if (t && !item.tags.includes(t)) patchItem(item.id, { tags: [...item.tags, t] });
    setTagInput("");
  };

  return (
    <div className="space-y-4 px-4 py-4">
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-medium text-muted">Stage</span>
        <StageChip stage={item.stage} onChange={(s) => setStage(item.id, s)} />
      </div>
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-medium text-muted">Rating</span>
        <StarRating value={item.rating ?? 0} onChange={(v) => setRating(item.id, v)} />
      </div>

      {/* ghost (AI-suggested) tags */}
      {item.ai?.suggestedTags && item.ai.suggestedTags.filter((t) => !item.tags.includes(t)).length > 0 && (
        <div>
          <span className="mb-1.5 block text-[12px] font-medium text-muted">Suggested tags</span>
          <div className="flex flex-wrap gap-1.5">
            {item.ai.suggestedTags
              .filter((t) => !item.tags.includes(t))
              .map((t) => (
                <button
                  key={t}
                  onClick={() => patchItem(item.id, { tags: [...item.tags, t] })}
                  className="inline-flex items-center gap-1 rounded-md border border-dashed border-border-strong px-1.5 py-0.5 text-[11px] text-muted hover:border-primary hover:text-primary"
                >
                  + #{t}
                </button>
              ))}
          </div>
        </div>
      )}

      {/* tags */}
      <div>
        <span className="mb-1.5 block text-[12px] font-medium text-muted">Tags</span>
        <div className="flex flex-wrap items-center gap-1.5">
          {item.tags.map((t) => (
            <span key={t} className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px] text-muted">
              #{t}
              <button onClick={() => patchItem(item.id, { tags: item.tags.filter((x) => x !== t) })} className="hover:text-danger" aria-label={`Remove ${t}`}>
                <X size={11} />
              </button>
            </span>
          ))}
          <input
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addTag()}
            placeholder="add tag"
            className="w-20 rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px] outline-none placeholder:text-faint focus:ring-focus"
          />
        </div>
      </div>

      {/* collections */}
      <div>
        <span className="mb-1.5 block text-[12px] font-medium text-muted">Collections</span>
        <div className="flex flex-wrap gap-1.5">
          {collections.map((c) => {
            const inC = item.collections.includes(c.id);
            return (
              <button
                key={c.id}
                onClick={() => toggleItemCollection(item.id, c.id)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] font-medium transition-colors",
                  inC ? "border-transparent bg-primary-soft text-primary" : "border-border text-muted hover:bg-surface-2",
                )}
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: c.color }} />
                {c.name}
                {inC && <Check size={11} />}
              </button>
            );
          })}
        </div>
      </div>

      {/* found via — provenance, editable */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] font-medium text-muted">Found via</span>
        {foundEdit ? (
          <input
            autoFocus
            defaultValue={item.foundVia?.label ?? ""}
            onBlur={(e) => {
              if (foundCancelled.current) {
                foundCancelled.current = false;
              } else {
                const label = e.target.value.trim();
                patchItem(item.id, { foundVia: label ? { kind: item.foundVia?.kind ?? "other", label } : undefined });
              }
              setFoundEdit(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") {
                foundCancelled.current = true; // skip the commit that the ensuing blur would run
                setFoundEdit(false);
              }
            }}
            placeholder="e.g. a friend, newsletter…"
            className="w-40 rounded-md bg-surface-2 px-2 py-0.5 text-right text-[11px] outline-none placeholder:text-faint focus:ring-focus"
          />
        ) : (
          <button onClick={() => setFoundEdit(true)} className="rounded-md hover:opacity-80" aria-label="Edit found via">
            {item.foundVia ? <Badge tone="neutral">{item.foundVia.label}</Badge> : <span className="text-[12px] text-faint">+ add source</span>}
          </button>
        )}
      </div>

      {/* note */}
      <div>
        <span className="mb-1.5 block text-[12px] font-medium text-muted">Note — why you saved this</span>
        <textarea
          defaultValue={item.note ?? ""}
          onBlur={(e) => patchItem(item.id, { note: e.target.value })}
          placeholder="A line to future-you…"
          rows={2}
          className="w-full resize-y rounded-[var(--radius-control)] border border-border bg-surface px-3 py-2 text-[13px] outline-none placeholder:text-faint focus:border-primary focus:ring-focus"
        />
      </div>

      {item.verdict && (
        <div className="rounded-[var(--radius-control)] border border-border bg-surface-2 px-3 py-2">
          <div className="text-[11px] font-medium text-muted">Verdict · {shortDate(item.verdictAt)}</div>
          <div className="mt-0.5 text-[13px]">{item.verdict}</div>
        </div>
      )}
    </div>
  );
}

/* ── Non-skill body ─────────────────────────────────────────── */
function ItemBody({ item }: { item: Item }) {
  const readmes = useData((s) => s.readmes);
  const filePreviews = useData((s) => s.filePreviews);
  const patchItem = useData((s) => s.patchItem);
  const togglePin = useData((s) => s.togglePin);
  const toggleFavorite = useData((s) => s.toggleFavorite);
  const softDelete = useData((s) => s.softDelete);
  const restore = useData((s) => s.restore);
  const extractLinks = useData((s) => s.extractLinks);
  const snapshotSkills = useData((s) => s.snapshotSkills);
  const toast = useUi((s) => s.toast);
  const closePanel = useUi((s) => s.closePanel);
  const [fillOpen, setFillOpen] = useState(false);
  const [busy, setBusy] = useState<null | "extract" | string>(null);

  const onExtract = async () => {
    setBusy("extract");
    try {
      const r = await extractLinks(item.id);
      toast({ message: `Extracted ${r.saved} link${r.saved === 1 ? "" : "s"} to Inbox`, description: r.skipped ? `${r.skipped} already saved` : undefined, tone: "ok" });
    } catch (err) {
      toast({ message: "Couldn't extract links", description: err instanceof Error ? err.message : undefined, tone: "danger" });
    } finally {
      setBusy(null);
    }
  };

  const onSnapshot = async (path: string, name: string) => {
    setBusy(path);
    try {
      const n = await snapshotSkills(item.id, [path]);
      toast({ message: n ? `Copied ${name}` : "Nothing new to copy", description: n ? "Snapshotted into your vault" : undefined, tone: "ok" });
    } catch (err) {
      toast({ message: `Couldn't copy ${name}`, description: err instanceof Error ? err.message : undefined, tone: "danger" });
    } finally {
      setBusy(null);
    }
  };

  const g = item.github;
  const readme = readmes[item.id] ?? item.github?.readme;

  return (
    <div className="pb-8">
      {/* summary / hero */}
      <div className="px-4 pt-4">
        {item.ai?.summary && (
          <div className="rounded-[var(--radius-control)] border border-primary/20 bg-primary-soft/40 p-3">
            <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-primary">
              <Sparkles size={12} /> AI summary
            </div>
            <p className="text-[13px] leading-snug text-foreground">{item.ai.summary}</p>
          </div>
        )}
        {!item.ai?.summary && item.description && <p className="text-[13.5px] text-muted">{item.description}</p>}
      </div>

      {/* actions */}
      <div className="flex flex-wrap gap-2 px-4 pt-3">
        {item.kind === "prompt" && (
          <Button variant="primary" size="sm" onClick={() => setFillOpen(true)}>
            <Copy size={15} /> Fill & copy
          </Button>
        )}
        {g?.install?.command && (
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              navigator.clipboard?.writeText(g.install!.command!).catch(() => {});
              toast({ message: "Install command copied", tone: "ok" });
            }}
          >
            <Terminal size={15} /> Copy install
          </Button>
        )}
        {item.kind === "file" && (
          <Button variant="primary" size="sm" onClick={() => toast({ message: "Downloading…", description: item.fileObject?.path })}>
            <Download size={15} /> Download
          </Button>
        )}
        {item.url && (
          <a href={item.url} target="_blank" rel="noreferrer noopener">
            <Button variant="outline" size="sm">
              <ArrowUpRight size={15} /> Open original
            </Button>
          </a>
        )}
        <Button variant="ghost" size="sm" onClick={() => togglePin(item.id)}>
          <Pin size={15} className={cn(item.pinned && "rotate-45 fill-gold text-gold")} /> {item.pinned ? "Pinned" : "Pin"}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => toggleFavorite(item.id)}>
          <Bookmark size={15} className={cn(item.favorite && "fill-primary text-primary")} />
        </Button>
      </div>

      {/* install command block */}
      {g?.install?.command && (
        <div className="mx-4 mt-3 flex items-center gap-2 rounded-[var(--radius-control)] border border-border bg-surface-2 px-3 py-2">
          <Terminal size={14} className="shrink-0 text-muted" />
          <code className="min-w-0 flex-1 truncate font-mono text-[12.5px]">{g.install.command}</code>
          <button
            onClick={() => {
              navigator.clipboard?.writeText(g.install!.command!).catch(() => {});
              toast({ message: "Copied", tone: "ok" });
            }}
            className="shrink-0 rounded-md p-1 text-faint hover:bg-surface-3 hover:text-foreground"
          >
            <Copy size={14} />
          </button>
        </div>
      )}

      <Divider className="my-4" />
      <MetaRail item={item} />

      {/* github stats */}
      {g && (
        <>
          <Divider className="my-1" />
          <div className="px-4 py-4">
            <div className="mb-3 flex items-center justify-between">
              <h4 className="text-[13px] font-semibold">Repository</h4>
              {g.repoKind && <Badge tone="primary">{REPO_KIND_LABEL[g.repoKind]}</Badge>}
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Stat label="Stars" value={g.stars != null ? formatCompact(g.stars) : "—"} icon={Star} />
              <Stat label="Forks" value={g.forks != null ? formatCompact(g.forks) : "—"} icon={GitBranch} />
              <Stat label="License" value={g.license ?? "—"} />
            </div>
            {g.language && (
              <div className="mt-3 flex items-center gap-2 text-[13px]">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: languageColor(g.language) }} />
                {g.language}
                <span className="ml-auto text-muted">pushed {ago(g.pushedAt)}</span>
              </div>
            )}
            {/* watch toggle */}
            <div className="mt-3 flex items-center justify-between rounded-[var(--radius-control)] border border-border bg-surface-2 px-3 py-2">
              <span className="text-[13px] font-medium">Watch for changes</span>
              <Toggle
                checked={!!g.watch?.enabled}
                onChange={(next) => patchItem(item.id, { github: { ...g, watch: { ...g.watch, enabled: next } } })}
                label="Watch for changes"
              />
            </div>
          </div>

          {/* skills inside */}
          {g.skillIndex && g.skillIndex.length > 0 && (
            <>
              <Divider className="my-1" />
              <div className="px-4 py-4">
                <h4 className="mb-2 text-[13px] font-semibold">
                  Skills inside · {g.skillIndex.length}
                  {g.copiedCount ? <span className="ml-1 font-normal text-muted">· {g.copiedCount} copied</span> : null}
                </h4>
                <div className="space-y-1">
                  {g.skillIndex.map((s) => (
                    <div key={s.path} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-surface-2">
                      <FileCode2 size={14} className="shrink-0 text-muted" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-medium">{s.name}</div>
                        {s.description && <div className="truncate text-[11px] text-muted">{s.description}</div>}
                      </div>
                      {s.snapshotted ? (
                        <Badge tone="ok">copied</Badge>
                      ) : (
                        <button
                          onClick={() => onSnapshot(s.path, s.name)}
                          disabled={busy === s.path}
                          className="shrink-0 rounded-md px-2 py-1 text-[11px] font-semibold text-primary hover:bg-primary-soft disabled:opacity-50"
                        >
                          {busy === s.path ? "Copying…" : "Keep a copy"}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                {g.repoKind === "awesome-list" && (
                  <Button variant="outline" size="sm" className="mt-3 w-full" onClick={onExtract} disabled={busy === "extract"}>
                    {busy === "extract" ? "Extracting…" : "Extract all links to Inbox"}
                  </Button>
                )}
              </div>
            </>
          )}
        </>
      )}

      {/* prompt body */}
      {item.kind === "prompt" && item.prompt && (
        <>
          <Divider className="my-1" />
          <div className="px-4 py-4">
            <h4 className="mb-2 text-[13px] font-semibold">Prompt</h4>
            <div className="whitespace-pre-wrap rounded-[var(--radius-control)] border border-border bg-surface-2 p-3 font-mono text-[12.5px] leading-relaxed">
              {highlightVars(item.prompt.body)}
            </div>
            <div className="mt-2 text-[11px] text-muted">
              {item.prompt.variables.length} variables · used {item.prompt.usedCount}×
            </div>
          </div>
        </>
      )}

      {/* file preview */}
      {item.kind === "file" && filePreviews[item.id] && (
        <>
          <Divider className="my-1" />
          <div className="px-4 py-4">
            <h4 className="mb-2 text-[13px] font-semibold">Preview</h4>
            <CodeViewer code={filePreviews[item.id]!} />
            {item.fileObject && <div className="mt-2 text-[11px] text-muted">{formatBytes(item.fileObject.size)} · {item.fileObject.mime}</div>}
          </div>
        </>
      )}

      {/* README */}
      {readme && (
        <>
          <Divider className="my-1" />
          <div className="px-4 py-4">
            <h4 className="mb-2 text-[13px] font-semibold">README</h4>
            <Markdown>{readme}</Markdown>
          </div>
        </>
      )}

      {/* delete */}
      <Divider className="my-1" />
      <div className="px-4 py-4">
        <Button
          variant="ghost"
          size="sm"
          className="text-danger hover:bg-danger-soft"
          onClick={() => {
            softDelete(item.id);
            closePanel();
            toast({ message: "Moved to Trash", description: item.title, action: { label: "Undo", onClick: () => restore(item.id) } });
          }}
        >
          <Trash2 size={15} /> Delete
        </Button>
      </div>

      {item.kind === "prompt" && <PromptFill item={item} open={fillOpen} onClose={() => setFillOpen(false)} />}
    </div>
  );
}

/* ── Skill body ─────────────────────────────────────────────── */
function SkillBody({ item, skill }: { item: Item; skill: Skill }) {
  const reviewSkill = useData((s) => s.reviewSkill);
  const keepCopy = useData((s) => s.keepCopy);
  const toggleSkillPublic = useData((s) => s.toggleSkillPublic);
  const closePanel = useUi((s) => s.closePanel);
  const navigate = useNavigate();
  const toast = useUi((s) => s.toast);
  const [versionN, setVersionN] = useState(skill.latest);
  const version = skill.versions.find((v) => v.n === versionN) ?? skill.versions.at(-1)!;
  const files = version.files;
  const [selected, setSelected] = useState<SkillFile | undefined>(() => files.find((f) => /SKILL\.md$/i.test(f.path)) ?? files[0]);

  const isMarkdown = selected && /\.mdx?$/i.test(selected.path);

  return (
    <div className="pb-8">
      {/* trust banner */}
      {skill.trust === "unreviewed" && !skill.indexOnly && (
        <div className="flex items-start gap-2.5 border-b border-warn/30 bg-warn-soft px-4 py-3">
          <Eye size={16} className="mt-0.5 shrink-0 text-warn" />
          <div className="flex-1">
            <div className="text-[13px] font-semibold text-warn">Not reviewed yet</div>
            <div className="text-[12px] text-warn/90">
              Copied from {skill.source?.owner ? `${skill.source.owner}/${skill.source.repo}` : "a repo"}. Read it, then mark reviewed.
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => { reviewSkill(skill.id); toast({ message: "Marked reviewed", tone: "ok" }); }}>
            <Check size={14} /> Mark reviewed
          </Button>
        </div>
      )}

      {skill.indexOnly && (
        <div className="flex items-center justify-between gap-2 border-b border-border bg-surface-2 px-4 py-3">
          <span className="text-[13px] text-muted">Indexed only — no copy in your vault yet.</span>
          <Button variant="primary" size="sm" onClick={() => { keepCopy(skill.id); toast({ message: "Copy kept", description: skill.name, tone: "ok" }); }}>
            Keep a copy
          </Button>
        </div>
      )}

      {/* header actions */}
      <div className="px-4 pt-4">
        <div className="flex flex-wrap items-center gap-1.5">
          {skill.tools.map((t) => (
            <span key={t} className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium" style={{ backgroundColor: `color-mix(in oklab, ${TOOL_COLOR_VAR[t]} 16%, transparent)`, color: TOOL_COLOR_VAR[t] }}>
              {TOOL_LABEL[t]}
            </span>
          ))}
          <TrustBadge trust={skill.trust} />
          {skill.license && <Badge tone="neutral">{skill.license}</Badge>}
          {version.scan.risky && <Badge tone="warn">⚠ {version.scan.findings.length} findings</Badge>}
          {version.lint.ok ? <Badge tone="ok">lint ✓</Badge> : <Badge tone="danger">lint ✗</Badge>}
        </div>
        {skill.description && <p className="mt-2.5 text-[13.5px] text-muted">{skill.description}</p>}
        {skill.source?.owner && (
          <p className="mt-1.5 text-[12px] text-faint">
            from {skill.source.owner}/{skill.source.repo} · {skill.source.path}
          </p>
        )}
      </div>

      {!skill.indexOnly && (
        <div className="flex flex-wrap items-center gap-2 px-4 pt-3">
          <InstallMenu skill={skill} />
          {/* version switcher */}
          {skill.versions.length > 1 && (
            <Menu
              width={160}
              trigger={({ toggle, ref }) => (
                <Button ref={ref} variant="outline" size="sm" onClick={toggle}>
                  v{versionN} <ChevronDown size={14} />
                </Button>
              )}
            >
              {[...skill.versions].reverse().map((v) => (
                <MenuItem key={v.n} onClick={() => setVersionN(v.n)}>
                  v{v.n} · {ago(v.createdAt)}
                  {v.n === versionN && <Check size={13} className="ml-auto text-primary" />}
                </MenuItem>
              ))}
            </Menu>
          )}
          <Button variant="ghost" size="sm" onClick={() => { closePanel(); navigate(`/skills/${skill.id}/edit`); }}>
            <Pencil size={14} /> Edit
          </Button>
          <Button variant="ghost" size="sm" onClick={() => { toggleSkillPublic(skill.id); toast({ message: skill.public ? "Made private" : "Made public", tone: "ok" }); }}>
            {skill.public ? "Public" : "Make public"}
          </Button>
        </div>
      )}

      {/* scan findings */}
      {version.scan.risky && (
        <div className="mx-4 mt-3 rounded-[var(--radius-control)] border border-warn/30 bg-warn-soft/50 p-3">
          <div className="mb-1.5 text-[12px] font-semibold text-warn">Scan findings</div>
          <div className="space-y-1">
            {version.scan.findings.map((f, i) => (
              <div key={i} className="text-[12px]">
                <span className="font-mono text-muted">{f.path}:{f.line}</span> <span className="text-foreground">{f.text}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {!skill.indexOnly && files.length > 0 && (
        <>
          <Divider className="my-4" />
          {/* file tree */}
          <div className="px-4">
            <h4 className="mb-2 text-[13px] font-semibold">Files</h4>
            <div className="mb-3 flex flex-wrap gap-1">
              {files.map((f) => {
                const active = f.path === selected?.path;
                const hasFinding = version.scan.findings.some((x) => x.path === f.path);
                return (
                  <button
                    key={f.path}
                    onClick={() => setSelected(f)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-[11.5px] transition-colors",
                      active ? "border-primary bg-primary-soft text-primary" : "border-border text-muted hover:bg-surface-2",
                    )}
                  >
                    {/\.mdx?$/i.test(f.path) ? <FileText size={12} /> : <FileCode2 size={12} />}
                    {f.path}
                    {hasFinding && <span className="h-1.5 w-1.5 rounded-full bg-warn" />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* viewer */}
          <div className="px-4 pb-4">
            {selected?.content ? (
              isMarkdown ? (
                <div className="rounded-[var(--radius-control)] border border-border bg-surface-2 p-4">
                  <Markdown>{parseFrontmatter(selected.content).content}</Markdown>
                </div>
              ) : (
                <CodeViewer code={selected.content} findings={version.scan.findings.filter((f) => f.path === selected.path)} />
              )
            ) : (
              <div className="rounded-[var(--radius-control)] border border-dashed border-border p-6 text-center text-[13px] text-muted">No preview available.</div>
            )}
          </div>
        </>
      )}

      <Divider className="my-1" />
      <MetaRail item={item} />
    </div>
  );
}

/* ── helpers ────────────────────────────────────────────────── */
function Stat({ label, value, icon: Icon }: { label: string; value: string; icon?: typeof Star }) {
  return (
    <div className="rounded-[var(--radius-control)] border border-border bg-surface-2 px-3 py-2">
      <div className="flex items-center gap-1 text-[11px] text-muted">
        {Icon && <Icon size={11} />} {label}
      </div>
      <div className="mt-0.5 font-display text-sm font-semibold">{value}</div>
    </div>
  );
}

function highlightVars(body: string) {
  const parts = body.split(/(\{\{\s*[\w.-]+\s*\}\})/g);
  return parts.map((p, i) =>
    /^\{\{/.test(p) ? (
      <span key={i} className="rounded bg-primary-soft px-1 text-primary">
        {p}
      </span>
    ) : (
      <span key={i}>{p}</span>
    ),
  );
}
