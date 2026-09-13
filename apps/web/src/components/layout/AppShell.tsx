import { useEffect, useState } from "react";
import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { CommandPalette } from "../palette/CommandPalette";
import { DetailPanel } from "../detail/DetailPanel";
import { VerdictDialog } from "../detail/VerdictDialog";
import { HelpSheet } from "../HelpSheet";
import { Toaster } from "../Toaster";
import { useUi } from "@/data/ui";
import { useData } from "@/data/store";

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
  const setPalette = useUi((s) => s.setPalette);
  const setHelp = useUi((s) => s.setHelp);
  const paletteOpen = useUi((s) => s.paletteOpen);
  const initBackend = useData((s) => s.initBackend);

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

  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      <Sidebar collapsed={collapsed} onToggleCollapse={toggleCollapse} mobileOpen={mobileOpen} onCloseMobile={() => setMobileOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onOpenMobileNav={() => setMobileOpen(true)} />
        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1240px] px-4 py-6 sm:px-6 lg:px-8">
            <Outlet />
          </div>
        </main>
      </div>

      <CommandPalette />
      <DetailPanel />
      <VerdictDialog />
      <HelpSheet />
      <Toaster />
    </div>
  );
}
