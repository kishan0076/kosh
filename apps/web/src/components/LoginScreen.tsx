import { useState } from "react";
import { Github, LogIn, Lock, RefreshCw, UserPlus } from "lucide-react";
import { isValidEmail, passwordProblem } from "@kosh/shared";
import { api } from "@/data/api";
import { useData } from "@/data/store";
import { useUi } from "@/data/ui";
import { isNative, openExternal } from "@/lib/native";
import { Button, Input } from "./ui";

/** Sign-in screen shown on the native app and on a production web build. Three ways in:
 *  - Email + password (env-configured admin login) — works everywhere, no OAuth app needed.
 *  - Continue with GitHub — on native the OAuth page opens in the system browser and returns via the
 *    kosh://auth deep link; on web it's a normal redirect.
 *  - Dev sign-in — only on dev builds, and only if the API's own DEV_LOGIN is on. */
export function LoginScreen() {
  const completeLogin = useData((s) => s.completeLogin);
  const toast = useUi((s) => s.toast);
  const [busy, setBusy] = useState<"github" | "dev" | "password" | null>(null);
  const [mode, setMode] = useState<"signin" | "register">("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const withPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password || busy) return;
    if (mode === "register") {
      if (!isValidEmail(email)) {
        toast({ message: "Enter a valid email", tone: "danger" });
        return;
      }
      const problem = passwordProblem(password);
      if (problem) {
        toast({ message: problem, tone: "danger" });
        return;
      }
    }
    setBusy("password");
    try {
      // Native gets a Bearer token back; web relies on the cookie the response set (token is undefined).
      const { token } =
        mode === "register"
          ? await api.register(email.trim(), password, name.trim() || undefined, isNative ? "mobile" : undefined)
          : await api.passwordLogin(email.trim(), password, isNative ? "mobile" : undefined);
      await completeLogin(token);
    } catch (err) {
      toast({
        message: mode === "register" ? "Couldn't create account" : "Sign-in failed",
        description: err instanceof Error ? err.message : "Check your details and try again.",
        tone: "danger",
      });
      setBusy(null);
    }
  };

  const withGithub = async () => {
    setBusy("github");
    try {
      await openExternal(api.githubLoginUrl(isNative ? "mobile" : "web"));
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
      const { token } = await api.devLogin("demo", "Demo User", isNative ? "mobile" : undefined);
      await completeLogin(token);
    } catch (err) {
      toast({ message: "Dev sign-in failed", description: err instanceof Error ? err.message : undefined, tone: "danger" });
      setBusy(null);
    }
  };

  return (
    <div className="grid min-h-dvh place-items-center bg-background px-6 pt-safe pb-safe">
      <div className="w-full max-w-sm py-10">
        <div className="mb-8 flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-primary font-display text-lg font-bold text-primary-foreground">K</span>
          <div>
            <div className="font-display text-xl font-semibold">Kosh</div>
            <div className="text-[12px] uppercase tracking-wider text-muted">Treasury</div>
          </div>
        </div>
        <h1 className="text-[22px] font-semibold">{mode === "register" ? "Create your account" : "Sign in"}</h1>
        <p className="mt-1 text-[13.5px] text-muted">Your links, repos, skills and prompts — the same vault as on the web.</p>

        <form onSubmit={withPassword} className="mt-6 space-y-2.5">
          {mode === "register" && (
            <Input
              type="text"
              autoComplete="name"
              placeholder="Name (optional)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={busy !== null}
              aria-label="Name"
            />
          )}
          <Input
            type="email"
            inputMode="email"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy !== null}
            aria-label="Email"
          />
          <Input
            type="password"
            autoComplete={mode === "register" ? "new-password" : "current-password"}
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy !== null}
            aria-label="Password"
          />
          <Button type="submit" variant="primary" className="w-full justify-center" disabled={busy !== null || !email.trim() || !password}>
            {busy === "password" ? <RefreshCw size={16} className="animate-spin" /> : mode === "register" ? <UserPlus size={16} /> : <Lock size={16} />}{" "}
            {mode === "register" ? "Create account" : "Sign in"}
          </Button>
        </form>

        <button
          type="button"
          className="mt-3 text-[13px] text-primary hover:underline disabled:opacity-50"
          onClick={() => setMode(mode === "register" ? "signin" : "register")}
          disabled={busy !== null}
        >
          {mode === "register" ? "Already have an account? Sign in" : "New here? Create an account"}
        </button>

        <div className="my-4 flex items-center gap-3 text-[11px] uppercase tracking-wider text-faint">
          <span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
        </div>

        <div className="space-y-2.5">
          <Button variant="outline" className="w-full justify-center" onClick={withGithub} disabled={busy !== null}>
            {busy === "github" ? <RefreshCw size={16} className="animate-spin" /> : <Github size={16} />} Continue with GitHub
          </Button>
          {devLoginOffered && (
            <Button variant="ghost" className="w-full justify-center" onClick={asDev} disabled={busy !== null}>
              {busy === "dev" ? <RefreshCw size={16} className="animate-spin" /> : <LogIn size={16} />} Dev sign-in
            </Button>
          )}
        </div>
        <p className="mt-4 text-[12px] leading-snug text-faint">
          Signing in with GitHub opens your browser and brings you straight back. Nothing is stored on this device except your session.
        </p>
      </div>
    </div>
  );
}
