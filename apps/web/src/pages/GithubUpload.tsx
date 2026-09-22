import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
  FileCode2,
  FolderInput,
  FolderUp,
  GitBranch,
  Github,
  RefreshCw,
  Sparkles,
  Upload,
} from "lucide-react";
import { formatBytes, PUBLISH_LIMITS, STARTER_GITIGNORE } from "@kosh/shared";
import { cn } from "@/lib/cn";
import { ApiError } from "@/data/api";
import { githubV2Api, type PushResult, type RepoSummary } from "@/data/githubV2Api";
import { useGithubV2, ghToast } from "@/data/githubV2";
import { readFolderPlan, type LoadedRepoFile } from "@/lib/repoFolder";
import { GitHubMark } from "@/lib/icons";
import { Button, Input, Spinner } from "@/components/ui";
import { SelectMenu } from "@/components/overlays";
import { SecretFindings, type SecretFinding } from "@/components/github/RepoForm";

/** The minimal target-repo shape the upload flow needs. */
interface Target {
  owner: string;
  name: string;
  defaultBranch: string;
  private: boolean;
  canPush: boolean;
}

/**
 * Dedicated page to upload a local folder's contents into a SELECTED GitHub repo as one commit.
 * Reached standalone at /github/upload (pick any push-capable repo) or deep-linked at
 * /github/:owner/:repo/upload (repo pre-selected). Replaces the cramped PushFilesModal.
 */
export function GithubUpload() {
  const params = useParams();
  const navigate = useNavigate();
  const deepLinked = !!(params.owner && params.repo);

  const repos = useGithubV2((s) => s.repos);
  const loadRepos = useGithubV2((s) => s.load);

  const inputRef = useRef<HTMLInputElement>(null);
  const [target, setTarget] = useState<Target | null>(null);
  const [targetError, setTargetError] = useState<string | null>(null);

  const [folderName, setFolderName] = useState("");
  const [files, setFiles] = useState<LoadedRepoFile[]>([]);
  const [skipped, setSkipped] = useState<{ path: string; reason: string }[]>([]);
  const [findings, setFindings] = useState<SecretFinding[]>([]);
  const [hasGitignore, setHasGitignore] = useState(false);
  const [addGitignore, setAddGitignore] = useState(false);
  const [reading, setReading] = useState(false);
  const [showSkipped, setShowSkipped] = useState(false);

  const [branch, setBranch] = useState("");
  const [subpath, setSubpath] = useState("");
  const [message, setMessage] = useState("Update from Kosh");
  const [confirmSecrets, setConfirmSecrets] = useState(false);

  const [phase, setPhase] = useState<"idle" | "pushing">("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<(PushResult & { count: number }) | null>(null);

  // Push-capable repos for the standalone picker.
  useEffect(() => {
    if (!deepLinked && useGithubV2.getState().status === "idle") void loadRepos();
  }, [deepLinked, loadRepos]);

  // Deep-link: fetch the repo once so we know its default branch + push rights.
  useEffect(() => {
    if (!deepLinked) return;
    let live = true;
    setTargetError(null);
    githubV2Api
      .getRepo(params.owner!, params.repo!)
      .then(({ repo }) => {
        if (!live) return;
        setTarget({ owner: repo.owner, name: repo.name, defaultBranch: repo.defaultBranch, private: repo.private, canPush: repo.canPush });
        setBranch(repo.defaultBranch);
      })
      .catch((err) => { if (live) setTargetError(err instanceof ApiError ? err.message : "Couldn't load that repository."); });
    return () => { live = false; };
  }, [deepLinked, params.owner, params.repo]);

  const pushable = useMemo(() => repos.filter((r) => r.canPush && !r.archived).sort((a, b) => a.fullName.localeCompare(b.fullName)), [repos]);

  function selectRepo(r: RepoSummary) {
    setTarget({ owner: r.owner, name: r.name, defaultBranch: r.defaultBranch, private: r.private, canPush: r.canPush });
    setBranch(r.defaultBranch);
    setResult(null);
  }

  useEffect(() => {
    const el = inputRef.current;
    if (el) { el.setAttribute("webkitdirectory", ""); el.setAttribute("directory", ""); }
  }, [target, result]);

  const totalBytes = useMemo(() => files.reduce((a, f) => a + f.size, 0), [files]);

  async function onPick(list: FileList | null) {
    if (!list || list.length === 0) return;
    setReading(true);
    setError(null);
    setResult(null);
    try {
      const plan = await readFolderPlan(list);
      setFolderName(plan.topFolder);
      setFiles(plan.files);
      setSkipped(plan.skipped);
      setFindings(plan.findings);
      setHasGitignore(plan.hasGitignore);
      setAddGitignore(false);
      setConfirmSecrets(false);
      if (!message || message === "Update from Kosh") setMessage(`Add ${plan.topFolder} contents`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't read that folder.");
    } finally {
      setReading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  // Destination subpath: strip slashes, reject traversal.
  const cleanSubpath = subpath.trim().replace(/^\/+|\/+$/g, "");
  const subpathInvalid = cleanSubpath.split("/").some((s) => s === "..") || subpath.trim().startsWith("/");

  const canPush =
    !!target && target.canPush && files.length > 0 && !reading && phase === "idle" &&
    !!branch.trim() && !!message.trim() && !subpathInvalid && (findings.length === 0 || confirmSecrets);

  async function push() {
    if (!canPush || !target) return;
    setPhase("pushing");
    setError(null);
    try {
      const out = files.map((f) => ({ path: cleanSubpath ? `${cleanSubpath}/${f.path}` : f.path, content: f.content, encoding: f.encoding }));
      if (addGitignore && !hasGitignore && !cleanSubpath) out.unshift({ path: ".gitignore", content: STARTER_GITIGNORE, encoding: "utf-8" });

      const { push } = await githubV2Api.pushFiles(target.owner, target.name, {
        files: out,
        message: message.trim(),
        branch: branch.trim(),
        allowSecrets: confirmSecrets,
      });
      setResult({ ...push, count: out.length });
      ghToast(`Pushed ${out.length} file${out.length === 1 ? "" : "s"} to ${target.owner}/${target.name}`, "ok");
    } catch (err) {
      setPhase("idle");
      if (err instanceof ApiError && err.code === "SECRETS_FOUND") {
        const serverFindings = (err.details as { findings?: SecretFinding[] } | undefined)?.findings;
        if (serverFindings?.length) setFindings(serverFindings);
        setError("Possible secrets were found. Review the warnings and tick the box to push anyway.");
        setConfirmSecrets(false);
      } else {
        setError(err instanceof ApiError ? err.message : "Couldn't push the files.");
      }
    }
  }

  function reset() {
    setResult(null);
    setFiles([]);
    setSkipped([]);
    setFindings([]);
    setFolderName("");
    setPhase("idle");
    setError(null);
    setConfirmSecrets(false);
  }

  const repoOptions = pushable.map((r) => ({
    value: r.fullName,
    label: (
      <span className="flex items-center gap-2">
        <GitHubMark size={12} className="shrink-0 text-muted" />
        <span className="truncate">{r.fullName}</span>
      </span>
    ),
  }));

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5">
      <button onClick={() => navigate(deepLinked ? `/github/${params.owner}/${params.repo}` : "/github")} className="inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-foreground">
        <ArrowLeft size={15} /> {deepLinked ? "Back to repository" : "All repositories"}
      </button>

      <header className="flex items-center gap-4 rounded-[var(--radius-card)] border border-border bg-surface px-5 py-4">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary"><FolderInput size={22} /></span>
        <div className="min-w-0">
          <h1 className="text-xl font-semibold leading-tight">Upload a folder</h1>
          <p className="mt-0.5 text-[13px] text-muted">Commit a local folder's contents into a repository. Existing files are kept unless a pushed file overwrites them.</p>
        </div>
      </header>

      {result ? (
        <div className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
          <div className="flex items-start gap-3 border-b border-border bg-ok-soft/40 px-5 py-4">
            <span className="mt-0.5 grid h-11 w-11 shrink-0 place-items-center rounded-full bg-ok-soft text-ok"><CheckCircle2 size={22} /></span>
            <div className="min-w-0">
              <h2 className="text-lg font-semibold">Pushed {result.count} file{result.count === 1 ? "" : "s"} 🎉</h2>
              <p className="mt-0.5 text-[13px] text-muted">Committed to <span className="font-mono">{result.branch}</span> on {target?.owner}/{target?.name}.</p>
            </div>
          </div>
          <div className="flex flex-wrap justify-end gap-2 px-5 py-3.5">
            <Button variant="ghost" onClick={reset}>Upload another folder</Button>
            {target && <Button variant="outline" onClick={() => navigate(`/github/${target.owner}/${target.name}`)}>Open repository</Button>}
            <a href={result.htmlUrl} target="_blank" rel="noreferrer noopener"><Button variant="primary"><ExternalLink size={15} /> View commit</Button></a>
          </div>
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
          {/* left: source + review */}
          <div className="space-y-4">
            <input ref={inputRef} type="file" multiple hidden onChange={(e) => onPick(e.target.files)} />

            {files.length === 0 ? (
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={reading}
                className="flex min-h-[220px] w-full flex-col items-center justify-center gap-3 rounded-[var(--radius-card)] border-2 border-dashed border-border bg-surface px-6 py-12 text-center transition-colors hover:border-primary hover:bg-primary-soft/30 disabled:opacity-60"
              >
                <span className="grid h-14 w-14 place-items-center rounded-2xl bg-primary-soft text-primary">{reading ? <Spinner size={26} /> : <FolderUp size={28} />}</span>
                <span className="text-[15px] font-semibold">{reading ? "Reading folder…" : "Choose a folder to upload"}</span>
                <span className="max-w-sm text-[12.5px] text-muted">Prepared in your browser — build files, dependencies and secrets are filtered out automatically. Up to {PUBLISH_LIMITS.maxTotalBytes / (1024 * 1024)} MB.</span>
              </button>
            ) : (
              <>
                <section className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-4 py-3">
                    <FileCode2 size={17} className="shrink-0 text-primary" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[14px] font-semibold">{folderName || "Folder"}</div>
                      <div className="text-[12px] text-muted">{files.length} file{files.length === 1 ? "" : "s"} · {formatBytes(totalBytes)}{skipped.length ? ` · ${skipped.length} skipped` : ""}</div>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => inputRef.current?.click()} disabled={phase !== "idle"}><RefreshCw size={14} /> Change</Button>
                  </div>
                  <div className="max-h-64 overflow-y-auto">
                    {files.map((f) => (
                      <div key={f.path} className="flex items-center gap-2 border-b border-border px-4 py-1.5 font-mono text-[12px] last:border-0">
                        <span className="min-w-0 flex-1 truncate">{cleanSubpath ? `${cleanSubpath}/${f.path}` : f.path}</span>
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

                <SecretFindings findings={findings} confirmed={confirmSecrets} onConfirm={setConfirmSecrets} confirmLabel="I've reviewed these and want to push anyway" />
              </>
            )}
          </div>

          {/* right: target + options */}
          <aside className="space-y-4 lg:sticky lg:top-4">
            <section className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
              <div className="border-b border-border px-4 py-3 text-[12px] font-semibold uppercase tracking-wide text-faint">Destination</div>
              <div className="space-y-4 px-4 py-4">
                {/* target repo */}
                <div>
                  <label className="mb-1.5 block text-[12px] font-medium text-muted">Repository</label>
                  {deepLinked ? (
                    targetError ? (
                      <div className="rounded-[var(--radius-control)] border border-danger/40 bg-danger-soft px-3 py-2 text-[12.5px] text-danger">{targetError}</div>
                    ) : target ? (
                      <div className="flex items-center gap-2 rounded-[var(--radius-control)] border border-border bg-surface-2 px-3 py-2 font-mono text-[13px]">
                        <GitHubMark size={14} className="shrink-0 text-muted" />
                        <span className="min-w-0 flex-1 truncate">{target.owner}/{target.name}</span>
                      </div>
                    ) : (
                      <div className="grid h-9 place-items-center"><Spinner size={16} className="text-muted" /></div>
                    )
                  ) : (
                    <SelectMenu
                      value={target?.name ? `${target.owner}/${target.name}` : ""}
                      onChange={(full) => { const r = pushable.find((x) => x.fullName === full); if (r) selectRepo(r); }}
                      options={repoOptions.length ? repoOptions : [{ value: "", label: "No push-capable repositories" }]}
                      width={320}
                      ariaLabel="Target repository"
                      className="w-full"
                    />
                  )}
                  {target && !target.canPush && <p className="mt-1 text-[11.5px] text-danger">You don't have push access to this repository.</p>}
                </div>

                {files.length > 0 && (
                  <>
                    {/* branch */}
                    <div>
                      <label htmlFor="up-branch" className="mb-1.5 block text-[12px] font-medium text-muted">Branch</label>
                      <div className="flex items-center overflow-hidden rounded-[var(--radius-control)] border border-border bg-surface focus-within:border-primary focus-within:ring-focus">
                        <span className="grid h-9 w-9 shrink-0 place-items-center border-r border-border bg-surface-2 text-faint"><GitBranch size={14} /></span>
                        <input id="up-branch" value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="main" className="min-w-0 flex-1 bg-transparent px-2.5 py-2 font-mono text-[13px] outline-none" />
                      </div>
                    </div>

                    {/* subpath */}
                    <div>
                      <label htmlFor="up-subpath" className="mb-1.5 block text-[12px] font-medium text-muted">Destination folder <span className="text-faint">(optional)</span></label>
                      <Input id="up-subpath" value={subpath} onChange={(e) => setSubpath(e.target.value)} placeholder="e.g. src/vendor" className={cn("font-mono", subpathInvalid && "border-danger")} />
                      <p className={cn("mt-1 text-[11px]", subpathInvalid ? "text-danger" : "text-faint")}>
                        {subpathInvalid ? "Invalid path (no leading slash or “..”)." : cleanSubpath ? `Writes to ${target?.name ?? "repo"}/${cleanSubpath}/…` : "Writes to the repository root."}
                      </p>
                    </div>

                    {/* commit message */}
                    <div>
                      <label htmlFor="up-msg" className="mb-1.5 block text-[12px] font-medium text-muted">Commit message</label>
                      <Input id="up-msg" value={message} onChange={(e) => setMessage(e.target.value)} />
                    </div>

                    {/* starter .gitignore */}
                    {!hasGitignore && !cleanSubpath && (
                      <label className="flex cursor-pointer items-center gap-2 rounded-[var(--radius-control)] border border-border bg-surface-2 px-3 py-2 text-[12.5px]">
                        <input type="checkbox" checked={addGitignore} onChange={(e) => setAddGitignore(e.target.checked)} className="h-4 w-4 accent-[var(--primary)]" />
                        <span className="inline-flex items-center gap-1"><Sparkles size={13} className="text-primary" /> Add a starter .gitignore</span>
                      </label>
                    )}
                  </>
                )}

                {error && <div className="rounded-[var(--radius-control)] border border-danger/40 bg-danger-soft px-3 py-2 text-[12.5px] text-danger">{error}</div>}

                {phase === "pushing" ? (
                  <div className="flex items-center gap-2 rounded-[var(--radius-control)] border border-border bg-surface-2 px-3 py-2.5 text-[12.5px]">
                    <Spinner size={15} className="text-primary" /> Pushing to {target?.name}…
                  </div>
                ) : (
                  <Button variant="primary" className="w-full" onClick={push} disabled={!canPush}>
                    <Upload size={15} /> Push {files.length > 0 ? `${files.length} file${files.length === 1 ? "" : "s"}` : "files"}
                  </Button>
                )}
                {files.length === 0 && <p className="text-center text-[11.5px] text-faint">Choose a folder to get started.</p>}
                <p className="flex items-center justify-center gap-1 text-center text-[11px] text-faint"><AlertTriangle size={11} /> Up to {PUBLISH_LIMITS.maxTotalBytes / (1024 * 1024)} MB per push · merges, never deletes.</p>
              </div>
            </section>
          </aside>
        </div>
      )}

      {!deepLinked && pushable.length === 0 && useGithubV2.getState().status === "ready" && (
        <p className="flex items-center justify-center gap-1.5 text-center text-[12.5px] text-muted"><Github size={14} /> No push-capable repositories. <button onClick={() => navigate("/github/new")} className="font-medium text-primary hover:underline">Create one</button>.</p>
      )}
    </div>
  );
}
