import { useState } from "react";
import { Github, LogIn, RefreshCw } from "lucide-react";
import { api } from "@/data/api";
import { useData } from "@/data/store";
import { useUi } from "@/data/ui";
import { openExternal } from "@/lib/native";
import { Button } from "./ui";

/** Sign-in screen for the NATIVE app. The web app signs in through the GitHub redirect on the API,
 *  but a WebView can't be navigated away from the bundle — so here the OAuth page opens in the system
 *  browser and returns via the kosh://auth deep link, which AppShell turns into a session token. */
export function LoginScreen() {
  const completeLogin = useData((s) => s.completeLogin);
  const toast = useUi((s) => s.toast);
  const [busy, setBusy] = useState<"github" | "dev" | null>(null);

  const withGithub = async () => {
    setBusy("github");
    try {
      await openExternal(api.githubLoginUrl("mobile"));
    } finally {
      setBusy(null);
    }
  };

  // Offered on `vite dev` and on bundles built with VITE_DEV_LOGIN=1 (a test APK against a local API).
  // The API still has the final say: it only honours dev-login when its own DEV_LOGIN is on, never in
  // production — so a stray flag can't open a door on a real deployment.
  const devLoginOffered = import.meta.env.DEV || import.meta.env.VITE_DEV_LOGIN === "1";
  const asDev = async () => {
    setBusy("dev");
    try {
      const { token } = await api.devLogin("demo", "Demo User", "mobile");
      if (!token) throw new Error("The API didn't return a session token.");
      await completeLogin(token);
    } catch (err) {
      toast({ message: "Dev sign-in failed", description: err instanceof Error ? err.message : undefined, tone: "danger" });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="grid h-dvh place-items-center bg-background px-6 pt-safe pb-safe">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-primary font-display text-lg font-bold text-primary-foreground">K</span>
          <div>
            <div className="font-display text-xl font-semibold">Kosh</div>
            <div className="text-[12px] uppercase tracking-wider text-muted">Treasury</div>
          </div>
        </div>
        <h1 className="text-[22px] font-semibold">Sign in</h1>
        <p className="mt-1 text-[13.5px] text-muted">Your links, repos, skills and prompts — the same vault as on the web.</p>

        <div className="mt-6 space-y-2.5">
          <Button variant="primary" className="w-full justify-center" onClick={withGithub} disabled={busy !== null}>
            {busy === "github" ? <RefreshCw size={16} className="animate-spin" /> : <Github size={16} />} Continue with GitHub
          </Button>
          {devLoginOffered && (
            <Button variant="outline" className="w-full justify-center" onClick={asDev} disabled={busy !== null}>
              {busy === "dev" ? <RefreshCw size={16} className="animate-spin" /> : <LogIn size={16} />} Dev sign-in
            </Button>
          )}
        </div>
        <p className="mt-4 text-[12px] leading-snug text-faint">
          GitHub opens in your browser and brings you straight back here. Nothing is stored on this device except your session.
        </p>
      </div>
    </div>
  );
}
