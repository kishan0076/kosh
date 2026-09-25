import { useState, type ReactNode } from "react";
import { motion } from "motion/react";
import {
  Activity,
  Bookmark,
  Check,
  ChevronRight,
  ChevronsLeft,
  Clock,
  FolderPlus,
  HardDrive,
  PanelLeftClose,
  Plus,
  Sparkles,
  Star,
  Trash2,
  Upload,
  Users,
  Wand2,
  X,
} from "lucide-react";
import { formatBytes } from "@kosh/shared";
import { cn } from "@/lib/cn";
import { startConnect } from "@/lib/connect";
import { useDriveV2, type DriveView } from "@/data/driveV2";
import { Avatar, Progress } from "@/components/ui";
import { Menu, MenuItem, MenuLabel, MenuSeparator, Tooltip } from "@/components/overlays";

const RAIL_KEY = "kosh.driveV2.railCollapsed";

/** Avatar wrapped in an SVG ring that doubles as the storage-usage meter. */
function StorageRing({ pct, size = 44, children }: { pct: number; size?: number; children: ReactNode }) {
  const stroke = 3;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const dash = (Math.min(100, Math.max(0, pct)) / 100) * circ;
  const tone = pct > 95 ? "var(--danger)" : pct > 80 ? "var(--warn)" : "var(--primary)";
  return (
    <span className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="absolute inset-0 -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={tone} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${dash} ${circ}`} style={{ transition: "stroke-dasharray .7s cubic-bezier(0.2,0.8,0.2,1)" }} />
      </svg>
      {children}
    </span>
  );
}

interface NavDef {
  v: DriveView | "insights" | "activity" | "cleanup";
  label: string;
  icon: typeof HardDrive;
  gold?: boolean;
}
const BROWSE: NavDef[] = [
  { v: "myDrive", label: "My Drive", icon: HardDrive },
  { v: "recent", label: "Recent", icon: Clock },
  { v: "starred", label: "Starred", icon: Star, gold: true },
  { v: "shared", label: "Shared with me", icon: Users },
  { v: "trash", label: "Trash", icon: Trash2 },
];
const MANAGE: NavDef[] = [
  { v: "insights", label: "Storage", icon: Sparkles },
  { v: "activity", label: "Activity", icon: Activity },
  { v: "cleanup", label: "AI Cleanup", icon: Wand2 }, // opens a modal; shown only when AI is configured
];

export function DriveRail({ onNewFolder, onUpload, variant = "sidebar", onNavigate }: { onNewFolder: () => void; onUpload: () => void; variant?: "sidebar" | "drawer"; onNavigate?: () => void }) {
  const accounts = useDriveV2((s) => s.accounts);
  const accountId = useDriveV2((s) => s.accountId);
  const view = useDriveV2((s) => s.view);
  const insightsOpen = useDriveV2((s) => s.insightsOpen);
  const activityOpen = useDriveV2((s) => s.activityOpen);
  const quota = useDriveV2((s) => s.quota);
  const spaces = useDriveV2((s) => s.spaces);
  const spaceId = useDriveV2((s) => s.spaceId);
  const spaceName = useDriveV2((s) => s.spaceName);
  const account = accounts.find((a) => a.id === accountId);
  const sync = useDriveV2((s) => s.sync);
  const collections = useDriveV2((s) => s.collections);
  const searchQuery = useDriveV2((s) => s.searchQuery);
  const aiEnabled = useDriveV2((s) => s.aiEnabled);

  const [collapsedState, setCollapsed] = useState(() => { try { return localStorage.getItem(RAIL_KEY) === "1"; } catch { return false; } });
  const toggleCollapsed = () => setCollapsed((c) => { const n = !c; try { localStorage.setItem(RAIL_KEY, n ? "1" : "0"); } catch { /* ignore */ } return n; });
  const isDrawer = variant === "drawer";
  const collapsed = isDrawer ? false : collapsedState; // a drawer is always fully expanded (mobile)

  const pctRaw = quota?.limit ? Math.min(100, (quota.usage / quota.limit) * 100) : 0;
  const pct = Math.round(pctRaw); // used for the ring + tone thresholds
  // A precise label so a huge quota (e.g. 12 GB of 5 TB) reads "0.2%" not a bare, broken-looking "0%".
  const pctLabel = pctRaw >= 10 ? `${Math.round(pctRaw)}%` : pctRaw >= 0.1 ? `${pctRaw.toFixed(1)}%` : quota && quota.usage > 0 ? "<0.1%" : "0%";
  const barVal = Math.max(pctRaw, quota && quota.usage > 0 ? 1.5 : 0); // keep a visible sliver when anything is used

  const activeKey = activityOpen ? "activity" : insightsOpen ? "insights" : view;
  const go = (v: NavDef["v"]) => {
    const s = useDriveV2.getState();
    if (v === "insights") s.setInsights(true);
    else if (v === "activity") s.setActivity(true);
    else if (v === "cleanup") s.openDialog({ kind: "cleanup" }); // a modal launcher, not a persistent view
    else s.setView(v);
    onNavigate?.(); // close the mobile drawer after a nav tap
  };
  const manage = MANAGE.filter((d) => d.v !== "cleanup" || aiEnabled);

  const Item = ({ def }: { def: NavDef }) => {
    const active = activeKey === def.v;
    const Icon = def.icon;
    const btn = (
      <button
        onClick={() => go(def.v)}
        aria-label={def.label}
        className={cn(
          "relative flex w-full items-center gap-2.5 rounded-[var(--radius-control)] px-3 text-[14px] font-medium transition-colors",
          collapsed ? "h-10 justify-center px-0" : "h-10",
          active ? "bg-primary-soft text-primary" : "text-muted hover:bg-surface-2 hover:text-foreground",
        )}
      >
        {active && <motion.span layoutId="drive-rail-active" transition={{ type: "spring", stiffness: 380, damping: 32, mass: 0.8 }} className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-primary" />}
        <Icon size={18} className={cn("shrink-0", def.gold && "text-gold", def.gold && active && "fill-gold")} />
        {!collapsed && <span className="flex-1 truncate text-left">{def.label}</span>}
        {!collapsed && def.v === "activity" && <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", sync.status === "error" ? "bg-danger" : sync.status === "live" ? "bg-ok" : sync.status === "syncing" ? "bg-primary" : "bg-faint")} />}
      </button>
    );
    return collapsed ? <Tooltip label={def.label} side="bottom">{btn}</Tooltip> : btn;
  };

  return (
    <aside className={cn("flex flex-col rounded-[var(--radius-panel)] border border-border bg-surface p-3 lg:h-full lg:overflow-y-auto", isDrawer && "h-full overflow-y-auto shadow-[var(--shadow-pop)]", collapsed ? "w-[68px]" : "w-full lg:w-[248px]")}>
      {/* WorkspaceCrest */}
      <Menu
        align="start"
        width={248}
        trigger={({ toggle, ref }) => (
          <button ref={ref} onClick={toggle} className={cn("relative flex shrink-0 items-center gap-2.5 overflow-hidden rounded-[var(--radius-control)] border border-gold/25 p-1.5 text-left transition-colors hover:bg-surface-2", collapsed && "justify-center border-transparent")}>
            <span className="pointer-events-none absolute inset-0 -z-10 mesh opacity-30" />
            <StorageRing pct={pct}>
              <Avatar name={account?.name ?? "Account"} src={account?.picture} size={34} />
            </StorageRing>
            {!collapsed && (
              <span className="min-w-0 flex-1">
                <span className="block truncate font-display text-[13.5px] leading-tight">{account?.name ?? "Account"}</span>
                <span className="block truncate text-[11px] text-muted">{spaceId ? spaceName : account?.email}</span>
              </span>
            )}
            {!collapsed && <ChevronRight size={15} className="shrink-0 text-faint" />}
          </button>
        )}
      >
        <MenuLabel>Google accounts</MenuLabel>
        {accounts.map((a) => (
          <MenuItem key={a.id} icon={a.id === accountId ? Check : HardDrive} onClick={() => { void useDriveV2.getState().selectAccount(a.id); onNavigate?.(); }}>{a.email}</MenuItem>
        ))}
        <MenuItem icon={Plus} onClick={() => { void startConnect("google", "drive-v2"); }}>Connect account</MenuItem>
        {spaces.length > 0 && (
          <>
            <MenuSeparator />
            <MenuLabel>Spaces</MenuLabel>
            <MenuItem icon={spaceId === null ? Check : HardDrive} onClick={() => { void useDriveV2.getState().selectSpace(null); onNavigate?.(); }}>My Drive</MenuItem>
            {spaces.map((d) => (
              <MenuItem key={d.id} icon={spaceId === d.id ? Check : Users} onClick={() => { void useDriveV2.getState().selectSpace(d.id); onNavigate?.(); }}>{d.name}</MenuItem>
            ))}
          </>
        )}
      </Menu>

      {/* New split-button */}
      <div className="mt-3 flex shrink-0 items-stretch gap-px overflow-hidden rounded-[var(--radius-control)]">
        <button onClick={onNewFolder} className={cn("flex flex-1 items-center justify-center gap-2 bg-primary text-[13.5px] font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover", collapsed ? "h-10" : "h-10")} aria-label="New folder">
          <Plus size={17} /> {!collapsed && "New"}
        </button>
        {!collapsed && (
          <Menu
            align="start"
            width={180}
            trigger={({ toggle, ref }) => (
              <button ref={ref} onClick={toggle} className="grid w-9 place-items-center bg-primary text-primary-foreground transition-colors hover:bg-primary-hover [@media(pointer:coarse)]:w-10" aria-label="More create options"><ChevronRight size={15} className="rotate-90" /></button>
            )}
          >
            <MenuItem icon={FolderPlus} onClick={onNewFolder}>New folder</MenuItem>
            <MenuItem icon={Upload} onClick={onUpload}>Upload files</MenuItem>
          </Menu>
        )}
      </div>

      {/* Grouped nav */}
      <nav className="mt-3 shrink-0 space-y-0.5">
        {!collapsed && <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-faint">Browse</div>}
        {BROWSE.map((d) => <Item key={d.v} def={d} />)}
        <div className="my-2 h-px bg-border" />
        {!collapsed && <div className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-faint">Manage</div>}
        {manage.map((d) => <Item key={d.v} def={d} />)}

        {/* Smart collections — named saved searches, run through the search API on click. */}
        {!collapsed && (collections.length > 0 || view === "search") && (
          <>
            <div className="my-2 h-px bg-border" />
            <div className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-faint">Collections</div>
            {collections.map((c) => (
              <div key={c.id} className="group/col flex items-center gap-1">
                <button
                  onClick={() => { useDriveV2.getState().openCollection(c); onNavigate?.(); }}
                  title={c.query}
                  className="flex h-9 min-w-0 flex-1 items-center gap-2.5 rounded-[var(--radius-control)] px-3 text-[13.5px] font-medium text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
                >
                  <Bookmark size={16} className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate text-left">{c.name}</span>
                </button>
                <button onClick={() => useDriveV2.getState().removeCollection(c.id)} className="shrink-0 rounded p-1 text-faint opacity-0 transition-opacity hover:text-danger group-hover/col:opacity-100 [@media(pointer:coarse)]:opacity-100" aria-label={`Remove collection ${c.name}`}><X size={13} /></button>
              </div>
            ))}
            {view === "search" && searchQuery.trim() && !collections.some((c) => c.query === searchQuery.trim()) && (
              <button
                onClick={() => useDriveV2.getState().saveCollection(searchQuery.trim(), searchQuery.trim())}
                className="flex h-9 w-full items-center gap-2.5 rounded-[var(--radius-control)] px-3 text-[13px] font-medium text-primary transition-colors hover:bg-surface-2"
              >
                <Plus size={16} className="shrink-0" /> <span className="truncate">Save this search</span>
              </button>
            )}
          </>
        )}
      </nav>

      {/* StorageMeter + collapse */}
      <div className="mt-auto shrink-0 space-y-2 pt-3">
        {quota && !collapsed && (
          <button onClick={() => useDriveV2.getState().setInsights(true)} className="block w-full rounded-[var(--radius-control)] border border-border bg-surface-2 p-3 text-left transition-colors hover:border-border-strong">
            <div className="flex items-baseline justify-between">
              <span className="font-display text-[20px] tabular leading-none">{quota.limit ? pctLabel : formatBytes(quota.usage)}</span>
              {quota.limit && pct > 80 && <span className="rounded-[var(--radius-chip)] bg-gold-soft px-1.5 py-0.5 text-[11px] font-semibold text-gold">Reclaim space</span>}
            </div>
            {quota.limit ? <Progress value={barVal} className="mt-2" tone={pct > 95 ? "danger" : pct > 80 ? "warn" : "primary"} /> : null}
            <div className="mt-1.5 font-mono text-[11.5px] tabular text-muted">{quota.limit ? `${formatBytes(quota.usage)} / ${formatBytes(quota.limit)}` : "used"}</div>
          </button>
        )}
        {!isDrawer && (
          <button onClick={toggleCollapsed} className={cn("flex w-full items-center gap-2.5 rounded-[var(--radius-control)] px-3 py-2 text-[12.5px] font-medium text-faint transition-colors hover:bg-surface-2 hover:text-foreground", collapsed && "justify-center px-0")} aria-label={collapsed ? "Expand" : "Collapse"}>
            {collapsed ? <PanelLeftClose size={17} className="rotate-180" /> : <ChevronsLeft size={17} />}
            {!collapsed && "Collapse"}
          </button>
        )}
      </div>
    </aside>
  );
}
