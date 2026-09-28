import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Blocks, Bookmark, FolderPlus, Github, Import, Mail, MessageCircle, PlusCircle, Quote, Terminal } from "lucide-react";
import { formatNumber, parseBookmarks, type BookmarkEntry } from "@kosh/shared";
import { useData } from "@/data/store";
import { useUi } from "@/data/ui";
import { live } from "@/data/selectors";
import { itemIcon } from "@/lib/icons";
import { ago } from "@/lib/time";
import { PageHeader, SectionCard } from "@/components/common";
import { Button } from "@/components/ui";
import { Modal } from "@/components/overlays";
import { api } from "@/data/api";
import { QuickAdd } from "@/components/quickadd/QuickAdd";

/** Dedicated "Add" module — a full page (not a popup) for capturing and creating. */
export function Add() {
  const items = useData((s) => s.items);
  const backend = useData((s) => s.backend);
  const openItem = useUi((s) => s.openItem);
  const navigate = useNavigate();
  const [importOpen, setImportOpen] = useState(false);

  const recent = useMemo(
    () => live(items).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 6),
    [items],
  );

  const creators = [
    { icon: Quote, title: "New prompt", desc: "A reusable prompt with {{variables}} and fill-and-copy.", accent: "var(--primary)", onClick: () => navigate("/prompts?new=1") },
    { icon: Blocks, title: "New skill", desc: "Author a SKILL.md with live lint, scan and preview.", accent: "var(--tool-claude)", onClick: () => navigate("/skills/new") },
    { icon: FolderPlus, title: "New collection", desc: "Group links, skills and prompts together.", accent: "var(--gold)", onClick: () => navigate("/collections?new=1") },
    ...(backend ? [{ icon: Import, title: "Import bookmarks", desc: "Bring in a browser / Pocket / Raindrop export in one go.", accent: "var(--info)", onClick: () => setImportOpen(true) }] : []),
    { icon: Github, title: "Publish to GitHub", desc: "Turn a project folder into a new GitHub repo.", accent: "var(--foreground)", onClick: () => navigate("/publish") },
  ];

  const waysIn = [
    { icon: Terminal, title: "CLI", desc: "npx kosh add pdf-tools" },
    { icon: MessageCircle, title: "Telegram bot", desc: "Send a link, .md/.zip or text" },
    { icon: Bookmark, title: "Bookmarklet", desc: "Save any page in one click" },
    { icon: Mail, title: "Email-in", desc: "Forward a newsletter → Inbox" },
  ];

  return (
    <div className="space-y-8">
      <PageHeader title="Add to Kosh" subtitle={`Capture a link, drop a folder, or create something new — your treasury has ${formatNumber(live(items).length)} things.`} icon={PlusCircle} />

      {/* primary capture */}
      <QuickAdd />

      {/* create — 2-up on phones (like "Other ways in") so the page doesn't push everything below the fold */}
      <div>
        <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-faint">Create</h2>
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          {creators.map((c) => {
            const Icon = c.icon;
            return (
              <button
                key={c.title}
                onClick={c.onClick}
                className="group flex flex-col items-start rounded-[var(--radius-card)] border border-border bg-surface p-3 text-left card-hover hover:border-border-strong sm:p-4"
              >
                <span className="mb-2 grid h-10 w-10 place-items-center rounded-xl sm:mb-3" style={{ backgroundColor: `color-mix(in oklab, ${c.accent} 15%, transparent)`, color: c.accent }}>
                  <Icon size={19} />
                </span>
                <span className="text-[13.5px] font-semibold sm:text-[14.5px]">{c.title}</span>
                <span className="mt-0.5 line-clamp-2 text-[12.5px] leading-snug text-muted">{c.desc}</span>
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
            <Button variant="ghost" size="sm" onClick={() => navigate("/library")}>
              View all <ArrowRight size={14} />
            </Button>
          }
        >
          <div className="divide-y divide-border">
            {recent.map((i) => {
              const Icon = itemIcon(i);
              return (
                <button key={i.id} onClick={() => openItem(i.id)} className="flex w-full items-center gap-3 py-2.5 text-left first:pt-0 last:pb-0 pressable hover:opacity-80">
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

      {importOpen && <ImportBookmarksModal open onClose={() => setImportOpen(false)} />}
    </div>
  );
}

function ImportBookmarksModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useUi((s) => s.toast);
  const navigate = useNavigate();
  const [entries, setEntries] = useState<BookmarkEntry[] | null>(null);
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);

  const IMPORT_CAP = 500;

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setFileName(file.name);
    try {
      const parsed = parseBookmarks(await file.text());
      setEntries(parsed);
      if (!parsed.length) toast({ message: "No bookmarks found", description: "That file had no http(s) links — is it a bookmarks export?", tone: "danger" });
    } catch {
      toast({ message: "Couldn't read that file", tone: "danger" });
    }
  };

  const doImport = async () => {
    if (!entries?.length || busy) return;
    setBusy(true);
    try {
      const r = await api.importBookmarks(entries.slice(0, IMPORT_CAP).map((e) => ({ url: e.url, title: e.title, tags: e.tags })));
      toast({ message: `Imported ${r.saved} bookmark${r.saved === 1 ? "" : "s"}`, description: r.skipped ? `${r.skipped} already saved or skipped` : "Enrichment runs in the background", tone: "ok" });
      onClose();
      navigate("/inbox");
    } catch (err) {
      toast({ message: "Import failed", description: err instanceof Error ? err.message : undefined, tone: "danger" });
    } finally {
      setBusy(false);
    }
  };

  const overCap = (entries?.length ?? 0) > IMPORT_CAP;

  return (
    <Modal open={open} onClose={onClose} className="max-w-lg" labelledBy="import-title">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-5 py-4">
        <Import size={18} className="text-primary" />
        <h2 id="import-title" className="text-base font-semibold">Import bookmarks</h2>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
        <p className="text-[13px] text-muted">Export your bookmarks as an <span className="font-medium text-foreground">HTML</span> file (Chrome, Firefox, Safari, Pocket, Raindrop all support this), then choose it here. Links land in your Inbox and enrich in the background.</p>
        <label className="flex cursor-pointer items-center justify-center gap-2 rounded-[var(--radius-control)] border border-dashed border-border-strong bg-surface-2 px-4 py-6 text-[13px] font-medium text-muted hover:border-primary hover:text-primary">
          <Import size={16} /> {fileName || "Choose a bookmarks .html file"}
          <input type="file" accept=".html,.htm,text/html" className="sr-only" onChange={(e) => void onFile(e.target.files?.[0])} />
        </label>
        {entries && entries.length > 0 && (
          <div>
            <div className="mb-1.5 text-[12px] font-medium text-muted">
              Found {entries.length} link{entries.length === 1 ? "" : "s"}{overCap && ` · importing the first ${IMPORT_CAP}`}
            </div>
            <div className="max-h-52 space-y-1 overflow-y-auto rounded-[var(--radius-control)] border border-border bg-surface p-2">
              {entries.slice(0, 8).map((e) => (
                <div key={e.url} className="min-w-0">
                  <div className="truncate text-[13px] font-medium">{e.title || e.url}</div>
                  <div className="truncate text-[11.5px] text-faint">{e.url}{e.tags?.length ? ` · ${e.tags.map((t) => `#${t}`).join(" ")}` : ""}</div>
                </div>
              ))}
              {entries.length > 8 && <div className="px-1 pt-1 text-[11.5px] text-faint">+ {entries.length - 8} more…</div>}
            </div>
          </div>
        )}
      </div>
      <div className="flex shrink-0 justify-end gap-2 border-t border-border px-5 py-3.5">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={() => void doImport()} disabled={!entries?.length} loading={busy}>
          Import {entries?.length ? Math.min(entries.length, IMPORT_CAP) : ""}
        </Button>
      </div>
    </Modal>
  );
}
