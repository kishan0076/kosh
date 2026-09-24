import { useNavigate } from "react-router-dom";
import { Bell, FolderLock, LogOut, Menu as MenuIcon, Plus, RefreshCw, Search, SlidersHorizontal, User } from "lucide-react";
import { useData } from "@/data/store";
import { backendEnabled } from "@/data/api";
import { watchedChanges } from "@/data/selectors";
import { useUi } from "@/data/ui";
import { Avatar, Button, Kbd } from "../ui";
import { Menu, MenuItem, MenuLabel, MenuSeparator } from "../overlays";
import { ThemeToggle } from "../ThemeToggle";

export function Topbar({ onOpenMobileNav }: { onOpenMobileNav: () => void }) {
  const user = useData((s) => s.user);
  const items = useData((s) => s.items);
  const resetVault = useData((s) => s.resetVault);
  const signOut = useData((s) => s.signOut);
  const setPalette = useUi((s) => s.setPalette);
  const toast = useUi((s) => s.toast);
  const openConfirm = useUi((s) => s.openConfirm);
  const navigate = useNavigate();

  const changes = watchedChanges(items);
  const changeCount = changes.reduce((a, i) => a + (i.github?.watch?.newSince ?? 0), 0);

  return (
    <header className="sticky top-0 z-30 flex h-topbar-safe items-center gap-3 border-b border-border bg-background/85 px-4 pt-safe backdrop-blur-md sm:px-6">
      <Button variant="ghost" size="icon" onClick={onOpenMobileNav} className="lg:hidden" aria-label="Open menu">
        <MenuIcon size={20} />
      </Button>

      {/* search / palette trigger */}
      <button
        onClick={() => setPalette(true)}
        className="group flex h-10 min-w-0 flex-1 items-center gap-2.5 rounded-[var(--radius-control)] border border-border bg-surface px-3.5 text-muted transition-colors hover:border-border-strong hover:bg-surface-2 sm:max-w-md"
      >
        <Search size={16} className="shrink-0" />
        <span className="min-w-0 flex-1 truncate whitespace-nowrap text-left text-[13.5px]">
          <span className="sm:hidden">Search…</span>
          <span className="hidden sm:inline">Search or paste a link…</span>
        </span>
        <span className="hidden shrink-0 items-center gap-1 sm:flex">
          <Kbd>⌘</Kbd>
          <Kbd>K</Kbd>
        </span>
      </button>

      {/* On phones the spacer would halve the search pill (both are flex-1) — let search take the row. */}
      <div className="hidden flex-1 sm:block" />

      <div className="flex items-center gap-1.5 sm:gap-2">
        <Button variant="primary" size="sm" className="hidden sm:inline-flex" onClick={() => navigate("/add")}>
          <Plus size={16} />
          Add
        </Button>

        <ThemeToggle compact />

        {/* notifications */}
        <Menu
          align="end"
          width={300}
          trigger={({ toggle, ref }) => (
            <button
              ref={ref}
              onClick={toggle}
              className="relative grid h-9 w-9 place-items-center rounded-[var(--radius-control)] border border-border text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
              aria-label="Notifications"
            >
              <Bell size={17} />
              {changeCount > 0 && (
                <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                  {changeCount}
                </span>
              )}
            </button>
          )}
        >
          <MenuLabel>Watched changes</MenuLabel>
          {changes.length === 0 && <div className="px-2.5 py-3 text-[13px] text-muted">Nothing new upstream.</div>}
          {changes.map((i) => (
            <MenuItem key={i.id} icon={RefreshCw} onClick={() => navigate(`/library`)}>
              <span className="flex flex-col">
                <span className="truncate font-medium">{i.title}</span>
                <span className="text-[11px] text-faint">{i.github?.watch?.newSince} new items</span>
              </span>
            </MenuItem>
          ))}
        </Menu>

        {/* avatar */}
        <Menu
          align="end"
          width={220}
          trigger={({ toggle, ref }) => (
            <button ref={ref} onClick={toggle} className="rounded-full ring-offset-2 ring-offset-background transition-shadow hover:ring-2 hover:ring-border-strong" aria-label="Account">
              <Avatar name={user.name} src={user.avatarUrl} size={36} />
            </button>
          )}
        >
          <div className="px-2.5 py-2">
            <div className="text-sm font-semibold">{user.name}</div>
            <div className="text-[12px] text-muted">@{user.login}</div>
          </div>
          <MenuSeparator />
          <MenuItem icon={User} onClick={() => navigate("/settings")}>
            Settings
          </MenuItem>
          <MenuItem icon={SlidersHorizontal} onClick={() => navigate("/settings")}>
            Preferences
          </MenuItem>
          {user.isAdmin && (
            <MenuItem icon={FolderLock} onClick={() => navigate("/vault")}>
              Secure Vault
            </MenuItem>
          )}
          <MenuSeparator />
          <MenuItem
            icon={RefreshCw}
            onClick={() =>
              openConfirm({
                title: "Reset demo data?",
                message: "This replaces your current vault with the original demo content. Any changes you've made will be lost.",
                confirmLabel: "Reset vault",
                onConfirm: () => { resetVault(); toast({ message: "Vault reset to demo data", tone: "ok" }); },
              })
            }
          >
            Reset demo data
          </MenuItem>
          {/* Backend mode ends the real session (cookie on the web, Bearer token in the native app);
              demo mode has nothing to sign out of. */}
          <MenuItem icon={LogOut} danger onClick={() => (backendEnabled ? void signOut() : toast({ message: "This is a demo — no real sign-out", tone: "warn" }))}>
            Sign out
          </MenuItem>
        </Menu>
      </div>
    </header>
  );
}
