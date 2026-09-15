import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Blocks, Bookmark, FolderPlus, Mail, MessageCircle, PlusCircle, Quote, Terminal } from "lucide-react";
import { formatNumber } from "@kosh/shared";
import { useData } from "@/data/store";
import { useUi } from "@/data/ui";
import { live } from "@/data/selectors";
import { itemIcon } from "@/lib/icons";
import { ago } from "@/lib/time";
import { PageHeader, SectionCard } from "@/components/common";
import { QuickAdd } from "@/components/quickadd/QuickAdd";

/** Dedicated "Add" module — a full page (not a popup) for capturing and creating. */
export function Add() {
  const items = useData((s) => s.items);
  const openSkillEditor = useUi((s) => s.openSkillEditor);
  const openItem = useUi((s) => s.openItem);
  const navigate = useNavigate();

  const recent = useMemo(
    () => live(items).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 6),
    [items],
  );

  const creators = [
    { icon: Quote, title: "New prompt", desc: "A reusable prompt with {{variables}} and fill-and-copy.", accent: "var(--primary)", onClick: () => navigate("/prompts?new=1") },
    { icon: Blocks, title: "New skill", desc: "Author a SKILL.md with live lint, scan and preview.", accent: "var(--tool-claude)", onClick: () => openSkillEditor() },
    { icon: FolderPlus, title: "New collection", desc: "Group links, skills and prompts together.", accent: "var(--gold)", onClick: () => navigate("/collections?new=1") },
  ];

  const waysIn = [
    { icon: Terminal, title: "CLI", desc: "npx kosh add pdf-tools" },
    { icon: MessageCircle, title: "Telegram bot", desc: "Send a link, .md/.zip or text" },
    { icon: Bookmark, title: "Bookmarklet", desc: "Save any page in one click" },
    { icon: Mail, title: "Email-in", desc: "Forward a newsletter → Inbox" },
  ];

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <PageHeader title="Add to Kosh" subtitle={`Capture a link, drop a folder, or create something new — your treasury has ${formatNumber(live(items).length)} things.`} icon={PlusCircle} />

      {/* primary capture */}
      <QuickAdd />

      {/* create */}
      <div>
        <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-faint">Create</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {creators.map((c) => {
            const Icon = c.icon;
            return (
              <button
                key={c.title}
                onClick={c.onClick}
                className="group flex flex-col items-start rounded-[var(--radius-card)] border border-border bg-surface p-4 text-left card-hover hover:border-border-strong"
              >
                <span className="mb-3 grid h-10 w-10 place-items-center rounded-xl" style={{ backgroundColor: `color-mix(in oklab, ${c.accent} 15%, transparent)`, color: c.accent }}>
                  <Icon size={19} />
                </span>
                <span className="text-[14.5px] font-semibold">{c.title}</span>
                <span className="mt-0.5 text-[12.5px] leading-snug text-muted">{c.desc}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* recently added */}
      {recent.length > 0 && (
        <SectionCard
          title="Recently added"
          action={
            <button onClick={() => navigate("/library")} className="inline-flex items-center gap-1 text-[13px] font-medium text-primary hover:opacity-80">
              View all <ArrowRight size={14} />
            </button>
          }
        >
          <div className="divide-y divide-border">
            {recent.map((i) => {
              const Icon = itemIcon(i);
              return (
                <button key={i.id} onClick={() => openItem(i.id)} className="flex w-full items-center gap-3 py-2.5 text-left first:pt-0 last:pb-0 hover:opacity-80">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted">
                    <Icon size={15} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13.5px] font-medium">{i.title ?? i.url}</div>
                    <div className="truncate text-[11.5px] text-muted">{i.ai?.summary ?? i.description ?? i.meta?.siteName}</div>
                  </div>
                  <span className="shrink-0 text-[11px] text-faint">{ago(i.createdAt)}</span>
                </button>
              );
            })}
          </div>
        </SectionCard>
      )}

      {/* other ways in */}
      <div>
        <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-faint">Other ways in</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {waysIn.map((w) => {
            const Icon = w.icon;
            return (
              <button key={w.title} onClick={() => navigate("/settings")} className="flex flex-col items-start rounded-[var(--radius-control)] border border-border bg-surface p-3 text-left card-hover hover:border-border-strong">
                <Icon size={16} className="mb-2 text-muted" />
                <span className="text-[13px] font-medium">{w.title}</span>
                <span className="mt-0.5 text-[11.5px] leading-snug text-muted">{w.desc}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
