import { Blocks, Bookmark, Globe, Keyboard, Mail, MessageCircle, Share2, Terminal, X } from "lucide-react";
import { useUi } from "@/data/ui";
import { Button, Kbd } from "./ui";
import { Modal } from "./overlays";

const SHORTCUTS: [string, string[]][] = [
  ["Open command palette", ["⌘", "K"]],
  ["Quick help", ["?"]],
  ["Next / previous item", ["J", "K"]],
  ["Close panel / dialog", ["Esc"]],
  ["Save & keep palette open", ["⌘", "↵"]],
];

const WAYS = [
  { icon: MessageCircle, title: "Telegram bot", desc: "Send a link, a .md/.zip, or text — it's saved and replies with what it made." },
  { icon: Share2, title: "Share sheet", desc: "Android PWA share target · iOS Shortcut — “Share → Kosh” from any app." },
  { icon: Bookmark, title: "Bookmarklet", desc: "One click on desktop saves the page + selected text as a note." },
  { icon: Mail, title: "Email-in", desc: "Forward a newsletter to save@… — every link lands in Inbox, tagged." },
  { icon: Terminal, title: "CLI", desc: "npx kosh add pdf-tools · kosh import-local pulls in your on-disk skills." },
  { icon: Blocks, title: "MCP server", desc: "In Claude Code / Codex: “save this skill to Kosh”, “which pdf skills do I have?”" },
];

export function HelpSheet() {
  const open = useUi((s) => s.helpOpen);
  const setHelp = useUi((s) => s.setHelp);

  return (
    <Modal open={open} onClose={() => setHelp(false)} className="max-w-2xl">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-5 py-3 sm:py-4">
        <Keyboard size={18} className="text-primary" />
        {/* The keyboard column is hidden on phones, so the title follows suit. */}
        <h2 className="text-base font-semibold">
          <span className="sm:hidden">Ways to save</span>
          <span className="hidden sm:inline">Shortcuts & ways to save</span>
        </h2>
        <Button variant="ghost" size="icon" aria-label="Close" className="-mr-2 ml-auto" onClick={() => setHelp(false)}>
          <X size={18} />
        </Button>
      </div>
      <div className="grid min-h-0 flex-1 gap-6 overflow-y-auto p-5 sm:grid-cols-2">
        {/* Keyboard shortcuts mean nothing to a thumb: desktop only. */}
        <div className="hidden sm:block">
          <h3 className="mb-3 text-[12px] font-semibold uppercase tracking-wide text-faint">Keyboard</h3>
          <div className="space-y-2">
            {SHORTCUTS.map(([label, keys]) => (
              <div key={label} className="flex items-center justify-between">
                <span className="text-[13.5px] text-foreground">{label}</span>
                <span className="flex items-center gap-1">
                  {keys.map((k) => (
                    <Kbd key={k}>{k}</Kbd>
                  ))}
                </span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <h3 className="mb-3 text-[12px] font-semibold uppercase tracking-wide text-faint">Ways in</h3>
          <div className="space-y-3">
            {WAYS.map((w) => {
              const Icon = w.icon;
              return (
                <div key={w.title} className="flex gap-2.5">
                  <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted">
                    <Icon size={14} />
                  </span>
                  <div>
                    <div className="text-[13px] font-medium">{w.title}</div>
                    <div className="text-[12px] leading-snug text-muted">{w.desc}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2 border-t border-border px-5 py-3 text-[12px] text-muted">
        <Globe size={14} />
        The link card is always saved first — enrichment (stars, README, AI summary) never blocks a save.
      </div>
    </Modal>
  );
}
