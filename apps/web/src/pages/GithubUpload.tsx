import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
  FileCode2,
  FileWarning,
  FolderInput,
  FolderUp,
  GitBranch,
  GitPullRequest,
  Github,
  RefreshCw,
  Sparkles,
  Upload,
} from "lucide-react";
import { formatBytes, PUBLISH_LIMITS, STARTER_GITIGNORE } from "@kosh/shared";
import { cn } from "@/lib/cn";
import { ApiError } from "@/data/api";
import { githubV2Api, type BranchLite, type PushResult, type RepoSummary } from "@/data/githubV2Api";
import { useGithubV2, ghToast } from "@/data/githubV2";
import { readFolderPlan, readDropPlan, gitBlobSha, type LoadedRepoFile } from "@/lib/repoFolder";
import { GitHubMark } from "@/lib/icons";
import { Button, Input, Spinner, Toggle } from "@/components/ui";
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

type DiffLabel = "added" | "overwrite" | "unchanged";

/**
 * Dedicated page to upload a local folder's contents into a SELECTED GitHub repo as one commit.
 * Reached standalone at /github/upload (pick any push-capable repo) or deep-linked at
 * /github/:owner/:repo/upload (repo pre-selected). Includes drag-and-drop, per-file include/exclude,
 * an existing-or-new branch target, and a dry-run diff (Added / Overwrites / Unchanged).
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
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [skipped, setSkipped] = useState<{ path: string; reason: string }[]>([]);
  const [findings, setFindings] = useState<SecretFinding[]>([]);
  const [hasGitignore, setHasGitignore] = useState(false);
  const [addGitignore, setAddGitignore] = useState(false);
  const [reading, setReading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [showSkipped, setShowSkipped] = useState(false);

  const [branches, setBranches] = useState<BranchLite[]>([]);
  const [branchMode, setBranchMode] = useState<"existing" | "new">("existing");
  const [branch, setBranch] = useState("");
  const [newBranch, setNewBranch] = useState("");
  const [subpath, setSubpath] = useState("");
  const [message, setMessage] = useState("Update from Kosh");
  const [confirmSecrets, setConfirmSecrets] = useState(false);
  const [openPr, setOpenPr] = useState(false);
  const [prTitle, setPrTitle] = useState("");
  const [prBody, setPrBody] = useState("");

  // Dry-run: git blob shas of picked files + the target-branch tree, compared to label each file.
  const [blobShas, setBlobShas] = useState<Map<string, string>>(new Map());
  const [treeMap, setTreeMap] = useState<Map<string, string> | null>(null);
  const [diffState, setDiffState] = useState<"idle" | "loading" | "ready" | "unavailable">("idle");

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
      })
      .catch((err) => { if (live) setTargetError(err instanceof ApiError ? err.message : "Couldn't load that repository."); });
    return () => { live = false; };
  }, [deepLinked, params.owner, params.repo]);

  // When a target is chosen, default the branch and load its branch list.
  useEffect(() => {
    if (!target) return;
    setBranch(target.defaultBranch);
    setBranchMode("existing");
    let live = true;
    githubV2Api.branches(target.owner, target.name).then(({ branches }) => { if (live) setBranches(branches); }).catch(() => { if (live) setBranches([]); });
    return () => { live = false; };
  }, [target?.owner, target?.name, target?.defaultBranch]);

  const pushable = useMemo(() => repos.filter((r) => r.canPush && !r.archived).sort((a, b) => a.fullName.localeCompare(b.fullName)), [repos]);

  function selectRepo(r: RepoSummary) {
    setTarget({ owner: r.owner, name: r.name, defaultBranch: r.defaultBranch, private: r.private, canPush: r.canPush });
    setResult(null);
  }

  useEffect(() => {
    const el = inputRef.current;
    if (el) { el.setAttribute("webkitdirectory", ""); el.setAttribute("directory", ""); }
  }, [target, result]);

  const ingestSeq = useRef(0);
  async function ingest(plan: Awaited<ReturnType<typeof readFolderPlan>>) {
    const mine = ++ingestSeq.current;
    setFolderName(plan.topFolder);
    setFiles(plan.files);
    setExcluded(new Set());
    setSkipped(plan.skipped);
    setFindings(plan.findings);
    setHasGitignore(plan.hasGitignore);
    setAddGitignore(false);
    setConfirmSecrets(false);
    if (!message || message === "Update from Kosh") setMessage(`Add ${plan.topFolder} contents`);
    // Compute blob shas for the dry-run (non-blocking). Guard against a newer folder pick landing first.
    setBlobShas(new Map());
    const entries = await Promise.all(plan.files.map(async (f) => [f.path, await gitBlobSha(f)] as const));
    if (ingestSeq.current === mine) setBlobShas(new Map(entries));
  }

  async function onPickList(list: FileList | null) {
    if (!list || list.length === 0) return;
    setReading(true); setError(null); setResult(null);
    try { await ingest(await readFolderPlan(list)); }
    catch (err) { setError(err instanceof Error ? err.message : "Couldn't read that folder."); }
    finally { setReading(false); if (inputRef.current) inputRef.current.value = ""; }
  }

  async function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (!e.dataTransfer.items.length) return;
    setReading(true); setError(null); setResult(null);
    try { await ingest(await readDropPlan(e.dataTransfer)); }
    catch (err) { setError(err instanceof Error ? err.message : "Couldn't read that folder."); }
    finally { setReading(false); }
  }

  // Destination subpath: strip slashes, reject traversal.
  const cleanSubpath = subpath.trim().replace(/^\/+|\/+$/g, "");
  const subpathInvalid = cleanSubpath.split("/").some((s) => s === "..") || subpath.trim().startsWith("/");
  const destPath = (p: string) => (cleanSubpath ? `${cleanSubpath}/${p}` : p);

  const included = useMemo(() => files.filter((f) => !excluded.has(f.path)), [files, excluded]);
  const includedBytes = useMemo(() => included.reduce((a, f) => a + f.size, 0), [included]);

  const effectiveBranch = (branchMode === "new" ? newBranch : branch).trim();
  const diffBranch = branchMode === "new" ? target?.defaultBranch : branch.trim();
  // A PR needs a head branch that differs from the base (default branch).
  const prBaseSameAsHead = openPr && !!target && effectiveBranch === target.defaultBranch;

  // Fetch the target branch's tree for the dry-run.
  const treeSeq = useRef(0);
  useEffect(() => {
    if (!target || files.length === 0 || !diffBranch) { setTreeMap(null); setDiffState("idle"); return; }
    const mine = ++treeSeq.current;
    setDiffState("loading");
    const t = setTimeout(() => {
      githubV2Api
        .tree(target.owner, target.name, diffBranch)
        .then(({ entries, truncated }) => {
          if (treeSeq.current !== mine) return;
          // A truncated tree omits existing files, which would mislabel Overwrites as New — don't trust it.
          if (truncated) { setTreeMap(null); setDiffState("unavailable"); return; }
          setTreeMap(new Map(entries.map((e) => [e.path, e.sha])));
          setDiffState("ready");
        })
        .catch(() => { if (treeSeq.current === mine) { setTreeMap(null); setDiffState("unavailable"); } });
    }, 300);
    return () => clearTimeout(t);
  }, [target?.owner, target?.name, diffBranch, files.length]);

  const labelOf = (f: LoadedRepoFile): DiffLabel | undefined => {
    if (!treeMap || diffState !== "ready") return undefined;
    const existing = treeMap.get(destPath(f.path));
    if (existing === undefined) return "added";
    return existing === blobShas.get(f.path) ? "unchanged" : "overwrite";
  };

  const diffCounts = useMemo(() => {
    if (diffState !== "ready") return null;
    let added = 0, overwrite = 0, unchanged = 0;
    for (const f of included) {
      const l = labelOf(f);
      if (l === "added") added++; else if (l === "overwrite") overwrite++; else if (l === "unchanged") unchanged++;
    }
    return { added, overwrite, unchanged };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [included, treeMap, diffState, blobShas, cleanSubpath]);

  // Skips split into size-related ("too large" / total-size cap) vs the rest (count cap, ignored, build).
  const isSizeSkip = (reason: string) => /too large|total-size limit/.test(reason);
  const tooLarge = useMemo(() => skipped.filter((s) => isSizeSkip(s.reason)), [skipped]);
  const otherSkipped = useMemo(() => skipped.filter((s) => !isSizeSkip(s.reason)), [skipped]);
  // Only offer/inject a starter .gitignore when we can confirm the target repo doesn't already have one.
  const canOfferGitignore = !hasGitignore && !cleanSubpath && diffState === "ready" && !treeMap?.has(".gitignore");

  const toggleFile = (path: string) => setExcluded((prev) => { const next = new Set(prev); next.has(path) ? next.delete(path) : next.add(path); return next; });
  const setAll = (on: boolean) => setExcluded(on ? new Set() : new Set(files.map((f) => f.path)));

  const canPush =
    !!target && target.canPush && included.length > 0 && !reading && phase === "idle" &&
    !!effectiveBranch && !!message.trim() && !subpathInvalid && !prBaseSameAsHead && (findings.length === 0 || confirmSecrets);

  async function push() {
    if (!canPush || !target) return;
    setPhase("pushing");
    setError(null);
    try {
      const out = included.map((f) => ({ path: destPath(f.path), content: f.content, encoding: f.encoding }));
      if (addGitignore && canOfferGitignore) out.unshift({ path: ".gitignore", content: STARTER_GITIGNORE, encoding: "utf-8" });

      const { push } = await githubV2Api.pushFiles(target.owner, target.name, {
        files: out,
        message: message.trim(),
        branch: effectiveBranch,
        allowSecrets: confirmSecrets,
        ...(openPr && !prBaseSameAsHead ? { pullRequest: { base: target.defaultBranch, title: prTitle.trim() || message.trim(), body: prBody.trim() || undefined } } : {}),
      });
      setResult({ ...push, count: out.length });
      ghToast(push.pullRequestUrl ? `Opened a pull request on ${target.name}` : `Pushed ${out.length} file${out.length === 1 ? "" : "s"} to ${target.owner}/${target.name}`, "ok");
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
    setResult(null); setFiles([]); setExcluded(new Set()); setSkipped([]); setFindings([]);
    setFolderName(""); setPhase("idle"); setError(null); setConfirmSecrets(false); setTreeMap(null); setDiffState("idle");
  }

  const repoOptions = pushable.map((r) => ({
    value: r.fullName,
    label: <span className="flex items-center gap-2"><GitHubMark size={12} className="shrink-0 text-muted" /><span className="truncate">{r.fullName}</span></span>,
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
              <h2 className="text-lg font-semibold">{result.pullRequestUrl ? "Pull request opened 🎉" : `Pushed ${result.count} file${result.count === 1 ? "" : "s"} 🎉`}</h2>
              <p className="mt-0.5 text-[13px] text-muted">{result.count} file{result.count === 1 ? "" : "s"} committed to <span className="font-mono">{result.branch}</span> on {target?.owner}/{target?.name}.</p>
            </div>
          </div>
          <div className="flex flex-wrap justify-end gap-2 px-5 py-3.5">
            <Button variant="ghost" onClick={reset}>Upload another folder</Button>
            {target && <Button variant="outline" onClick={() => navigate(`/github/${target.owner}/${target.name}`)}>Open repository</Button>}
            {result.pullRequestUrl ? (
              <>
                <a href={result.htmlUrl} target="_blank" rel="noreferrer noopener"><Button variant="outline"><ExternalLink size={15} /> Commit</Button></a>
                <a href={result.pullRequestUrl} target="_blank" rel="noreferrer noopener"><Button variant="primary"><GitPullRequest size={15} /> View pull request</Button></a>
              </>
            ) : (
              <a href={result.htmlUrl} target="_blank" rel="noreferrer noopener"><Button variant="primary"><ExternalLink size={15} /> View commit</Button></a>
            )}
          </div>
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
          {/* left: source + review */}
          <div className="space-y-4">
            <input ref={inputRef} type="file" multiple hidden onChange={(e) => onPickList(e.target.files)} />

            {files.length === 0 ? (
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false); }}
                onDrop={onDrop}
                disabled={reading}
                className={cn(
                  "flex min-h-[220px] w-full flex-col items-center justify-center gap-3 rounded-[var(--radius-card)] border-2 border-dashed px-6 py-12 text-center transition-colors disabled:opacity-60",
                  dragOver ? "border-primary bg-primary-soft/50" : "border-border bg-surface hover:border-primary hover:bg-primary-soft/30",
                )}
              >
                <span className="grid h-14 w-14 place-items-center rounded-2xl bg-primary-soft text-primary">{reading ? <Spinner size={26} /> : <FolderUp size={28} />}</span>
                <span className="text-[15px] font-semibold">{reading ? "Reading folder…" : dragOver ? "Drop to read the folder" : "Drop a folder here, or choose one"}</span>
                <span className="max-w-sm text-[12.5px] text-muted">Prepared in your browser — build files, dependencies and secrets are filtered out automatically. Up to {PUBLISH_LIMITS.maxTotalBytes / (1024 * 1024)} MB.</span>
              </button>
            ) : (
              <>
                <section className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-4 py-3">
                    <FileCode2 size={17} className="shrink-0 text-primary" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[14px] font-semibold">{folderName || "Folder"}</div>
                      <div className="text-[12px] text-muted">
                        {included.length} of {files.length} file{files.length === 1 ? "" : "s"} · {formatBytes(includedBytes)}
                        {diffCounts && <span className="ml-1 text-faint">· {diffCounts.added} new · {diffCounts.overwrite} overwrite{diffCounts.unchanged ? ` · ${diffCounts.unchanged} unchanged` : ""}</span>}
                      </div>
                    </div>
                    <button onClick={() => setAll(true)} className="text-[12px] font-medium text-muted hover:text-foreground">All</button>
                    <span className="text-faint">·</span>
                    <button onClick={() => setAll(false)} className="text-[12px] font-medium text-muted hover:text-foreground">None</button>
                    <Button variant="ghost" size="sm" onClick={() => inputRef.current?.click()} disabled={phase !== "idle"}><RefreshCw size={14} /> Change</Button>
                  </div>
                  <div className="max-h-72 overflow-y-auto">
                    {files.map((f) => {
                      const on = !excluded.has(f.path);
                      const label = on ? labelOf(f) : undefined;
                      return (
                        <label key={f.path} className={cn("flex cursor-pointer items-center gap-2 border-b border-border px-4 py-1.5 font-mono text-[12px] last:border-0 hover:bg-surface-2", !on && "opacity-45")}>
                          <input type="checkbox" checked={on} onChange={() => toggleFile(f.path)} className="h-3.5 w-3.5 shrink-0 accent-[var(--primary)]" />
                          <span className={cn("min-w-0 flex-1 truncate", !on && "line-through")}>{destPath(f.path)}</span>
                          <DiffBadge label={label} />
                          {f.encoding === "base64" && <span className="shrink-0 rounded bg-surface-3 px-1.5 text-[10px] text-muted">binary</span>}
                          <span className="shrink-0 text-faint">{formatBytes(f.size)}</span>
                        </label>
                      );
                    })}
                  </div>
                  {diffState === "unavailable" && <div className="border-t border-border px-4 py-2 text-[11.5px] text-faint">Change preview unavailable — files will still push (add/overwrite only; nothing is deleted).</div>}
                  {(tooLarge.length > 0 || otherSkipped.length > 0) && (
                    <div className="space-y-2 border-t border-border px-4 py-2.5">
                      {tooLarge.length > 0 && (
                        <div className="rounded-[var(--radius-control)] border border-warn/40 bg-warn-soft px-3 py-2">
                          <div className="flex items-center gap-2 text-[12.5px] font-medium text-warn"><FileWarning size={14} /> {tooLarge.length} file{tooLarge.length === 1 ? "" : "s"} too large to push</div>
                          <div className="mt-1.5 max-h-28 space-y-0.5 overflow-y-auto font-mono text-[11.5px] text-muted">
                            {tooLarge.map((s) => <div key={s.path} className="truncate">{s.path} — {s.reason}</div>)}
                          </div>
                          <p className="mt-1 text-[11px] text-faint">Push these with git directly, or via git-LFS for very large files.</p>
                        </div>
                      )}
                      {otherSkipped.length > 0 && (
                        <div>
                          <button onClick={() => setShowSkipped((v) => !v)} className="text-[12px] font-medium text-muted hover:text-foreground">
                            {showSkipped ? "Hide" : "Show"} {otherSkipped.length} auto-skipped file{otherSkipped.length === 1 ? "" : "s"}
                          </button>
                          {showSkipped && (
                            <div className="mt-2 max-h-40 overflow-y-auto rounded-[var(--radius-control)] border border-border">
                              {otherSkipped.map((s) => (
                                <div key={s.path} className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-[12px] last:border-0">
                                  <span className="min-w-0 flex-1 truncate font-mono text-faint">{s.path}</span>
                                  <span className="shrink-0 text-faint">{s.reason}</span>
                                </div>
                              ))}
                            </div>
                          )}
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
                      value={target ? `${target.owner}/${target.name}` : ""}
                      onChange={(full) => { const r = pushable.find((x) => x.fullName === full); if (r) selectRepo(r); }}
                      options={repoOptions.length ? repoOptions : [{ value: "", label: "No push-capable repositories" }]}
                      width={320}
                      ariaLabel="Target repository"
                      className="w-full"
                    />
                  )}
                  {target && !target.canPush && <p className="mt-1 text-[11.5px] text-danger">You don't have push access to this repository.</p>}
                </div>

                {files.length > 0 && target && (
                  <>
                    {/* branch: existing / new */}
                    <div>
                      <label className="mb-1.5 block text-[12px] font-medium text-muted">Branch</label>
                      <div className="mb-2 flex rounded-[var(--radius-control)] border border-border p-0.5 text-[12px]">
                        <SegBtn active={branchMode === "existing"} onClick={() => setBranchMode("existing")}>Existing</SegBtn>
                        <SegBtn active={branchMode === "new"} onClick={() => setBranchMode("new")}>New branch</SegBtn>
                      </div>
                      {branchMode === "existing" ? (
                        <SelectMenu
                          value={branch}
                          onChange={setBranch}
                          options={(branches.length ? branches.map((b) => b.name) : [branch].filter(Boolean)).map((n) => ({ value: n, label: <span className="font-mono">{n}{n === target.defaultBranch ? " (default)" : ""}</span> }))}
                          width={300}
                          ariaLabel="Branch"
                          className="w-full font-mono"
                        />
                      ) : (
                        <>
                          <div className="flex items-center overflow-hidden rounded-[var(--radius-control)] border border-border bg-surface focus-within:border-primary focus-within:ring-focus">
                            <span className="grid h-9 w-9 shrink-0 place-items-center border-r border-border bg-surface-2 text-faint"><GitBranch size={14} /></span>
                            <input value={newBranch} onChange={(e) => setNewBranch(e.target.value.replace(/\s+/g, "-"))} placeholder="feature/upload" className="min-w-0 flex-1 bg-transparent px-2.5 py-2 font-mono text-[13px] outline-none" />
                          </div>
                          <p className="mt-1 text-[11px] text-faint">Branches off <span className="font-mono">{target.defaultBranch}</span>.</p>
                        </>
                      )}
                    </div>

                    {/* commit as PR */}
                    <div className="rounded-[var(--radius-control)] border border-border bg-surface-2 px-3 py-2.5">
                      <label className="flex cursor-pointer items-center justify-between gap-2 text-[12.5px]">
                        <span className="inline-flex items-center gap-1.5"><GitPullRequest size={14} className="text-muted" /> Open a pull request instead</span>
                        <Toggle checked={openPr} onChange={(on) => { setOpenPr(on); if (on && branchMode === "existing" && branch === target.defaultBranch) setBranchMode("new"); }} label="Open a pull request instead" />
                      </label>
                      {openPr && (
                        <div className="mt-2.5 space-y-2">
                          {prBaseSameAsHead && <p className="text-[11.5px] text-danger">Pick a branch other than {target.defaultBranch} to open a PR against it.</p>}
                          <Input value={prTitle} onChange={(e) => setPrTitle(e.target.value)} placeholder={`PR title (defaults to the commit message)`} />
                          <textarea value={prBody} onChange={(e) => setPrBody(e.target.value)} rows={2} placeholder="Description (optional)" className="w-full resize-none rounded-[var(--radius-control)] border border-border bg-surface px-3 py-2 text-[13px] outline-none focus:border-primary focus:ring-focus placeholder:text-faint" />
                          <p className="text-[11px] text-faint">Opens <span className="font-mono">{effectiveBranch || "…"} → {target.defaultBranch}</span>.</p>
                        </div>
                      )}
                    </div>

                    {/* subpath */}
                    <div>
                      <label htmlFor="up-subpath" className="mb-1.5 block text-[12px] font-medium text-muted">Destination folder <span className="text-faint">(optional)</span></label>
                      <Input id="up-subpath" value={subpath} onChange={(e) => setSubpath(e.target.value)} placeholder="e.g. src/vendor" className={cn("font-mono", subpathInvalid && "border-danger")} />
                      <p className={cn("mt-1 text-[11px]", subpathInvalid ? "text-danger" : "text-faint")}>
                        {subpathInvalid ? "Invalid path (no leading slash or “..”)." : cleanSubpath ? `Writes to ${target.name}/${cleanSubpath}/…` : "Writes to the repository root."}
                      </p>
                    </div>

                    {/* commit message */}
                    <div>
                      <label htmlFor="up-msg" className="mb-1.5 block text-[12px] font-medium text-muted">Commit message</label>
                      <Input id="up-msg" value={message} onChange={(e) => setMessage(e.target.value)} />
                    </div>

                    {/* starter .gitignore — only when the target repo doesn't already have one */}
                    {canOfferGitignore && (
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
                    <Upload size={15} /> Push {included.length > 0 ? `${included.length} file${included.length === 1 ? "" : "s"}` : "files"}
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

function SegBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={cn("flex-1 rounded-[6px] px-2 py-1 font-medium transition-colors", active ? "bg-surface-2 text-foreground" : "text-muted hover:text-foreground")}>
      {children}
    </button>
  );
}

function DiffBadge({ label }: { label?: DiffLabel }) {
  if (!label) return null;
  const map: Record<DiffLabel, [string, string]> = {
    added: ["New", "bg-ok-soft text-ok"],
    overwrite: ["Overwrite", "bg-warn-soft text-warn"],
    unchanged: ["Unchanged", "bg-surface-3 text-faint"],
  };
  const [t, cls] = map[label];
  return <span className={cn("shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-sans font-medium", cls)}>{t}</span>;
}
