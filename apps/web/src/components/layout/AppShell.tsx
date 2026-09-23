import { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { WifiOff } from "lucide-react";
import { ErrorBoundary } from "../ErrorBoundary";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { CommandPalette } from "../palette/CommandPalette";
import { DetailPanel } from "../detail/DetailPanel";
import { VerdictDialog } from "../detail/VerdictDialog";
import { ConfirmDialog } from "../ConfirmDialog";
import { HelpSheet } from "../HelpSheet";
import { Toaster } from "../Toaster";
import { Button, Spinner } from "../ui";
import { useUi } from "@/data/ui";
import { useData } from "@/data/store";
import { backendEnabled } from "@/data/api";

const COLLAPSE_KEY = "kosh.sidebar.collapsed";

export function AppShell() {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const setPalette = useUi((s) => s.setPalette);
  const setHelp = useUi((s) => s.setHelp);
  const paletteOpen = useUi((s) => s.paletteOpen);
  const initBackend = useData((s) => s.initBackend);
  const hydrated = useData((s) => s.hydrated);
  const backendError = useData((s) => s.backendError);
  const retryBackend = useData((s) => s.retryBackend);

  useEffect(() => {
    void initBackend();
  }, [initBackend]);

  const toggleCollapse = () => {
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable;
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setPalette(!paletteOpen);
      }
      if (e.key === "?" && !typing) {
        e.preventDefault();
        setHelp(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setPalette, setHelp, paletteOpen]);

  // First load in backend mode: wait for the initial hydrate so pages don't flash empty states.
  if (backendEnabled && !hydrated && !backendError) {
    return (
      <div className="grid h-dvh place-items-center bg-background">
        <div className="flex flex-col items-center gap-3 text-muted">
          <Spinner size={28} className="text-primary" />
          <span className="text-[13px]">Loading your vault…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      <Sidebar collapsed={collapsed} onToggleCollapse={toggleCollapse} mobileOpen={mobileOpen} onCloseMobile={() => setMobileOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onOpenMobileNav={() => setMobileOpen(true)} />
        {backendError && (
          <div className="flex flex-wrap items-center gap-2 border-b border-danger/30 bg-danger-soft px-4 py-2 text-[13px] text-danger sm:px-5">
            <WifiOff size={15} className="shrink-0" />
            <span className="min-w-0 flex-1">Can't reach the Kosh API — changes won't be saved. Start it with <code className="rounded bg-surface px-1 py-0.5 font-mono text-[11px]">npm run api</code>.</span>
            <Button variant="outline" size="sm" onClick={retryBackend}>Retry</Button>
          </div>
        )}
        <main className="min-h-0 flex-1 overflow-y-auto">
          {/* Fluid content — fills the width with a small responsive side gutter (16–20px), no fixed max width. */}
          <div className="w-full px-4 py-6 sm:px-5">
            {/* A page crash shows an in-place recovery card (keeping the shell) instead of white-screening;
                the resetKey clears it automatically once the user navigates elsewhere. */}
            <ErrorBoundary resetKey={location.pathname}>
              <Outlet />
            </ErrorBoundary>
          </div>
        </main>
      </div>

      <CommandPalette />
      <DetailPanel />
      <VerdictDialog />
      <ConfirmDialog />
      <HelpSheet />
      <Toaster />
    </div>
  );
}
