import { useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Clock, CornerDownLeft, CornerUpRight, Download, FolderPlus, HardDrive, Info, LayoutGrid, List as ListIcon, RotateCcw, Search, Share2, Sparkles, Star, Trash2, Upload, Wand2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { Spinner } from "@/components/ui";
import { driveV2Api, type DriveNode } from "@/data/driveV2Api";
import { useDriveV2 } from "@/data/driveV2";
import { NodeIcon } from "./items";

interface Command {
  id: string;
  label: string;
  hint?: string;
  icon: ComponentType<{ size?: number; className?: string }>;
  keywords?: string;
  run: () => void;
}

/** ⌘K command palette: jump between views, run actions, and search-and-open any file. */
export function CommandPalette({ open, onClose, onUpload }: { open: boolean; onClose: () => void; onUpload: () => void }) {
  const accountId = useDriveV2((s) => s.accountId);
  const selection = useDriveV2((s) => s.selection);
  const view = useDriveV2((s) => s.view);
  const aiEnabled = useDriveV2((s) => s.aiEnabled);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DriveNode[]>([]);
  const [searching, setSearching] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setResults([]);
      setActive(0);
      // focus after paint
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Debounced file search (only when there's a query).
  useEffect(() => {
    if (!open || !accountId || query.trim().length < 2) { setResults([]); setSearching(false); return; }
    let live = true;
    setSearching(true);
    const t = window.setTimeout(async () => {
      try {
        const r = await driveV2Api.search(accountId, { text: query.trim() });
        if (live) setResults(r.files.slice(0, 8));
      } catch {
        if (live) setResults([]);
      } finally {
        if (live) setSearching(false);
      }
    }, 220);
    return () => { live = false; window.clearTimeout(t); };
  }, [open, accountId, query]);

  const s = useDriveV2.getState;
  const commands = useMemo<Command[]>(() => {
    const list: Command[] = [];
    // Selection-scoped actions come FIRST so ⌘K acts on what's selected (Move/Share/Trash/Star/Tag).
    const ids = [...selection];
    if (ids.length) {
      const n = ids.length;
      const suffix = n > 1 ? ` ${n} items` : "";
      if (view === "trash") {
        list.push({ id: "sel-restore", label: `Restore${suffix || " item"}`, icon: RotateCcw, keywords: "selection", run: () => void s().restore(ids) });
        list.push({ id: "sel-purge", label: `Delete${suffix || " item"} forever`, icon: Trash2, keywords: "selection remove", run: () => s().openDialog({ kind: "delete", ids, permanent: true }) });
      } else {
        const solo = n === 1 ? s().nodes.find((x) => x.id === ids[0]) : undefined;
        // toggleStarMany toggles each item, so for a single already-starred file the action is "Unstar".
        const starLabel = solo?.starred ? "Unstar item" : `Star${suffix || " item"}`;
        list.push({ id: "sel-star", label: starLabel, icon: Star, keywords: "selection favorite", run: () => void s().toggleStarMany(ids) });
        list.push({ id: "sel-download", label: n === 1 ? "Download item" : `Download ${n} items (ZIP)`, icon: Download, keywords: "selection export zip", run: () => (n === 1 ? void s().downloadNode(ids[0]!) : void s().downloadZip(ids)) });
        list.push({ id: "sel-move", label: `Move${suffix || " item"} to…`, icon: CornerUpRight, keywords: "selection", run: () => s().openDialog({ kind: "move", ids }) });
        list.push({ id: "sel-trash", label: `Trash${suffix || " item"}`, icon: Trash2, keywords: "selection delete", run: () => s().openDialog({ kind: "delete", ids, permanent: false }) });
        if (n === 1) {
          if (solo && solo.capabilities?.canShare !== false) list.push({ id: "sel-share", label: "Share…", icon: Share2, keywords: "selection permission", run: () => s().openDialog({ kind: "share", node: solo }) });
          list.push({ id: "sel-tags", label: "Edit tags…", icon: Info, keywords: "selection label", run: () => void s().loadDetails(ids[0]!) });
        }
      }
    }
    list.push(
      { id: "v-my", label: "Go to My Drive", icon: HardDrive, keywords: "home root", run: () => s().setView("myDrive") },
      { id: "v-recent", label: "Go to Recent", icon: Clock, run: () => s().setView("recent") },
      { id: "v-starred", label: "Go to Starred", icon: Star, run: () => s().setView("starred") },
      { id: "v-trash", label: "Go to Trash", icon: Trash2, run: () => s().setView("trash") },
      { id: "v-insights", label: "Open Insights", icon: Sparkles, keywords: "duplicates largest stale storage", run: () => s().setInsights(true) },
      ...(aiEnabled ? [{ id: "ai-cleanup", label: "AI Cleanup", icon: Wand2, keywords: "clean duplicates stale large reclaim space trash", run: () => s().openDialog({ kind: "cleanup" }) } as Command] : []),
      { id: "a-newfolder", label: "New folder", icon: FolderPlus, keywords: "create", run: () => s().openDialog({ kind: "newFolder", parentId: s().path.at(-1)?.id ?? s().spaceId ?? "root" }) },
      { id: "a-upload", label: "Upload files", icon: Upload, run: onUpload },
      { id: "a-grid", label: "Switch to grid view", icon: LayoutGrid, run: () => s().setLayout("grid") },
      { id: "a-list", label: "Switch to list view", icon: ListIcon, run: () => s().setLayout("list") },
    );
    const q = query.trim().toLowerCase();
    return q ? list.filter((c) => (c.label + " " + (c.keywords ?? "")).toLowerCase().includes(q)) : list;
  }, [query, onUpload, s, selection, view, aiEnabled]);

  // Combined, index-addressable rows: commands first, then file results.
  const fileRows = results.map((node) => ({
    id: "f-" + node.id,
    node,
    run: () => { if (node.isFolder) s().openSearchedFolder(node); else s().setPreview(node); },
  }));
  const total = commands.length + fileRows.length;

  useEffect(() => { setActive(0); }, [query, results.length]);

  function runAt(index: number) {
    if (index < commands.length) commands[index]?.run();
    else fileRows[index - commands.length]?.run();
    onClose();
  }

  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-start justify-center p-4 pt-[12vh]" onClick={onClose}>
      <div className="fixed inset-0 bg-black/45 backdrop-blur-[2px]" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, total - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          else if (e.key === "Enter") { e.preventDefault(); if (total) runAt(active); }
          else if (e.key === "Escape") { e.preventDefault(); onClose(); }
        }}
        className="relative z-10 w-full max-w-xl overflow-hidden rounded-[var(--radius-panel)] border border-border bg-elevated shadow-[var(--shadow-pop)]"
      >
        <div className="flex items-center gap-2.5 border-b border-border px-4">
          <Search size={17} className="shrink-0 text-muted" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search files or run a command…"
            className="w-full bg-transparent py-3.5 text-[14px] outline-none placeholder:text-faint"
          />
          {searching && <Spinner size={15} className="text-muted" />}
        </div>
        <div ref={listRef} className="max-h-[52vh] overflow-y-auto p-1.5">
          {total === 0 ? (
            <div className="px-3 py-8 text-center text-[13px] text-muted">No matches.</div>
          ) : (
            <>
              {commands.length > 0 && <div className="px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-faint">Actions</div>}
              {commands.map((c, i) => (
                <Row key={c.id} active={active === i} onMouseEnter={() => setActive(i)} onClick={() => runAt(i)}>
                  <c.icon size={16} className="shrink-0 text-muted" />
                  <span className="flex-1 truncate">{c.label}</span>
                </Row>
              ))}
              {fileRows.length > 0 && <div className="px-2.5 pb-1 pt-2.5 text-[11px] font-semibold uppercase tracking-wide text-faint">Files</div>}
              {fileRows.map((f, i) => {
                const index = commands.length + i;
                return (
                  <Row key={f.id} active={active === index} onMouseEnter={() => setActive(index)} onClick={() => runAt(index)}>
                    <span className="grid h-5 w-5 shrink-0 place-items-center overflow-hidden rounded"><NodeIcon node={f.node} size={15} /></span>
                    <span className="flex-1 truncate">{f.node.name}</span>
                    {f.node.isFolder && <span className="shrink-0 text-[11px] text-faint">Folder</span>}
                  </Row>
                );
              })}
            </>
          )}
        </div>
        <div className="flex items-center gap-3 border-t border-border px-3 py-2 text-[11px] text-faint">
          <span className="inline-flex items-center gap-1"><CornerDownLeft size={12} /> open</span>
          <span>↑↓ navigate</span>
          <span>esc close</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Row({ active, onClick, onMouseEnter, children }: { active: boolean; onClick: () => void; onMouseEnter: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      className={cn("flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13.5px] transition-colors", active ? "bg-primary-soft text-foreground" : "hover:bg-surface-2")}
    >
      {children}
    </button>
  );
}
