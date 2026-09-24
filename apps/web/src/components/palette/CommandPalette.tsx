import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Command } from "cmdk";
import {
  Blocks,
  CornerDownLeft,
  FileText,
  FolderOpen,
  Home,
  Inbox,
  LibraryBig,
  Link2,
  Plus,
  Quote,
  Search,
  Settings,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { searchItems } from "@kosh/shared";
import { GitHubMark, itemIcon } from "@/lib/icons";
import { parseCapture } from "@/lib/capture";
import { useData } from "@/data/store";
import { useUi } from "@/data/ui";
import { live } from "@/data/selectors";
import { PHONE_QUERY, useMediaQuery } from "@/lib/useMediaQuery";
import { Button, Kbd } from "../ui";

export function CommandPalette() {
  const open = useUi((s) => s.paletteOpen);
  const paletteQuery = useUi((s) => s.paletteQuery);
  const setPalette = useUi((s) => s.setPalette);
  const openItem = useUi((s) => s.openItem);
  const toast = useUi((s) => s.toast);
  const items = useData((s) => s.items);
  const ingestUrl = useData((s) => s.ingestUrl);
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const phone = useMediaQuery(PHONE_QUERY);
  // Open pre-filled with whatever the opener handed over (Quick-Add free text, "/settings"); close() clears it.
  useEffect(() => {
    if (open) setSearch(paletteQuery);
  }, [open, paletteQuery]);

  const intent = parseCapture(search);
  const isSave = intent.kind === "link" || intent.kind === "repo";

  const results = useMemo(() => {
    const list = live(items);
    if (!search.trim() || isSave) return [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 6);
    // Ranked, filter-aware search (kind:/tag:/stage:/is:) shared with the server. (§ Sprint 6)
    return searchItems(list, search, { limit: 8 }).map((h) => h.item);
  }, [items, search, isSave]);

  const close = () => {
    setPalette(false);
    setSearch("");
  };

  const doSave = (keepOpen = false) => {
    if (!isSave) return;
    const url = intent.kind === "repo" ? intent.url : (intent as { url: string }).url;
    const { item, duplicate } = ingestUrl(url, { source: "web" });
    if (duplicate) {
      toast({ message: "Already saved", description: item.title, action: { label: "Open", onClick: () => openItem(item.id) } });
    } else {
      toast({ message: "Saving…", description: url, tone: "ok" });
    }
    if (keepOpen) {
      setSearch("");
    } else {
      close();
      if (!duplicate) navigate("/library");
    }
  };

  const go = (path: string) => {
    navigate(path);
    close();
  };

  const dedupe = isSave ? live(items).find((i) => i.url === (intent as { url: string }).url) : undefined;

  return (
    <Command.Dialog
      open={open}
      onOpenChange={(o) => (o ? setPalette(true) : close())}
      shouldFilter={false}
      label="Command palette"
      className="kosh-cmdk"
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && isSave) {
          e.preventDefault();
          doSave(true);
        }
      }}
    >
      <div className="fixed inset-0 z-[60] bg-black/45 backdrop-blur-[2px]" onClick={close} />
      {/* Phones: anchored to the top (under the notch) with a dvh-based list, so the input and the
          first results stay above the keyboard; desktop keeps the 12vh drop. */}
      <div className="fixed left-1/2 top-[max(var(--safe-top),8px)] z-[61] w-[calc(100%-1rem)] max-w-[640px] -translate-x-1/2 overflow-hidden rounded-[var(--radius-panel)] border border-border bg-elevated shadow-[var(--shadow-pop)] sm:top-[12vh] sm:w-[calc(100%-2rem)]">
        {/* input */}
        <div className="flex items-center gap-3 border-b border-border px-4">
          <span className="shrink-0 text-muted">
            {intent.kind === "repo" ? <GitHubMark size={18} /> : intent.kind === "link" ? <Link2 size={18} /> : intent.kind === "command" ? <Sparkles size={18} className="text-primary" /> : <Search size={18} />}
          </span>
          {/* 16px on phones — iOS zooms into anything smaller — and a placeholder that fits the width. */}
          <Command.Input
            value={search}
            onValueChange={setSearch}
            autoFocus
            placeholder={phone ? "Search or paste a link…" : "Search your vault, paste a link, or type / for commands…"}
            className="h-14 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-faint sm:text-[15px]"
          />
          {isSave && (
            <span className="hidden shrink-0 items-center gap-1 rounded-full bg-primary-soft px-2 py-1 text-[11px] font-semibold text-primary sm:flex">
              {intent.kind === "repo" ? "Add repo" : "Save link"}
            </span>
          )}
          <Kbd className="hidden sm:inline-flex">Esc</Kbd>
          <Button variant="ghost" size="icon" aria-label="Close" onClick={close} className="-mr-2 sm:hidden">
            <X size={18} />
          </Button>
        </div>

        <Command.List className="max-h-[calc(100dvh-max(var(--safe-top),8px)-4.5rem)] overflow-y-auto p-2 sm:max-h-[min(60vh,420px)]">
          <Command.Empty className="py-10 text-center text-sm text-muted">No matches. Paste a URL to save it.</Command.Empty>

          {/* save action */}
          {isSave && (
            <Command.Group heading="Add to vault" className="cmdk-group">
              {dedupe ? (
                <PaletteRow
                  icon={itemIcon(dedupe)}
                  title={`Already saved — open "${dedupe.title}"`}
                  onSelect={() => {
                    openItem(dedupe.id);
                    close();
                  }}
                />
              ) : (
                <PaletteRow
                  icon={intent.kind === "repo" ? GitHubMark : Link2}
                  title={intent.kind === "repo" ? `Add repo ${intent.owner}/${intent.repo}` : `Save link`}
                  subtitle={intent.kind === "repo" ? intent.url : (intent as { url: string }).url}
                  onSelect={() => doSave(false)}
                  trailing={
                    <span className="hidden items-center gap-1 text-[11px] text-faint sm:flex">
                      <Kbd>⌘</Kbd>
                      <Kbd>↵</Kbd> keep open
                    </span>
                  }
                  highlight
                />
              )}
            </Command.Group>
          )}

          {/* results */}
          {results.length > 0 && (
            <Command.Group heading={isSave ? "Recent" : "In your vault"} className="cmdk-group">
              {results.map((i) => (
                <PaletteRow
                  key={i.id}
                  icon={i.linkType === "repo" ? GitHubMark : itemIcon(i)}
                  title={i.title ?? i.url ?? "Untitled"}
                  subtitle={i.description ?? i.meta?.siteName}
                  onSelect={() => {
                    openItem(i.id);
                    close();
                  }}
                />
              ))}
            </Command.Group>
          )}

          {/* create — after the matches, so a typed query surfaces results first on a short list */}
          {!isSave && (
            <Command.Group heading="Create" className="cmdk-group">
              <PaletteRow icon={Quote} title="New prompt" onSelect={() => go("/prompts?new=1")} />
              <PaletteRow icon={Blocks} title="New skill" onSelect={() => go("/skills/new")} />
              <PaletteRow icon={FolderOpen} title="New collection" onSelect={() => go("/collections")} />
            </Command.Group>
          )}

          {/* go to */}
          {!isSave && (
            <Command.Group heading="Go to" className="cmdk-group">
              <PaletteRow icon={Home} title="Home" onSelect={() => go("/")} />
              <PaletteRow icon={Inbox} title="Inbox" onSelect={() => go("/inbox")} />
              <PaletteRow icon={LibraryBig} title="Library" onSelect={() => go("/library")} />
              <PaletteRow icon={Blocks} title="Skills" onSelect={() => go("/skills")} />
              <PaletteRow icon={FileText} title="Prompts" onSelect={() => go("/prompts")} />
              <PaletteRow icon={Trash2} title="Trash" onSelect={() => go("/trash")} />
              <PaletteRow icon={Settings} title="Settings" onSelect={() => go("/settings")} />
            </Command.Group>
          )}
        </Command.List>

        {/* footer — keyboard guidance, so desktop only */}
        <div className="hidden items-center justify-between border-t border-border px-4 py-2.5 text-[11px] text-faint sm:flex">
          <span className="flex items-center gap-1.5">
            <Sparkles size={13} className="text-gold" /> Kosh
          </span>
          <span className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd> navigate
            </span>
            <span className="flex items-center gap-1">
              <CornerDownLeft size={12} /> {isSave ? (intent.kind === "repo" ? "add repo" : "save") : "open"}
            </span>
          </span>
        </div>
      </div>
    </Command.Dialog>
  );
}

function PaletteRow({
  icon: Icon,
  title,
  subtitle,
  onSelect,
  trailing,
  highlight,
}: {
  icon: React.ComponentType<{ size?: number | string; className?: string }>;
  title: string;
  subtitle?: string;
  onSelect: () => void;
  trailing?: React.ReactNode;
  highlight?: boolean;
}) {
  return (
    <Command.Item value={`${title} ${subtitle ?? ""}`} onSelect={onSelect} className="cmdk-item">
      <span className={highlight ? "text-primary" : "text-muted"}>
        <Icon size={16} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] font-medium text-foreground">{title}</span>
        {subtitle && <span className="block truncate text-[11.5px] text-muted">{subtitle}</span>}
      </span>
      {trailing ?? (highlight && <Plus size={15} className="text-primary" />)}
    </Command.Item>
  );
}
