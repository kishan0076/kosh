import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, CheckCircle2, ExternalLink, FolderUp, Github, Globe, Lock, ShieldCheck } from "lucide-react";
import {
  PUBLISH_LIMITS,
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
import { useData } from "@/data/store";
import { useUi } from "@/data/ui";
import { api, ApiError } from "@/data/api";
import { GitHubMark } from "@/lib/icons";
import { PageHeader, SectionCard } from "@/components/common";
import { Button, Spinner } from "@/components/ui";

/* ── file reading helpers ────────────────────────────────────── */

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

/* ── page ────────────────────────────────────────────────────── */

export function PublishRepo() {
  const user = useData((s) => s.user);
  const backend = useData((s) => s.backend);
  const publishRepo = useData((s) => s.publishRepo);
  const toast = useUi((s) => s.toast);
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const nameEdited = useRef(false); // did the user hand-edit the repo name?

  const [folderName, setFolderName] = useState("");
  const [files, setFiles] = useState<LoadedFile[]>([]);
  const [skipped, setSkipped] = useState<SkippedFile[]>([]);
  const [findings, setFindings] = useState<ScanFinding[]>([]);
  const [reading, setReading] = useState(false);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isPrivate, setIsPrivate] = useState(true);
  const [confirmSecrets, setConfirmSecrets] = useState(false);
  const [showSkipped, setShowSkipped] = useState(false);

  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ owner: string; repo: string; htmlUrl: string } | null>(null);

  // GitHub connection (backend mode only).
  const connected = !backend || !!user.github?.connected;
  const [token, setToken] = useState("");
  const [connecting, setConnecting] = useState(false);

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

      // Metadata for the plan, keeping each File handle to read included ones.
      const byPath = new Map<string, File>();
      const meta: RepoFileMeta[] = [];
      let gitignore: string | undefined;
      for (const f of all) {
        const path = repoPath(f);
        if (!path) continue;
        byPath.set(path, f);
        meta.push({ path, size: f.size });
      }
      const gi = byPath.get(".gitignore");
      if (gi && gi.size < 100_000) gitignore = await gi.text();

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

      setFolderName(topFolder);
      // Refresh the suggested name on every (re-)pick unless the user has hand-edited it.
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
      // Refresh the user so `github.connected` flips on.
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
    setPublishing(true);
    setError(null);
    try {
      const repo = await publishRepo({
        name: repoName,
        description: description.trim() || undefined,
        private: isPrivate,
        allowSecrets: confirmSecrets,
        files: files.map((f) => ({ path: f.path, content: f.content, encoding: f.encoding })),
      });
      setResult(repo);
      toast({ message: "Published to GitHub", description: `${repo.owner}/${repo.repo}`, tone: "ok" });
    } catch (err) {
      if (err instanceof ApiError && err.code === "REPO_NAME_TAKEN") {
        setError(`You already have a repo named "${repoName}". Pick a different name.`);
      } else if (err instanceof ApiError && err.code === "SECRETS_FOUND") {
        setError("Possible secrets were found. Review the warnings and tick the confirm box to publish anyway.");
        setConfirmSecrets(false);
      } else {
        setError(err instanceof Error ? err.message : "Publishing failed.");
      }
    } finally {
      setPublishing(false);
    }
  }

  /* success screen */
  if (result) {
    return (
      <div className="mx-auto max-w-2xl">
        <div className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
          <div className="flex items-start gap-3 border-b border-border px-5 py-4">
            <span className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-full bg-ok-soft text-ok">
              <CheckCircle2 size={20} />
            </span>
            <div className="min-w-0">
              <h2 className="text-lg font-semibold">Published to GitHub</h2>
              <p className="mt-0.5 text-[13px] text-muted">Your project is now a repository with its first commit.</p>
            </div>
          </div>
          <div className="px-5 py-4">
            <a href={result.htmlUrl} target="_blank" rel="noreferrer noopener" className="flex items-center gap-2 rounded-[var(--radius-control)] border border-border bg-surface-2 px-3 py-2.5 font-mono text-[13px] hover:border-border-strong">
              <GitHubMark size={16} />
              <span className="min-w-0 flex-1 truncate">{result.owner}/{result.repo}</span>
              <ExternalLink size={14} className="text-muted" />
            </a>
          </div>
          <div className="flex flex-wrap justify-end gap-2 border-t border-border px-5 py-3.5">
            <Button variant="ghost" onClick={() => { setResult(null); setFiles([]); setSkipped([]); setFindings([]); setName(""); setFolderName(""); nameEdited.current = false; }}>
              Publish another
            </Button>
            <Button variant="outline" onClick={() => navigate("/library")}>View in vault</Button>
            <a href={result.htmlUrl} target="_blank" rel="noreferrer noopener">
              <Button variant="primary"><ExternalLink size={15} /> Open on GitHub</Button>
            </a>
          </div>
        </div>
      </div>
    );
  }

  const needsConnect = backend && !connected;
  const canPublish = files.length > 0 && !reading && !publishing && !needsConnect && (findings.length === 0 || confirmSecrets);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="Publish to GitHub" subtitle="Pick a project folder — Kosh creates a new repository and pushes the files in one commit." icon={Github} />

      {/* folder picker */}
      <input ref={inputRef} type="file" multiple hidden onChange={(e) => onPick(e.target.files)} />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={reading || publishing}
        className={cn(
          "flex w-full flex-col items-center justify-center gap-2 rounded-[var(--radius-card)] border-2 border-dashed border-border bg-surface px-6 py-10 text-center transition-colors hover:border-primary hover:bg-primary-soft/40 disabled:opacity-60",
        )}
      >
        {reading ? <Spinner size={22} className="text-primary" /> : <FolderUp size={26} className="text-muted" />}
        <span className="text-[14px] font-medium">{reading ? "Reading folder…" : files.length ? "Choose a different folder" : "Choose a project folder"}</span>
        <span className="text-[12px] text-muted">Build files and secrets are filtered out automatically. Up to {PUBLISH_LIMITS.maxTotalBytes / (1024 * 1024)} MB.</span>
      </button>

      {/* nothing publishable — everything got filtered out */}
      {files.length === 0 && skipped.length > 0 && !reading && (
        <SectionCard title="Nothing to publish" subtitle={`Every file in ${folderName ? `“${folderName}”` : "that folder"} was filtered out`}>
          <div className="max-h-60 overflow-y-auto rounded-[var(--radius-control)] border border-border">
            {skipped.map((s) => (
              <div key={s.path} className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-[12px] last:border-0">
                <span className="min-w-0 flex-1 truncate font-mono text-faint">{s.path}</span>
                <span className="shrink-0 text-faint">{s.reason}</span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[12px] text-muted">Pick a folder with source files, or check your .gitignore and the size limits.</p>
        </SectionCard>
      )}

      {files.length > 0 && (
        <>
          {/* file summary */}
          <SectionCard
            title={folderName ? `“${folderName}”` : "Files"}
            subtitle={`${files.length} file${files.length === 1 ? "" : "s"} · ${formatBytes(totalBytes)}${skipped.length ? ` · ${skipped.length} skipped` : ""}`}
          >
            <div className="max-h-52 overflow-y-auto rounded-[var(--radius-control)] border border-border bg-surface-2">
              {files.map((f) => (
                <div key={f.path} className="flex items-center gap-2 border-b border-border px-3 py-1.5 font-mono text-[12px] last:border-0">
                  <span className="min-w-0 flex-1 truncate">{f.path}</span>
                  <span className="shrink-0 text-faint">{formatBytes(f.size)}</span>
                </div>
              ))}
            </div>
            {skipped.length > 0 && (
              <div className="mt-2">
                <button onClick={() => setShowSkipped((v) => !v)} className="text-[12px] font-medium text-muted hover:text-foreground">
                  {showSkipped ? "Hide" : "Show"} {skipped.length} skipped file{skipped.length === 1 ? "" : "s"}
                </button>
                {showSkipped && (
                  <div className="mt-1.5 max-h-40 overflow-y-auto rounded-[var(--radius-control)] border border-border">
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
          </SectionCard>

          {/* secret warnings */}
          {findings.length > 0 && (
            <div className="rounded-[var(--radius-card)] border border-warn/40 bg-warn-soft px-4 py-3.5">
              <div className="flex items-start gap-2.5">
                <AlertTriangle size={18} className="mt-0.5 shrink-0 text-warn" />
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-semibold">Possible secrets found</div>
                  <p className="mt-0.5 text-[12.5px] text-muted">Review these before publishing — a public repo is visible to everyone.</p>
                  <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto">
                    {findings.slice(0, 30).map((f, i) => (
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
            </div>
          )}

          {/* repo details */}
          <SectionCard title="Repository details">
            <div className="space-y-4">
              <div>
                <label htmlFor="repo-name" className="mb-1.5 block text-[12px] font-medium text-muted">Repository name</label>
                <input
                  id="repo-name"
                  value={name}
                  onChange={(e) => { nameEdited.current = true; setName(e.target.value); }}
                  placeholder="my-project"
                  className="w-full rounded-[var(--radius-control)] border border-border bg-surface px-3 py-2 font-mono text-[14px] outline-none focus:border-primary focus:ring-focus"
                />
              </div>
              <div>
                <label htmlFor="repo-desc" className="mb-1.5 block text-[12px] font-medium text-muted">Description <span className="text-faint">(optional)</span></label>
                <input
                  id="repo-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What is this project?"
                  className="w-full rounded-[var(--radius-control)] border border-border bg-surface px-3 py-2 text-[14px] outline-none focus:border-primary focus:ring-focus"
                />
              </div>
              <div>
                <span className="mb-1.5 block text-[12px] font-medium text-muted">Visibility</span>
                <div className="grid grid-cols-2 gap-2 sm:max-w-sm">
                  <button
                    type="button"
                    onClick={() => setIsPrivate(true)}
                    className={cn("flex items-center gap-2 rounded-[var(--radius-control)] border px-3 py-2 text-left transition-colors", isPrivate ? "border-primary bg-primary-soft" : "border-border bg-surface-2 hover:border-border-strong")}
                    aria-pressed={isPrivate}
                  >
                    <Lock size={15} className={isPrivate ? "text-primary" : "text-muted"} />
                    <span className="text-[13px] font-medium">Private</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsPrivate(false)}
                    className={cn("flex items-center gap-2 rounded-[var(--radius-control)] border px-3 py-2 text-left transition-colors", !isPrivate ? "border-primary bg-primary-soft" : "border-border bg-surface-2 hover:border-border-strong")}
                    aria-pressed={!isPrivate}
                  >
                    <Globe size={15} className={!isPrivate ? "text-primary" : "text-muted"} />
                    <span className="text-[13px] font-medium">Public</span>
                  </button>
                </div>
              </div>
            </div>
          </SectionCard>

          {/* connect GitHub (backend mode, no token yet) */}
          {needsConnect && (
            <SectionCard title="Connect GitHub" subtitle="Paste a token with repo access — stored encrypted, shown to no one.">
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="ghp_… or github_pat_…"
                  className="min-w-0 flex-1 rounded-[var(--radius-control)] border border-border bg-surface px-3 py-2 font-mono text-[13px] outline-none focus:border-primary focus:ring-focus"
                />
                <Button variant="primary" onClick={connectToken} disabled={connecting || token.trim().length < 10}>
                  {connecting ? <Spinner size={15} /> : <ShieldCheck size={15} />} Connect
                </Button>
              </div>
              <p className="mt-2 text-[12px] text-faint">
                Create one at github.com/settings/tokens with the <span className="font-mono">repo</span> scope.
              </p>
            </SectionCard>
          )}

          {error && (
            <div className="rounded-[var(--radius-control)] border border-danger/40 bg-danger-soft px-3.5 py-2.5 text-[13px] text-danger">{error}</div>
          )}

          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={() => navigate("/add")}>Cancel</Button>
            <Button variant="primary" onClick={doPublish} disabled={!canPublish}>
              {publishing ? <><Spinner size={15} /> Publishing…</> : <><GitHubMark size={15} /> Create repo &amp; push</>}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
