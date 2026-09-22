import { NavLink } from "react-router-dom";
import {
  Blocks,
  ChevronLeft,
  FolderOpen,
  Github,
  HardDrive,
  HelpCircle,
  Home,
  Inbox,
  LibraryBig,
  PanelLeftClose,
  Plus,
  Quote,
  Settings,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import { formatBytes } from "@kosh/shared";
import { cn } from "@/lib/cn";
import { useData } from "@/data/store";
import { inbox, live } from "@/data/selectors";
import { useUi } from "@/data/ui";
import { Logo } from "./Logo";
import { Tooltip } from "../overlays";
import { Progress } from "../ui";

interface NavItem {
  to: string;
  label: string;
  icon: typeof Home;
  badge?: number;
  end?: boolean;
}

export function Sidebar({
  collapsed,
  onToggleCollapse,
  mobileOpen,
  onCloseMobile,
}: {
  collapsed: boolean;
  onToggleCollapse: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}) {
  const items = useData((s) => s.items);
  const collections = useData((s) => s.collections);
  const user = useData((s) => s.user);
  const setHelp = useUi((s) => s.setHelp);

  const inboxCount = inbox(items).length;
  const trashCount = items.filter((i) => i.deletedAt).length;
  const skillCount = live(items).filter((i) => i.kind === "skill").length;
  const promptCount = live(items).filter((i) => i.kind === "prompt").length;

  const main: NavItem[] = [
    { to: "/", label: "Home", icon: Home, end: true },
    { to: "/add", label: "Add", icon: Plus },
    { to: "/inbox", label: "Inbox", icon: Inbox, badge: inboxCount },
    { to: "/library", label: "Library", icon: LibraryBig },
    { to: "/skills", label: "Skills", icon: Blocks, badge: skillCount },
    { to: "/prompts", label: "Prompts", icon: Quote, badge: promptCount },
    { to: "/github", label: "GitHub", icon: Github },
    { to: "/drive-v2", label: "Drive", icon: HardDrive },
    { to: "/drive", label: "Drive (classic)", icon: UploadCloud },
  ];

  const storagePct = Math.round((user.storageUsed / user.storageQuota) * 100);
  const budgetPct = Math.round((user.githubBudget.remaining / user.githubBudget.total) * 100);

  return (
    <>
      {/* mobile scrim */}
      {mobileOpen && <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={onCloseMobile} />}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex flex-col border-r border-border bg-surface transition-[width,transform] duration-300 lg:static lg:z-auto lg:translate-x-0",
          collapsed ? "w-[76px]" : "w-[248px]",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        {/* brand */}
        <div className={cn("flex h-16 items-center px-4", collapsed ? "justify-center" : "justify-between")}>
          <NavLink to="/" onClick={onCloseMobile}>
            <Logo collapsed={collapsed} />
          </NavLink>
          <button onClick={onCloseMobile} className="rounded-md p-1.5 text-muted hover:bg-surface-2 lg:hidden" aria-label="Close menu">
            <X size={18} />
          </button>
        </div>

        {/* nav */}
        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-2">
          {main.map((item) => (
            <NavRow key={item.to} item={item} collapsed={collapsed} onClick={onCloseMobile} />
          ))}

          <div className="pt-4">
            {!collapsed && <div className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-faint">Collections</div>}
            {collapsed ? (
              <NavRow item={{ to: "/collections", label: "Collections", icon: FolderOpen }} collapsed onClick={onCloseMobile} />
            ) : (
              <>
                {collections.map((c) => (
                  <NavLink
                    key={c.id}
                    to={`/collections/${c.slug}`}
                    onClick={onCloseMobile}
                    className={({ isActive }) =>
                      cn(
                        "flex items-center gap-2.5 rounded-[var(--radius-control)] px-3 py-2 text-[13.5px] font-medium transition-colors",
                        isActive ? "bg-primary-soft text-primary" : "text-muted hover:bg-surface-2 hover:text-foreground",
                      )
                    }
                  >
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: c.color }} />
                    <span className="flex-1 truncate">{c.name}</span>
                    <span className="text-[11px] text-faint">{live(items).filter((i) => i.collections.includes(c.id)).length}</span>
                  </NavLink>
                ))}
                <NavLink
                  to="/collections"
                  onClick={onCloseMobile}
                  className="flex items-center gap-2.5 rounded-[var(--radius-control)] px-3 py-2 text-[13px] text-faint transition-colors hover:bg-surface-2 hover:text-foreground"
                >
                  <FolderOpen size={16} />
                  All collections
                </NavLink>
              </>
            )}
          </div>

          <div className="pt-2">
            <NavRow item={{ to: "/trash", label: "Trash", icon: Trash2, badge: trashCount || undefined }} collapsed={collapsed} onClick={onCloseMobile} />
          </div>
        </nav>

        {/* status card */}
        {!collapsed && (
          <div className="mx-3 mb-2 rounded-[var(--radius-card)] border border-border bg-surface-2 p-3.5 raised">
            <div className="mb-2 flex items-center justify-between text-[11px] font-medium text-muted">
              <span>Storage</span>
              <span className="tabular">{formatBytes(user.storageUsed)} / {formatBytes(user.storageQuota)}</span>
            </div>
            <Progress value={storagePct} />
            <div className="mt-3 mb-2 flex items-center justify-between text-[11px] font-medium text-muted">
              <span>GitHub budget</span>
              <span className="tabular">{user.githubBudget.remaining.toLocaleString()} left</span>
            </div>
            <Progress value={budgetPct} tone="ok" />
          </div>
        )}

        {/* footer */}
        <div className="space-y-1 border-t border-border px-3 py-3">
          <NavRow item={{ to: "/settings", label: "Settings", icon: Settings }} collapsed={collapsed} onClick={onCloseMobile} />
          <button
            onClick={() => {
              setHelp(true);
              onCloseMobile();
            }}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-[var(--radius-control)] px-3 py-2 text-[13.5px] font-medium text-muted transition-colors hover:bg-surface-2 hover:text-foreground",
              collapsed && "justify-center px-0",
            )}
          >
            <HelpCircle size={18} />
            {!collapsed && "Help & shortcuts"}
          </button>
          <button
            onClick={onToggleCollapse}
            className={cn(
              "hidden w-full items-center gap-2.5 rounded-[var(--radius-control)] px-3 py-2 text-[13px] font-medium text-faint transition-colors hover:bg-surface-2 hover:text-foreground lg:flex",
              collapsed && "justify-center px-0",
            )}
          >
            {collapsed ? <PanelLeftClose size={18} className="rotate-180" /> : <ChevronLeft size={18} />}
            {!collapsed && "Collapse"}
          </button>
        </div>
      </aside>
    </>
  );
}

function NavRow({ item, collapsed, onClick }: { item: NavItem; collapsed: boolean; onClick: () => void }) {
  const Icon = item.icon;
  const content = (
    <NavLink
      to={item.to}
      end={item.end}
      onClick={onClick}
      className={({ isActive }) =>
        cn(
          "relative flex items-center gap-2.5 rounded-[var(--radius-control)] px-3 py-2 text-[13.5px] font-medium transition-colors",
          collapsed && "justify-center px-0",
          isActive ? "bg-primary-soft text-primary" : "text-muted hover:bg-surface-2 hover:text-foreground",
        )
      }
    >
      {({ isActive }) => (
        <>
          {isActive && <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-primary" />}
          <Icon size={18} className="shrink-0" />
          {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
          {!collapsed && item.badge ? (
            <span className={cn("rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular", isActive ? "bg-primary text-primary-foreground" : "bg-surface-3 text-muted")}>
              {item.badge}
            </span>
          ) : null}
          {collapsed && item.badge ? <span className="absolute right-2 top-1.5 h-1.5 w-1.5 rounded-full bg-primary" /> : null}
        </>
      )}
    </NavLink>
  );
  return collapsed ? (
    <Tooltip label={item.label} side="bottom">
      {content}
    </Tooltip>
  ) : (
    content
  );
}
