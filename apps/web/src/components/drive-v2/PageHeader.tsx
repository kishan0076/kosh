import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronRight, Folder, FolderPlus, HardDrive, MoreHorizontal, Trash2, Upload } from "lucide-react";
import { formatBytes } from "@kosh/shared";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui";
import { Menu, MenuItem, MenuLabel } from "@/components/overlays";
import { PHONE_QUERY, useMediaQuery } from "@/lib/useMediaQuery";
import { useDriveV2, type DriveView } from "@/data/driveV2";
import { getDragIds, hasDriveDrag } from "./dnd";

/** Per-view header copy — gives every destination a real identity (was a one-word span). */
const VIEW_META: Record<DriveView, { eyebrow: string; title: string; desc: string; accent?: boolean }> = {
  myDrive: { eyebrow: "Browse", title: "My Drive", desc: "Everything in your Drive, organized your way." },
  recent: { eyebrow: "Browse", title: "Recent", desc: "Files you've opened or edited lately." },
  starred: { eyebrow: "Browse", title: "Starred", desc: "Your flagged files and folders, one tap away.", accent: true },
  shared: { eyebrow: "Browse", title: "Shared with me", desc: "Files other people have shared with you." },
  trash: { eyebrow: "Browse", title: "Trash", desc: "Deleted items rest here for 30 days before they're gone." },
  search: { eyebrow: "Browse", title: "Search results", desc: "Matches across your Drive." },
};

export interface HeaderStats {
  count: number;
  bytes: number;
  folders: number;
}

/**
 * The section header band. Renders the gold "light in the vault" hairline, an eyebrow + display-font
 * title (or the breadcrumb rail for My Drive), a mono stat pill, a one-line description, and the
 * per-view primary actions.
 */
export function PageHeader({ stats, onNewFolder, onUpload }: { stats: HeaderStats; onNewFolder: () => void; onUpload: () => void }) {
  const view = useDriveV2((s) => s.view);
  const searchQuery = useDriveV2((s) => s.searchQuery);
  const spaceId = useDriveV2((s) => s.spaceId);
  const spaceName = useDriveV2((s) => s.spaceName);
  const openDialog = useDriveV2((s) => s.openDialog);
  const meta = VIEW_META[view];
  const title = view === "myDrive" && spaceId ? spaceName ?? meta.title : meta.title;

  const statPill = [
    `${stats.count.toLocaleString()} item${stats.count === 1 ? "" : "s"}`,
    stats.bytes > 0 ? formatBytes(stats.bytes) : null,
    stats.folders > 0 ? `${stats.folders} folder${stats.folders === 1 ? "" : "s"}` : null,
  ].filter(Boolean).join(" · ");

  return (
    <header className="relative px-1 pb-4 pt-1">
      {/* gold light hairline */}
      <span className="pointer-events-none absolute inset-x-0 top-0 block h-px bg-gradient-to-r from-transparent via-gold/45 to-transparent" />
      <span className="pointer-events-none absolute inset-x-0 top-0 -z-10 block h-16 mesh opacity-30" />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0 max-w-full">
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">{meta.eyebrow}</div>
          {view === "myDrive" ? (
            <PathRail rootLabel={spaceName ?? "My Drive"} />
          ) : (
            <div className="flex items-center gap-2.5">
              <h1 className={cn("font-display text-[22px] leading-tight", meta.accent && "")}>{title}</h1>
              {meta.accent && <span className="h-1.5 w-1.5 rounded-full bg-gold" />}
            </div>
          )}
          <p className="mt-1 max-w-xl text-[12.5px] text-muted">
            {view === "search" && searchQuery ? <>Results for <span className="font-mono text-foreground">“{searchQuery}”</span></> : meta.desc}
          </p>
          {/* Phones have no room for the pill beside the actions — the count/size line goes under the copy. */}
          {statPill && <span className="mt-1 block font-mono text-[11px] tabular text-faint sm:hidden">{statPill}</span>}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {statPill && <span className="hidden rounded-[var(--radius-chip)] bg-surface-2 px-2.5 py-1 font-mono text-[11.5px] tabular text-muted sm:inline">{statPill}</span>}
          {view === "trash" ? (
            <Button variant="outline" size="sm" className="border-danger/40 text-danger hover:bg-danger-soft" onClick={() => openDialog({ kind: "empty-trash" })}><Trash2 size={14} /> Empty trash</Button>
          ) : view === "myDrive" ? (
            <>
              <Button variant="secondary" size="sm" onClick={onNewFolder}><FolderPlus size={15} /> New folder</Button>
              <Button variant="primary" size="sm" onClick={onUpload}><Upload size={15} /> Upload</Button>
            </>
          ) : null}
        </div>
      </div>
    </header>
  );
}

/** The My-Drive breadcrumb, rebuilt as scrollable chips that still accept internal drops (move).
 *  Every crumb is `shrink-0 whitespace-nowrap` so the rail genuinely scrolls instead of squeezing
 *  labels to one character; on phones the ancestors fold into a "…" menu (… › parent › current). */
function PathRail({ rootLabel }: { rootLabel: string }) {
  const path = useDriveV2((s) => s.path);
  const goRoot = useDriveV2((s) => s.goRoot);
  const breadcrumbTo = useDriveV2((s) => s.breadcrumbTo);
  const spaceId = useDriveV2((s) => s.spaceId);
  const phone = useMediaQuery(PHONE_QUERY);
  const railRef = useRef<HTMLDivElement>(null);
  // Keep the current folder in view: a deep path scrolls the rail to its end on every navigation.
  useEffect(() => {
    const el = railRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [path]);

  // On phones with two or more levels, everything before the parent folds into the "…" menu.
  const folded = phone && path.length >= 2 ? path.slice(0, -1) : [];
  const shown = phone && path.length >= 2 ? path.slice(-1) : path;
  const showRoot = !(phone && path.length >= 2);
  const parent = phone && path.length >= 2 ? path[path.length - 2]! : null;
  const crumbText = "font-display text-[17px] leading-tight sm:text-[19px]";

  return (
    <div ref={railRef} className="-mb-1 flex max-w-full items-center gap-0.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {showRoot && (
        <Crumb folderId={spaceId ?? "root"} onClick={() => goRoot()} icon={<HardDrive size={16} className="shrink-0 text-primary" />}>
          <span className={crumbText}>{rootLabel}</span>
        </Crumb>
      )}
      {folded.length > 0 && parent && (
        <>
          <Menu width={260} trigger={({ toggle, ref }) => (
            <button ref={ref} onClick={toggle} aria-label="Show parent folders" className="pressable grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-control)] text-muted transition-colors hover:bg-surface-2 [@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:w-10">
              <MoreHorizontal size={18} />
            </button>
          )}>
            <MenuLabel>Path</MenuLabel>
            <MenuItem icon={HardDrive} onClick={() => goRoot()}>{rootLabel}</MenuItem>
            {folded.slice(0, -1).map((f, i) => (
              <MenuItem key={f.id} icon={Folder} onClick={() => breadcrumbTo(i)}>{f.name}</MenuItem>
            ))}
          </Menu>
          <span className="flex shrink-0 items-center gap-0.5 whitespace-nowrap">
            <ChevronRight size={16} className="shrink-0 text-faint" />
            <Crumb folderId={parent.id} onClick={() => breadcrumbTo(path.length - 2)}>
              <span className={cn("max-w-[88px] truncate text-muted sm:max-w-[120px]", crumbText)}>{parent.name}</span>
            </Crumb>
          </span>
        </>
      )}
      {shown.map((f) => {
        const i = path.indexOf(f);
        // The current folder is the one crumb that may shrink on phones (it truncates), so the folded
        // rail always fits: "… › parent › current" without a sideways scroll.
        return (
          <span key={f.id} className={cn("flex items-center gap-0.5 whitespace-nowrap", i === path.length - 1 ? "min-w-0 shrink sm:shrink-0" : "shrink-0")}>
            <ChevronRight size={16} className="shrink-0 text-faint" />
            {i === path.length - 1 ? (
              <span className={cn("min-w-0 truncate px-1.5 font-semibold sm:max-w-[220px]", crumbText)}>{f.name}</span>
            ) : (
              <Crumb folderId={f.id} onClick={() => breadcrumbTo(i)}>
                <span className={cn("max-w-[140px] truncate text-muted", crumbText)}>{f.name}</span>
              </Crumb>
            )}
          </span>
        );
      })}
    </div>
  );
}

/** A breadcrumb chip that accepts an internal drag to move items into that folder. */
function Crumb({ folderId, onClick, children, icon }: { folderId: string; onClick: () => void; children: ReactNode; icon?: ReactNode }) {
  const move = useDriveV2((s) => s.move);
  const [over, setOver] = useState(false);
  return (
    <button
      onClick={onClick}
      onDragOver={(e) => { if (hasDriveDrag(e)) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setOver(true); } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false); }}
      onDrop={(e) => { if (!hasDriveDrag(e)) return; e.preventDefault(); setOver(false); const ids = getDragIds(e); if (ids?.length) void move(ids, folderId); }}
      className={cn("pressable flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[var(--radius-control)] px-1.5 py-0.5 transition-colors hover:bg-surface-2 [@media(pointer:coarse)]:min-h-10", over && "bg-primary-soft ring-1 ring-primary")}
    >
      {icon}
      {children}
    </button>
  );
}
