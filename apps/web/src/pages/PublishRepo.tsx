import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ExternalLink,
  FileCode2,
  FolderUp,
  Github,
  Globe,
  Lock,
  Plug,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import {
  PUBLISH_LIMITS,
  STARTER_GITIGNORE,
  planRepoUpload,
  sanitizeRepoName,
  scanSecrets,
  formatBytes,
  isValidRepoName,
  type RepoFileMeta,
  type ScanFinding,
  type SkippedFile,
} from "@kosh/shared";
import { cn } from "@/lib/cn";
import { ago } from "@/lib/time";
import { useData } from "@/data/store";
import { useUi } from "@/data/ui";
import { api, ApiError, type PublishProgress } from "@/data/api";
import { GitHubMark } from "@/lib/icons";
import { GitScanCard } from "@/components/github/GitScanCard";
import { Button, Spinner } from "@/components/ui";

/* ── helpers ─────────────────────────────────────────────────── */

/** Detect binary by content (a NUL byte is a reliable tell), matching the CLI — reading a binary
 *  file as UTF-8 would silently corrupt it, so extension guessing isn't safe. */
async function readContent(file: File): Promise<{ content: string; encoding: "utf-8" | "base64" }> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!bytes.includes(0)) return { content: new TextDecoder().decode(bytes), encoding: "utf-8" };
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return { content: btoa(bin), encoding: "base64" };
}

/** Strip the top-level folder the user picked so files sit at the repo root. */
function repoPath(file: File): string {
  const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
  const parts = rel.split("/");
  return parts.length > 1 ? parts.slice(1).join("/") : rel;
}

interface LoadedFile extends RepoFileMeta {
  content: string;
  encoding: "utf-8" | "base64";
}

/** Friendly copy for an OAuth-callback error code. */
function githubConnectErrorMessage(code: string): string {
  switch (code) {
    case "access_denied":
      return "GitHub authorization was cancelled.";
    case "state_mismatch":
      return "That sign-in couldn't be verified. Please try connecting again.";
    case "exchange_failed":
    case "connect_failed":
      return "Couldn't complete the GitHub connection. Please try again.";
    default:
      return "GitHub connection failed. Please try again.";
  }
}

/* ── page ────────────────────────────────────────────────────── */

export function PublishRepo() {
  const user = useData((s) => s.user);
  const backend = useData((s) => s.backend);
  const items = useData((s) => s.items);
  const publishRepo = useData((s) => s.publishRepo);
  const toast = useUi((s) => s.toast);
  const openConfirm = useUi((s) => s.openConfirm);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const inputRef = useRef<HTMLInputElement>(null);
  const nameEdited = useRef(false); // did the user hand-edit the repo name?

  const [folderName, setFolderName] = useState("");
  const [files, setFiles] = useState<LoadedFile[]>([]);
  const [skipped, setSkipped] = useState<SkippedFile[]>([]);
  const [findings, setFindings] = useState<ScanFinding[]>([]);
  const [hasGitignore, setHasGitignore] = useState(false);
  const [addGitignore, setAddGitignore] = useState(true);
  const [reading, setReading] = useState(false);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isPrivate, setIsPrivate] = useState(true);
  const [confirmSecrets, setConfirmSecrets] = useState(false);
  const [showSkipped, setShowSkipped] = useState(false);

  const [progress, setProgress] = useState<PublishProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ owner: string; repo: string; htmlUrl: string; private: boolean } | null>(null);

  // GitHub connection (backend mode only).
  const connected = !backend || !!user.github?.connected;
  const [token, setToken] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [oauthAvailable, setOauthAvailable] = useState(false);
  const [showTokenEntry, setShowTokenEntry] = useState(false);

  // Is one-click "Connect GitHub" (OAuth) available on this server?
  useEffect(() => {
    if (!backend) return;
    let live = true;
    api.githubConnectConfig().then((c) => { if (live) setOauthAvailable(c.oauth); }).catch(() => {});
    return () => { live = false; };
  }, [backend]);

  // Handle the OAuth return (?github_connected=<login> | ?github_error=<code>) once on mount, then
  // strip the params so a refresh doesn't re-toast.
  useEffect(() => {
    const okLogin = searchParams.get("github_connected");
    const errCode = searchParams.get("github_error");
    if (!okLogin && !errCode) return;
    const next = new URLSearchParams(searchParams);
    next.delete("github_connected");
    next.delete("github_error");
    setSearchParams(next, { replace: true });
    if (okLogin) {
      void api.me().then((me) => useData.setState({ user: me.user })).catch(() => {});
      toast({ message: `GitHub connected as @${okLogin}`, tone: "ok" });
    } else if (errCode) {
      toast({ message: githubConnectErrorMessage(errCode), tone: "danger" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startOAuthConnect = () => { window.location.href = api.githubConnectUrl("publish"); };

  const publishing = progress !== null && progress.phase !== "done";

  // Repos previously published from Kosh (gives the module its "management" surface).
  const published = useMemo(
    () =>
      items
        .filter((i) => i.linkType === "repo" && i.tags.includes("published") && !i.deletedAt)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 8),
    [items],
  );

  // Enable folder selection through the directory-picker attributes (not typed on <input>).
  useEffect(() => {
    const el = inputRef.current;
    if (el) {
      el.setAttribute("webkitdirectory", "");
      el.setAttribute("directory", "");
    }
  }, []);

  const totalBytes = useMemo(() => files.reduce((a, f) => a + f.size, 0), [files]);

  async function onPick(fileList: FileList | null) {
    if (!fileList) return; // picker cancelled
    if (fileList.length === 0) {
      toast({ message: "That folder is empty — nothing to publish.", tone: "warn" });
      return;
    }
    setReading(true);
    setError(null);
    setResult(null);
    try {
      const all = Array.from(fileList);
      const first = repoPath(all[0]!);
      const topFolder = ((all[0] as File & { webkitRelativePath?: string }).webkitRelativePath || "").split("/")[0] || first.split("/")[0] || "project";

      const byPath = new Map<string, File>();
      const meta: RepoFileMeta[] = [];
      for (const f of all) {
        const path = repoPath(f);
        if (!path) continue;
        byPath.set(path, f);
        meta.push({ path, size: f.size });
      }
      const gi = byPath.get(".gitignore");
      const gitignore = gi && gi.size < 100_000 ? await gi.text() : undefined;

      const plan = planRepoUpload(meta, { gitignore });

      // Read contents for the included files only (never touches node_modules etc.).
      const loaded: LoadedFile[] = [];
      const texts = new Map<string, string>();
      for (const m of plan.include) {
        const file = byPath.get(m.path);
        if (!file) continue;
        try {
          const { content, encoding } = await readContent(file);
          loaded.push({ path: m.path, size: m.size, content, encoding });
          if (encoding === "utf-8") texts.set(m.path, content);
        } catch {
          plan.skipped.push({ path: m.path, reason: "could not be read" });
        }
      }

      const foundGi = byPath.has(".gitignore");
      setHasGitignore(foundGi);
      setAddGitignore(!foundGi); // offer a starter only when there isn't one
      setFolderName(topFolder);
      setName((prev) => (nameEdited.current ? prev : sanitizeRepoName(topFolder)));
      setFiles(loaded);
      setSkipped(plan.skipped);
      setFindings(scanSecrets(texts).findings);
      setConfirmSecrets(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read that folder.");
    } finally {
      setReading(false);
      if (inputRef.current) inputRef.current.value = ""; // allow re-picking the same folder
    }
  }

  async function connectToken() {
    if (token.trim().length < 10) return;
    setConnecting(true);
    setError(null);
    try {
      const res = await api.setGithubToken(token.trim());
      const me = await api.me();
      useData.setState({ user: me.user });
      setToken("");
      toast({ message: `GitHub connected as @${res.login}`, tone: "ok" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not connect GitHub.");
    } finally {
      setConnecting(false);
    }
  }

  const disconnect = () =>
    openConfirm({
      title: "Disconnect GitHub?",
      message: "Kosh will forget your GitHub token. You can reconnect any time to publish again.",
      confirmLabel: "Disconnect",
      onConfirm: async () => {
        try {
          await api.clearGithubToken();
          const me = await api.me();
          useData.setState({ user: me.user });
          toast({ message: "GitHub disconnected", tone: "warn" });
        } catch {
          /* ignore */
        }
      },
    });

  function reset() {
    setResult(null);
    setFiles([]);
    setSkipped([]);
    setFindings([]);
    setName("");
    setFolderName("");
    setDescription("");
    setProgress(null);
    setError(null);
    nameEdited.current = false;
  }

  async function doPublish() {
    const repoName = name.trim();
    if (!isValidRepoName(repoName)) {
      setError("Enter a valid repository name (letters, numbers, '.', '_', '-').");
      return;
    }
    if (files.length === 0) {
      setError("Pick a project folder first.");
      return;
    }
    setError(null);
    setProgress({ phase: "reading", pct: 0 });
    try {
      const outFiles = files.map((f) => ({ path: f.path, content: f.content, encoding: f.encoding }));
      if (addGitignore && !hasGitignore) outFiles.unshift({ path: ".gitignore", content: STARTER_GITIGNORE, encoding: "utf-8" });

      const repo = await publishRepo(
        {
          name: repoName,
          description: description.trim() || undefined,
          private: isPrivate,
          allowSecrets: confirmSecrets,
          files: outFiles,
        },
        (p) => setProgress(p),
      );
      setResult(repo);
      toast({ message: "Published to GitHub", description: `${repo.owner}/${repo.repo}`, tone: "ok" });
    } catch (err) {
      setProgress(null);
      if (err instanceof ApiError && err.code === "REPO_NAME_TAKEN") {
        setError(`You already have a repo named "${repoName}". Pick a different name.`);
      } else if (err instanceof ApiError && err.code === "SECRETS_FOUND") {
        setError("Possible secrets were found. Review the warnings and tick the confirm box to publish anyway.");
        setConfirmSecrets(false);
      } else {
        setError(err instanceof Error ? err.message : "Publishing failed.");
      }
    }
  }

  const needsConnect = backend && !connected;
  const canPublish = files.length > 0 && !reading && !publishing && !needsConnect && (findings.length === 0 || confirmSecrets);

  return (
    <div className="w-full space-y-5">
      {/* ── header ─────────────────────────────────────────── */}
      <header className="flex flex-wrap items-center gap-4 rounded-[var(--radius-card)] border border-border bg-surface px-5 py-4">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary">
          <Github size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold leading-tight">GitHub Repository Manager</h1>
          <p className="mt-0.5 text-[13px] text-muted">Turn any project folder into a new GitHub repository — created and pushed in one commit.</p>
        </div>
        <ConnectionPill backend={backend} connected={connected} github={user.github} onDisconnect={disconnect} />
      </header>

      {/* ── connect gate ───────────────────────────────────── */}
      {needsConnect && (
        <div className="overflow-hidden rounded-[var(--radius-card)] border border-primary/30 bg-primary-soft/40">
          <div className="flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-center">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-surface text-foreground shadow-[var(--shadow-sm)]">
              <GitHubMark size={24} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[15px] font-semibold">Connect GitHub to publish</div>
              <p className="mt-0.5 text-[12.5px] text-muted">
                {oauthAvailable
                  ? "One click — you'll approve the permissions on GitHub and land right back here. Nothing to copy or paste."
                  : "Paste a token with the repo scope below. It's stored encrypted and shown to no one."}
              </p>
            </div>
            {oauthAvailable && (
              <Button variant="primary" size="lg" className="shrink-0" onClick={startOAuthConnect}>
                <GitHubMark size={16} /> Connect GitHub
              </Button>
            )}
          </div>

          {/* Token fallback: always available (and the only option when OAuth isn't configured). */}
          <div className="border-t border-primary/20 bg-surface/50 px-5 py-3.5">
            {oauthAvailable && !showTokenEntry ? (
              <button onClick={() => setShowTokenEntry(true)} className="text-[12.5px] font-medium text-muted underline-offset-2 hover:text-foreground hover:underline">
                Prefer a Personal Access Token? Paste one instead
              </button>
            ) : (
              <div>
                <label htmlFor="pat" className="mb-1.5 block text-[12px] font-medium text-muted">
                  Personal Access Token <span className="text-faint">— needs the <code className="rounded bg-surface px-1 py-0.5 font-mono text-[11px]">repo</code> scope</span>
                </label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    id="pat"
                    type="password"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && connectToken()}
                    placeholder="ghp_… or github_pat_…"
                    className="min-w-0 flex-1 rounded-[var(--radius-control)] border border-border bg-surface px-3 py-2 font-mono text-[13px] outline-none focus:border-primary focus:ring-focus"
                  />
                  <Button variant={oauthAvailable ? "outline" : "primary"} onClick={connectToken} disabled={connecting || token.trim().length < 10}>
                    {connecting ? <Spinner size={15} /> : <ShieldCheck size={15} />} Connect token
                  </Button>
                </div>
                <a href="https://github.com/settings/tokens/new?scopes=repo,delete_repo,workflow&description=Kosh" target="_blank" rel="noreferrer noopener" className="mt-1.5 inline-flex items-center gap-1 text-[11.5px] text-muted hover:text-primary">
                  <ExternalLink size={12} /> Create a token on GitHub
                </a>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── success ────────────────────────────────────────── */}
      {result ? (
        <div className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
          <div className="flex items-start gap-3 border-b border-border bg-ok-soft/40 px-5 py-4">
            <span className="mt-0.5 grid h-11 w-11 shrink-0 place-items-center rounded-full bg-ok-soft text-ok">
              <CheckCircle2 size={22} />
            </span>
            <div className="min-w-0">
              <h2 className="text-lg font-semibold">Repository published 🎉</h2>
              <p className="mt-0.5 text-[13px] text-muted">{result.private ? "Private" : "Public"} repository created with its first commit.</p>
            </div>
          </div>
          <div className="px-5 py-4">
            <a href={result.htmlUrl} target="_blank" rel="noreferrer noopener" className="flex items-center gap-2 rounded-[var(--radius-control)] border border-border bg-surface-2 px-3.5 py-3 font-mono text-[13.5px] transition-colors hover:border-border-strong">
              <GitHubMark size={17} />
              <span className="min-w-0 flex-1 truncate font-semibold">{result.owner}/{result.repo}</span>
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-surface-3 px-2 py-0.5 font-sans text-[11px] text-muted">
                {result.private ? <Lock size={11} /> : <Globe size={11} />} {result.private ? "Private" : "Public"}
              </span>
              <ExternalLink size={15} className="shrink-0 text-muted" />
            </a>
          </div>
          <div className="flex flex-wrap justify-end gap-2 border-t border-border px-5 py-3.5">
            <Button variant="ghost" onClick={reset}>Publish another</Button>
            <Button variant="outline" onClick={() => navigate("/library")}>View in vault</Button>
            <a href={result.htmlUrl} target="_blank" rel="noreferrer noopener">
              <Button variant="primary"><ExternalLink size={15} /> Open on GitHub</Button>
            </a>
          </div>
        </div>
      ) : (
        /* ── workflow ─────────────────────────────────────── */
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
          {/* left: source + review */}
          <div className="space-y-5">
            {/* Optional: check a local folder's git hygiene before publishing (Chromium). */}
            {files.length === 0 && <GitScanCard />}

            <input ref={inputRef} type="file" multiple hidden onChange={(e) => onPick(e.target.files)} />

            {files.length === 0 ? (
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={reading || publishing}
                className="flex min-h-[220px] w-full flex-col items-center justify-center gap-3 rounded-[var(--radius-card)] border-2 border-dashed border-border bg-surface px-6 py-12 text-center transition-colors hover:border-primary hover:bg-primary-soft/30 disabled:opacity-60"
              >
                <span className="grid h-14 w-14 place-items-center rounded-2xl bg-primary-soft text-primary">
                  {reading ? <Spinner size={26} /> : <FolderUp size={28} />}
                </span>
                <span className="text-[15px] font-semibold">{reading ? "Reading folder…" : "Choose a project folder"}</span>
                <span className="max-w-sm text-[12.5px] text-muted">Everything is prepared in your browser. Build files, dependencies and secrets are filtered out automatically — up to {PUBLISH_LIMITS.maxTotalBytes / (1024 * 1024)} MB.</span>
              </button>
            ) : (
              <>
                {/* project files */}
                <section className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-4 py-3">
                    <FileCode2 size={17} className="shrink-0 text-primary" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[14px] font-semibold">{folderName || "Project files"}</div>
                      <div className="text-[12px] text-muted">{files.length} file{files.length === 1 ? "" : "s"} · {formatBytes(totalBytes)}{skipped.length ? ` · ${skipped.length} skipped` : ""}</div>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => inputRef.current?.click()} disabled={publishing}>
                      <RefreshCw size={14} /> Change
                    </Button>
                  </div>
                  <div className="max-h-64 overflow-y-auto">
                    {files.map((f) => (
                      <div key={f.path} className="flex items-center gap-2 border-b border-border px-4 py-1.5 font-mono text-[12px] last:border-0">
                        <span className="min-w-0 flex-1 truncate">{f.path}</span>
                        {f.encoding === "base64" && <span className="shrink-0 rounded bg-surface-3 px-1.5 text-[10px] text-muted">binary</span>}
                        <span className="shrink-0 text-faint">{formatBytes(f.size)}</span>
                      </div>
                    ))}
                  </div>
                  {skipped.length > 0 && (
                    <div className="border-t border-border px-4 py-2.5">
                      <button onClick={() => setShowSkipped((v) => !v)} className="text-[12px] font-medium text-muted hover:text-foreground">
                        {showSkipped ? "Hide" : "Show"} {skipped.length} skipped file{skipped.length === 1 ? "" : "s"}
                      </button>
                      {showSkipped && (
                        <div className="mt-2 max-h-40 overflow-y-auto rounded-[var(--radius-control)] border border-border">
                          {skipped.map((s) => (
                            <div key={s.path} className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-[12px] last:border-0">
                              <span className="min-w-0 flex-1 truncate font-mono text-faint">{s.path}</span>
                              <span className="shrink-0 text-faint">{s.reason}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </section>

                {/* secret warnings */}
                {findings.length > 0 && (
                  <section className="rounded-[var(--radius-card)] border border-warn/40 bg-warn-soft px-4 py-3.5">
                    <div className="flex items-start gap-2.5">
                      <AlertTriangle size={18} className="mt-0.5 shrink-0 text-warn" />
                      <div className="min-w-0 flex-1">
                        <div className="text-[14px] font-semibold">Possible secrets found</div>
                        <p className="mt-0.5 text-[12.5px] text-muted">Review these before publishing — a public repo is visible to everyone.</p>
                        <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto">
                          {findings.slice(0, 40).map((f, i) => (
                            <li key={i} className="font-mono text-[12px]">
                              <span className="text-foreground">{f.path}</span>:<span className="text-muted">{f.line}</span> — {f.text}
                            </li>
                          ))}
                        </ul>
                        <label className="mt-2.5 flex cursor-pointer items-center gap-2 text-[13px]">
                          <input type="checkbox" checked={confirmSecrets} onChange={(e) => setConfirmSecrets(e.target.checked)} className="h-4 w-4 accent-[var(--primary)]" />
                          I&apos;ve reviewed these and want to publish anyway
                        </label>
                      </div>
                    </div>
                  </section>
                )}
              </>
            )}

            {/* nothing publishable */}
            {files.length === 0 && skipped.length > 0 && !reading && (
              <section className="rounded-[var(--radius-card)] border border-border bg-surface px-4 py-4">
                <div className="mb-1 text-[14px] font-semibold">Nothing to publish</div>
                <p className="mb-2 text-[12.5px] text-muted">Every file in {folderName ? `“${folderName}”` : "that folder"} was filtered out. Check your .gitignore and the size limits.</p>
                <div className="max-h-48 overflow-y-auto rounded-[var(--radius-control)] border border-border">
                  {skipped.map((s) => (
                    <div key={s.path} className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-[12px] last:border-0">
                      <span className="min-w-0 flex-1 truncate font-mono text-faint">{s.path}</span>
                      <span className="shrink-0 text-faint">{s.reason}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>

          {/* right: settings (sticky) */}
          <aside className="space-y-4 lg:sticky lg:top-4">
            <section className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
              <div className="border-b border-border px-4 py-3 text-[13px] font-semibold uppercase tracking-wide text-faint">Repository settings</div>
              <div className="space-y-4 px-4 py-4">
                {/* name */}
                <div>
                  <label htmlFor="repo-name" className="mb-1.5 block text-[12px] font-medium text-muted">Repository name</label>
                  <div className="flex items-center overflow-hidden rounded-[var(--radius-control)] border border-border bg-surface focus-within:border-primary focus-within:ring-focus">
                    <span className="shrink-0 border-r border-border bg-surface-2 px-2.5 py-2 font-mono text-[12px] text-faint">{connected && backend ? `${user.github?.login ?? user.login}/` : "github.com/…/"}</span>
                    <input
                      id="repo-name"
                      value={name}
                      onChange={(e) => { nameEdited.current = true; setName(e.target.value); }}
                      placeholder="my-project"
                      disabled={publishing}
                      className="min-w-0 flex-1 bg-transparent px-3 py-2 font-mono text-[14px] outline-none"
                    />
                  </div>
                  {name.trim() && !isValidRepoName(name.trim()) && <p className="mt-1 text-[11.5px] text-danger">Only letters, numbers, '.', '_' and '-' are allowed.</p>}
                </div>

                {/* description */}
                <div>
                  <label htmlFor="repo-desc" className="mb-1.5 block text-[12px] font-medium text-muted">Description <span className="text-faint">(optional)</span></label>
                  <input
                    id="repo-desc"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="What is this project?"
                    disabled={publishing}
                    className="w-full rounded-[var(--radius-control)] border border-border bg-surface px-3 py-2 text-[14px] outline-none focus:border-primary focus:ring-focus"
                  />
                </div>

                {/* visibility */}
                <div>
                  <span className="mb-1.5 block text-[12px] font-medium text-muted">Visibility</span>
                  <div className="space-y-2">
                    <VisibilityCard icon={Lock} title="Private" desc="Only you can see this repository" selected={isPrivate} onClick={() => setIsPrivate(true)} disabled={publishing} />
                    <VisibilityCard icon={Globe} title="Public" desc="Anyone on the internet can see this" selected={!isPrivate} onClick={() => setIsPrivate(false)} disabled={publishing} />
                  </div>
                </div>

                {/* .gitignore status */}
                {files.length > 0 && (
                  <div className="rounded-[var(--radius-control)] border border-border bg-surface-2 px-3 py-2.5">
                    {hasGitignore ? (
                      <div className="flex items-center gap-2 text-[12.5px]">
                        <Check size={15} className="shrink-0 text-ok" />
                        <span><span className="font-medium">.gitignore</span> found in this project</span>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center gap-2 text-[12.5px]">
                          <AlertTriangle size={15} className="shrink-0 text-warn" />
                          <span>No <span className="font-medium">.gitignore</span> in this project</span>
                        </div>
                        <label className="mt-2 flex cursor-pointer items-center gap-2 text-[12.5px]">
                          <input type="checkbox" checked={addGitignore} onChange={(e) => setAddGitignore(e.target.checked)} disabled={publishing} className="h-4 w-4 accent-[var(--primary)]" />
                          <span className="inline-flex items-center gap-1"><Sparkles size={13} className="text-primary" /> Add a starter .gitignore</span>
                        </label>
                      </>
                    )}
                  </div>
                )}

                {/* progress / error / publish */}
                {progress ? (
                  <PublishProgressBar progress={progress} />
                ) : (
                  <>
                    {error && <div className="rounded-[var(--radius-control)] border border-danger/40 bg-danger-soft px-3 py-2 text-[12.5px] text-danger">{error}</div>}
                    <Button variant="primary" className="w-full" onClick={doPublish} disabled={!canPublish}>
                      <GitHubMark size={16} /> Create repository &amp; push
                    </Button>
                    {files.length === 0 && <p className="text-center text-[11.5px] text-faint">Choose a folder to get started.</p>}
                  </>
                )}
              </div>
            </section>
          </aside>
        </div>
      )}

      {/* ── recently published ─────────────────────────────── */}
      {published.length > 0 && (
        <section className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
          <div className="border-b border-border px-4 py-3 text-[13px] font-semibold uppercase tracking-wide text-faint">Recently published</div>
          <div>
            {published.map((i) => (
              <div key={i.id} className="flex items-center gap-3 border-b border-border px-4 py-2.5 last:border-0">
                <GitHubMark size={16} className="shrink-0 text-muted" />
                <a href={i.url} target="_blank" rel="noreferrer noopener" className="min-w-0 flex-1 truncate font-mono text-[13px] font-medium hover:text-primary">
                  {i.github ? `${i.github.owner}/${i.github.repo}` : i.title}
                </a>
                <span className="shrink-0 text-[11.5px] text-faint">{ago(i.createdAt)}</span>
                <a href={i.url} target="_blank" rel="noreferrer noopener" className="shrink-0 rounded-md p-1.5 text-faint hover:bg-surface-2 hover:text-foreground" aria-label="Open on GitHub">
                  <ExternalLink size={14} />
                </a>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/* ── sub-components ───────────────────────────────────────────── */

function ConnectionPill({ backend, connected, github, onDisconnect }: { backend: boolean; connected: boolean; github?: { login?: string; avatarUrl?: string }; onDisconnect: () => void }) {
  if (!backend) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-3 py-1.5 text-[12px] text-muted">
        <Sparkles size={13} className="text-primary" /> Demo mode
      </span>
    );
  }
  if (connected) {
    const login = github?.login;
    return (
      <div className="inline-flex items-center gap-2 rounded-full border border-ok/30 bg-ok-soft py-1 pl-1 pr-2.5 text-[12px]">
        {github?.avatarUrl ? (
          <img src={github.avatarUrl} alt="" referrerPolicy="no-referrer" className="h-5 w-5 rounded-full" />
        ) : (
          <span className="grid h-5 w-5 place-items-center rounded-full bg-ok text-white"><Check size={11} /></span>
        )}
        <span className="font-medium">{login ? `@${login}` : "Connected"}</span>
        <button onClick={onDisconnect} className="ml-0.5 rounded-full p-0.5 text-muted hover:bg-surface-2 hover:text-danger" aria-label="Disconnect GitHub">
          <X size={13} />
        </button>
      </div>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-warn/40 bg-warn-soft px-3 py-1.5 text-[12px] text-warn">
      <Plug size={13} /> Not connected
    </span>
  );
}

function VisibilityCard({ icon: Icon, title, desc, selected, onClick, disabled }: { icon: typeof Lock; title: string; desc: string; selected: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      className={cn(
        "flex w-full items-center gap-3 rounded-[var(--radius-control)] border px-3 py-2.5 text-left transition-colors disabled:opacity-60",
        selected ? "border-primary bg-primary-soft" : "border-border bg-surface-2 hover:border-border-strong",
      )}
    >
      <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-lg", selected ? "bg-primary text-primary-foreground" : "bg-surface-3 text-muted")}>
        <Icon size={15} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13.5px] font-medium">{title}</span>
        <span className="block text-[11.5px] leading-snug text-muted">{desc}</span>
      </span>
      <span className={cn("grid h-4 w-4 shrink-0 place-items-center rounded-full border", selected ? "border-primary bg-primary text-primary-foreground" : "border-border")}>
        {selected && <Check size={11} />}
      </span>
    </button>
  );
}

function PublishProgressBar({ progress }: { progress: PublishProgress }) {
  const labels: Record<PublishProgress["phase"], string> = {
    reading: "Preparing files…",
    uploading: "Uploading files…",
    creating: "Creating repository & pushing…",
    done: "Done",
  };
  const indeterminate = progress.phase === "creating";
  const value = progress.phase === "uploading" ? progress.pct : 100;
  return (
    <div aria-live="polite">
      <div className="mb-1.5 flex items-center justify-between text-[12px]">
        <span className="inline-flex items-center gap-1.5 font-medium">
          {progress.phase === "done" ? <Check size={14} className="text-ok" /> : <Spinner size={13} className="text-primary" />}
          {labels[progress.phase]}
        </span>
        {progress.phase === "uploading" && <span className="tabular text-muted">{progress.pct}%</span>}
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-surface-3">
        <div
          className={cn("h-full rounded-full bg-primary transition-[width] duration-200 ease-out", indeterminate && "motion-safe:animate-pulse")}
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  );
}
