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
import { LoginScreen } from "../LoginScreen";
import { Button } from "../ui";
import { HydrationBar } from "../HydrationBar";
import { PageSkeleton, skeletonFor } from "../PageSkeleton";
import { PageTransition } from "../PageTransition";
import { useUi } from "@/data/ui";
import { useData } from "@/data/store";
import { api, backendEnabled } from "@/data/api";
import { closeExternal, onDeepLink } from "@/lib/native";

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
  const needsLogin = useData((s) => s.needsLogin);
  const completeLogin = useData((s) => s.completeLogin);
  const toast = useUi((s) => s.toast);
  // A Retry from the offline banner re-runs the hydrate with the app still mounted; the only
  // indication is the top progress bar (the banner clears while it's in flight and returns on failure).
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    void initBackend();
  }, [initBackend]);

  // Native app: OAuth flows run in the system browser and come back as kosh:// deep links.
  //   kosh://auth?code=…            → exchange the one-time code for a session token, then hydrate
  //   kosh://connected?provider=…   → a Connect (GitHub / Google) flow finished; refresh the user
  useEffect(
    () =>
      onDeepLink((url) => {
        void closeExternal();
        const host = url.host || url.pathname.replace(/^\/+/, "");
        if (host === "auth") {
          const code = url.searchParams.get("code");
          if (!code) return;
          api
            .mobileExchange(code)
            .then(({ token }) => completeLogin(token))
            .catch((err: unknown) => toast({ message: "Sign-in didn't complete", description: err instanceof Error ? err.message : undefined, tone: "danger" }));
        } else if (host === "connected") {
          const err = url.searchParams.get("github_error") ?? url.searchParams.get("error");
          if (err) {
            toast({ message: "Connection failed", description: err, tone: "danger" });
            return;
          }
          const who = url.searchParams.get("github_connected") ?? url.searchParams.get("connected");
          void api.me().then((me) => useData.setState({ user: me.user })).catch(() => {});
          toast({ message: `Connected${who ? ` as ${who}` : ""}`, tone: "ok" });
        }
      }),
    [completeLogin, toast],
  );

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

  if (needsLogin) return <LoginScreen />;

  // First load in backend mode: the shell (topbar, drawer — both data-light) paints at once and the
  // page slot shows a route-shaped skeleton until the hydrate lands, so a deep link already looks like
  // where it's going and nothing jumps when the content arrives.
  const hydrating = backendEnabled && !hydrated && !backendError;
  const retry = () => {
    setRetrying(true);
    useData.setState({ backendError: null });
    void initBackend().finally(() => setRetrying(false));
  };

  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      <HydrationBar active={hydrating || retrying} />
      <Sidebar collapsed={collapsed} onToggleCollapse={toggleCollapse} mobileOpen={mobileOpen} onCloseMobile={() => setMobileOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onOpenMobileNav={() => setMobileOpen(true)} />
        {backendError && (
          <div className="reveal-in flex flex-wrap items-center gap-2 border-b border-danger/30 bg-danger-soft px-4 py-2 text-[13px] text-danger sm:px-5">
            <WifiOff size={15} className="shrink-0" />
            <span className="min-w-0 flex-1">Can't reach the Kosh API — changes won't be saved. Start it with <code className="whitespace-nowrap rounded bg-surface px-1 py-0.5 font-mono text-[11px]">npm run api</code>.</span>
            <Button variant="outline" size="sm" onClick={retry}>Retry</Button>
          </div>
        )}
        <main className="min-h-0 flex-1 overflow-y-auto pb-safe">
          {/* Fluid content — fills the width with a small responsive side gutter (16–20px), no fixed max width. */}
          <div className="w-full px-4 py-6 sm:px-5">
            {hydrating ? (
              <PageSkeleton variant={skeletonFor(location.pathname)} />
            ) : (
              /* A page crash shows an in-place recovery card (keeping the shell) instead of white-screening;
                 the resetKey clears it automatically once the user navigates elsewhere. */
              <ErrorBoundary resetKey={location.pathname + location.search}>
                <PageTransition>
                  <Outlet />
                </PageTransition>
              </ErrorBoundary>
            )}
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
