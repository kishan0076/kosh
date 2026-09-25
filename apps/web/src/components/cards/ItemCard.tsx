import { useState, type AnimationEvent } from "react";
import { motion } from "motion/react";
import { useNavigate } from "react-router-dom";
import {
  Bookmark,
  Copy,
  Eye,
  FolderPlus,
  GitFork,
  Maximize2,
  MoreHorizontal,
  Pin,
  Star,
  Terminal,
  Trash2,
} from "lucide-react";
import {
  REPO_KIND_LABEL,
  TOOL_LABEL,
  formatBytes,
  formatCompact,
  languageColor,
  type Item,
  type Skill,
} from "@kosh/shared";
import { cn } from "@/lib/cn";
import { ago } from "@/lib/time";
import { revealClass, revealStyle } from "@/lib/motion";
import { GitHubMark, itemIcon, TOOL_COLOR_VAR } from "@/lib/icons";
import { useSetStage } from "@/lib/useSetStage";
import { useData } from "@/data/store";
import { useUi } from "@/data/ui";
import { Badge, Spinner } from "../ui";
import { Menu, MenuItem, MenuSeparator } from "../overlays";
import { StageChip, StageDot } from "../common";

/**
 * CSS stagger for the first cards of a freshly keyed list (see lib/motion revealClass). The class is
 * dropped once the keyframe finishes: `.reveal-in` fills forwards, and a filled `transform: none` would
 * otherwise pin the card and swallow `.card-hover`'s lift/press for good. Re-renders (pins, SSE
 * patches) never re-add it — only a remount (new list key) reveals again.
 */
export function useReveal(index: number) {
  const [done, setDone] = useState(false);
  const className = done ? "" : revealClass(index);
  return {
    className,
    style: className ? revealStyle(index) : undefined,
    onAnimationEnd: (e: AnimationEvent<HTMLElement>) => {
      if (e.animationName === "kosh-reveal-in") setDone(true);
    },
  };
}

function edgeColor(item: Item, skill?: Skill): string {
  if (item.status === "dead") return "var(--danger)";
  if (item.kind === "skill") return TOOL_COLOR_VAR[skill?.tools[0] ?? "generic"];
  if (item.kind === "prompt") return "var(--muted)";
  if (item.kind === "file") return "var(--faint)";
  if (item.github?.language) return languageColor(item.github.language);
  if (item.linkType === "repo") return "var(--primary)";
  return "var(--faint)";
}

function fileExt(path?: string): string {
  if (!path) return "file";
  const m = path.match(/\.([a-z0-9]+)$/i);
  return m ? m[1]!.toLowerCase() : "file";
}

// Always-visible on touch, hover-revealed with a mouse; 40px hit boxes under a thumb (the negative
// margins keep the header row's height, so the card doesn't grow on phones).
const ACTION_BTN =
  "grid h-8 w-8 place-items-center rounded-md text-faint hover:bg-surface-2 hover:text-foreground pressable [@media(pointer:coarse)]:-my-1 [@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:w-10";

export function ItemCard({ item, index = 0 }: { item: Item; index?: number }) {
  const skills = useData((s) => s.skills);
  const skill = item.skillId ? skills.find((s) => s.id === item.skillId) : undefined;
  const collections = useData((s) => s.collections);
  const togglePin = useData((s) => s.togglePin);
  const toggleFavorite = useData((s) => s.toggleFavorite);
  const setStage = useSetStage();
  const softDelete = useData((s) => s.softDelete);
  const restore = useData((s) => s.restore);
  const toggleItemCollection = useData((s) => s.toggleItemCollection);
  const openItem = useUi((s) => s.openItem);
  const toast = useUi((s) => s.toast);
  const dismissToast = useUi((s) => s.dismissToast);
  const navigate = useNavigate();
  const reveal = useReveal(index);

  const Icon = itemIcon(item);
  const edge = edgeColor(item, skill);
  const enriching = item.status === "enriching";
  const version = skill?.versions.at(-1);
  const risky = version?.scan.risky;

  const onDelete = () => {
    const id = toast({
      message: "Moved to Trash",
      description: item.title,
      action: { label: "Undo", onClick: () => restore(item.id) },
    });
    // A failed DELETE rolls the item back; drop the Undo toast so it doesn't sit next to an item that's still there.
    softDelete(item.id, { onError: () => dismissToast(id) });
  };

  const copyInstall = () => {
    const cmd = item.github?.install?.command;
    if (cmd) {
      navigator.clipboard?.writeText(cmd).catch(() => {});
      toast({ message: "Copied install command", tone: "ok" });
    }
  };

  return (
    // motion.article (no layout/enter props) so ItemGrid's AnimatePresence can still track it; the
    // enter is the CSS reveal above — no framer stagger, no FLIP on re-sorts.
    <motion.article
      onClick={() => openItem(item.id)}
      onAnimationEnd={reveal.onAnimationEnd}
      style={reveal.style}
      className={cn(
        "group relative flex cursor-pointer flex-col overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface pl-4 pr-3.5 py-3.5 card-hover hover:border-border-strong",
        enriching && "animate-pulse-gold",
        reveal.className,
      )}
    >
      <span className="absolute inset-y-0 left-0 w-[3px]" style={{ backgroundColor: edge }} aria-hidden />

      {/* header */}
      <div className="flex items-start gap-2.5">
        <span
          className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg"
          style={{ backgroundColor: `color-mix(in oklab, ${edge} 15%, transparent)`, color: edge }}
        >
          {item.linkType === "repo" ? <GitHubMark size={16} /> : <Icon size={16} strokeWidth={2} />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h3 className={cn("truncate text-[14.5px] font-semibold leading-tight", item.kind === "link" && item.linkType === "repo" && "font-mono text-[13.5px]")}>
              {item.title ?? item.url}
            </h3>
            {item.pinned && <Pin size={12} className="shrink-0 rotate-45 fill-gold text-gold" />}
          </div>
          <MetaLine item={item} />
        </div>

        {/* Menu items render in a portal but bubble through the React tree: stop them here so picking
            "Delete"/"Pin" never also opens the card. */}
        <div
          onClick={(e) => e.stopPropagation()}
          className="-mr-1 flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 [@media(pointer:coarse)]:opacity-100"
        >
          <button type="button" onClick={() => togglePin(item.id)} className={ACTION_BTN} aria-label={item.pinned ? "Unpin" : "Pin"} aria-pressed={item.pinned}>
            <Pin size={14} className={cn(item.pinned && "rotate-45 fill-gold text-gold")} />
          </button>
          <Menu
            align="end"
            trigger={({ toggle, ref }) => (
              <button type="button" ref={ref} onClick={toggle} className={ACTION_BTN} aria-label="More actions">
                <MoreHorizontal size={16} />
              </button>
            )}
          >
            <MenuItem icon={Eye} onClick={() => openItem(item.id)}>
              Open
            </MenuItem>
            <MenuItem icon={Maximize2} onClick={() => navigate(`/items/${item.id}`)}>
              Open as page
            </MenuItem>
            <MenuItem icon={Pin} onClick={() => togglePin(item.id)}>
              {item.pinned ? "Unpin" : "Pin"}
            </MenuItem>
            <MenuItem icon={Bookmark} onClick={() => toggleFavorite(item.id)}>
              {item.favorite ? "Remove favorite" : "Favorite"}
            </MenuItem>
            {item.github?.install?.command && (
              <MenuItem icon={Terminal} onClick={copyInstall}>
                Copy install
              </MenuItem>
            )}
            {item.url && (
              <MenuItem
                icon={Copy}
                onClick={() => {
                  navigator.clipboard?.writeText(item.url!).catch(() => {});
                  toast({ message: "Copied link", tone: "ok" });
                }}
              >
                Copy link
              </MenuItem>
            )}
            <MenuSeparator />
            {collections.slice(0, 4).map((c) => (
              <MenuItem key={c.id} icon={FolderPlus} onClick={() => toggleItemCollection(item.id, c.id)}>
                {item.collections.includes(c.id) ? `In ${c.name}` : `Add to ${c.name}`}
              </MenuItem>
            ))}
            <MenuSeparator />
            <MenuItem icon={Trash2} danger onClick={onDelete}>
              Delete
            </MenuItem>
          </Menu>
        </div>
      </div>

      {/* body */}
      {enriching ? (
        <div className="mt-3 flex items-center gap-2 text-[13px] text-muted">
          <Spinner size={14} className="text-gold" />
          Enriching…
        </div>
      ) : (
        <>
          {(item.ai?.summary || item.description) && item.kind !== "prompt" && (
            <p className="mt-2 line-clamp-2 text-[13px] leading-snug text-muted">{item.ai?.summary ?? item.description}</p>
          )}

          {item.kind === "prompt" && item.prompt && (
            <div className="mt-2 rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-[12px] leading-snug text-muted">
              <span className="line-clamp-2 break-words [overflow-wrap:anywhere]">{item.prompt.body}</span>
            </div>
          )}

          {/* skill tool tabs + health */}
          {item.kind === "skill" && skill && (
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              {skill.tools.slice(0, 3).map((t) => (
                <span
                  key={t}
                  className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium"
                  style={{ backgroundColor: `color-mix(in oklab, ${TOOL_COLOR_VAR[t]} 16%, transparent)`, color: TOOL_COLOR_VAR[t] }}
                >
                  {TOOL_LABEL[t]}
                </span>
              ))}
              {skill.indexOnly && <Badge tone="neutral">index only</Badge>}
              {risky && <Badge tone="warn">⚠ {version?.scan.findings.length} findings</Badge>}
              {skill.trust === "unreviewed" && !skill.indexOnly && <Badge tone="warn">unreviewed</Badge>}
              {skill.license && <span className="text-[11px] text-faint">{skill.license}</span>}
            </div>
          )}

          {/* tags */}
          {item.tags.length > 0 && item.kind !== "skill" && (
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              {item.tags.slice(0, 3).map((t) => (
                <span key={t} className="max-w-full truncate rounded-md bg-surface-2 px-1.5 py-0.5 text-[11.5px] text-muted">
                  #{t}
                </span>
              ))}
              {item.tags.length > 3 && <span className="text-[11.5px] text-faint">+{item.tags.length - 3}</span>}
            </div>
          )}
        </>
      )}

      {/* footer */}
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-2.5">
        <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
          <StageChip stage={item.stage} onChange={(s) => setStage(item.id, s)} size="sm" />
        </div>
        <div className="flex min-w-0 items-center gap-1.5 text-[12px] text-muted">
          {item.foundVia && <span className="min-w-0 line-clamp-1 break-all">via {item.foundVia.label}</span>}
          {item.foundVia && <span aria-hidden>·</span>}
          <span className="shrink-0 text-faint">{ago(item.updatedAt)}</span>
        </div>
      </div>
    </motion.article>
  );
}

function MetaLine({ item }: { item: Item }) {
  if (item.status === "dead") {
    return <div className="mt-1 text-[12px] font-medium text-danger">Dead link · saved anyway</div>;
  }
  if (item.kind === "link" && item.linkType === "repo" && item.github) {
    const g = item.github;
    return (
      <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px] text-muted">
        {g.repoKind && (
          <span className="inline-flex items-center gap-1 font-medium text-foreground">{REPO_KIND_LABEL[g.repoKind]}</span>
        )}
        {g.stars != null && (
          <span className="inline-flex items-center gap-1 tabular">
            <Star size={12} className="text-gold" /> {formatCompact(g.stars)}
          </span>
        )}
        {g.forks != null && (
          <span className="inline-flex items-center gap-1 tabular">
            <GitFork size={12} /> {formatCompact(g.forks)}
          </span>
        )}
        {g.language && (
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: languageColor(g.language) }} />
            {g.language}
          </span>
        )}
        {g.license && <span>{g.license}</span>}
        {g.skillIndex && g.skillIndex.length > 0 && (
          <span className="text-primary">
            {g.skillIndex.length} skills{g.copiedCount ? ` · ${g.copiedCount} copied` : ""}
            {g.watch?.newSince ? ` · ${g.watch.newSince} new` : ""}
          </span>
        )}
      </div>
    );
  }
  if (item.kind === "link" && item.linkType === "package" && item.package) {
    return (
      <div className="mt-1 flex items-center gap-2 text-[12px] text-muted">
        <Badge tone="primary">{item.package.registry}</Badge>
        {item.package.version && <span className="font-mono">{item.package.version}</span>}
      </div>
    );
  }
  if (item.kind === "prompt" && item.prompt) {
    return (
      <div className="mt-1 flex items-center gap-2 text-[12px] text-muted">
        <span>{item.prompt.variables.length} variables</span>
        <span aria-hidden>·</span>
        <span>used {item.prompt.usedCount}×</span>
      </div>
    );
  }
  if (item.kind === "file" && item.fileObject) {
    return (
      <div className="mt-1 flex items-center gap-2 text-[12px] text-muted">
        <Badge tone="neutral">.{fileExt(item.fileObject.path)}</Badge>
        <span>{formatBytes(item.fileObject.size)}</span>
      </div>
    );
  }
  if (item.kind === "skill") {
    return null;
  }
  return item.meta?.siteName ? <div className="mt-1 truncate text-[12px] text-muted">{item.meta.siteName}</div> : null;
}

/** Small helper re-export for lists elsewhere. */
export { StageDot };
