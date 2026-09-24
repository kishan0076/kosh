import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Check, Eye, ExternalLink, FileCode2, GitBranch, GitPullRequest, Pencil } from "lucide-react";
import { cn } from "@/lib/cn";
import { ApiError } from "@/data/api";
import { githubV2Api, type BranchLite, type PushResult } from "@/data/githubV2Api";
import { useGithubV2, ghToast } from "@/data/githubV2";
import { Button, Input, Toggle } from "@/components/ui";
import { SelectMenu } from "@/components/overlays";
import { Markdown } from "@/components/markdown";
import { PageSkeleton } from "@/components/PageSkeleton";

/**
 * In-app text/README editor. Loads a file (or starts a new one), edits it with a live sanitized preview
 * for Markdown, and commits to a branch or opens a pull request — closing the read-only loop. Reached at
 * /github/:owner/:repo/edit?path=README.md.
 */
export function GithubEdit() {
  const { owner = "", repo = "" } = useParams();
  const [searchParams] = useSearchParams();
  const path = searchParams.get("path") || "README.md";
  const navigate = useNavigate();
  const isMarkdown = /\.(md|markdown)$/i.test(path);

  const [content, setContent] = useState("");
  const [original, setOriginal] = useState("");
  const [defaultBranch, setDefaultBranch] = useState("main");
  const [branches, setBranches] = useState<BranchLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [isNew, setIsNew] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [view, setView] = useState<"edit" | "preview">("edit");

  const [branchMode, setBranchMode] = useState<"existing" | "new">("existing");
  const [branch, setBranch] = useState("");
  const [newBranch, setNewBranch] = useState("");
  const [message, setMessage] = useState("");
  const [openPr, setOpenPr] = useState(false);
  const [prTitle, setPrTitle] = useState("");

  const [phase, setPhase] = useState<"idle" | "saving">("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PushResult | null>(null);

  useEffect(() => {
    let live = true;
    setLoading(true); setLoadError(null); setResult(null);
    Promise.all([
      githubV2Api.getRepo(owner, repo),
      githubV2Api.getContent(owner, repo, path),
    ])
      .then(([{ repo: d }, file]) => {
        if (!live) return;
        setDefaultBranch(d.defaultBranch);
        setBranch(d.defaultBranch);
        setContent(file.content);
        setOriginal(file.content);
        setIsNew(file.isNew);
        setMessage(file.isNew ? `Create ${path}` : `Update ${path}`);
      })
      .catch((err) => { if (live) setLoadError(err instanceof ApiError ? err.message : "Couldn't load that file."); })
      .finally(() => { if (live) setLoading(false); });
    githubV2Api.branches(owner, repo).then(({ branches }) => { if (live) setBranches(branches); }).catch(() => {});
    return () => { live = false; };
  }, [owner, repo, path]);

  const effectiveBranch = (branchMode === "new" ? newBranch : branch).trim();
  const prBaseSameAsHead = openPr && effectiveBranch === defaultBranch;
  const dirty = content !== original;
  const canSave = dirty && !!effectiveBranch && !!message.trim() && !prBaseSameAsHead && phase === "idle";

  const branchOptions = useMemo(
    () => (branches.length ? branches.map((b) => b.name) : [branch].filter(Boolean)).map((n) => ({ value: n, label: <span className="font-mono">{n}{n === defaultBranch ? " (default)" : ""}</span> })),
    [branches, branch, defaultBranch],
  );

  async function save() {
    if (!canSave) return;
    setPhase("saving"); setError(null);
    try {
      const { push } = await githubV2Api.pushFiles(owner, repo, {
        files: [{ path, content, encoding: "utf-8" }],
        message: message.trim(),
        branch: effectiveBranch,
        allowSecrets: true, // an intentional single-file edit; the folder-upload gate doesn't apply
        ...(openPr && !prBaseSameAsHead ? { pullRequest: { base: defaultBranch, title: prTitle.trim() || message.trim() } } : {}),
      });
      setResult(push);
      setOriginal(content);
      setPhase("idle");
      ghToast(push.pullRequestUrl ? "Pull request opened" : `Committed to ${push.branch}`, "ok");
      useGithubV2.getState().load(true).catch(() => {});
    } catch (err) {
      setPhase("idle");
      setError(err instanceof ApiError ? err.message : "Couldn't save the file.");
    }
  }

  if (loading) return <PageSkeleton variant="form" />;
  if (loadError) {
    return (
      <div className="mx-auto grid min-h-[50vh] w-full max-w-lg place-items-center">
        <div className="w-full rounded-[var(--radius-card)] border border-border bg-surface px-6 py-10 text-center">
          <h1 className="text-lg font-semibold">Can't edit this file</h1>
          <p className="mt-1.5 text-[13px] text-muted">{loadError}</p>
          <div className="mt-5 flex justify-center"><Button variant="outline" onClick={() => navigate(`/github/${owner}/${repo}`)}><ArrowLeft size={15} /> Back to repository</Button></div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full space-y-4">
      <Button variant="ghost" size="sm" className="-ml-2" onClick={() => navigate(`/github/${owner}/${repo}`)}><ArrowLeft size={15} /> Back to repository</Button>

      <header className="flex flex-wrap items-center gap-3 rounded-[var(--radius-card)] border border-border bg-surface px-4 py-4 sm:px-5">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary"><Pencil size={20} /></span>
        <div className="min-w-0 flex-1">
          {/* break-all: a nested path must wrap rather than truncate — which file is being edited is the point */}
          <h1 className="break-all text-[17px] font-semibold leading-tight sm:text-lg">{isNew ? "Create" : "Edit"} <span className="font-mono">{path}</span></h1>
          <p className="mt-0.5 truncate font-mono text-[12.5px] text-muted">{owner}/{repo}</p>
        </div>
        {isMarkdown && (
          // phones: the segmented control takes its own full-width row under the title
          <div className="flex basis-full rounded-[var(--radius-control)] border border-border p-0.5 text-[12.5px] sm:basis-auto">
            <button onClick={() => setView("edit")} className={cn("pressable flex flex-1 items-center justify-center gap-1.5 rounded-[6px] px-2.5 py-1 font-medium sm:flex-none [@media(pointer:coarse)]:min-h-9", view === "edit" ? "bg-surface-2 text-foreground" : "text-muted")}><FileCode2 size={13} /> Edit</button>
            <button onClick={() => setView("preview")} className={cn("pressable flex flex-1 items-center justify-center gap-1.5 rounded-[6px] px-2.5 py-1 font-medium sm:flex-none [@media(pointer:coarse)]:min-h-9", view === "preview" ? "bg-surface-2 text-foreground" : "text-muted")}><Eye size={13} /> Preview</button>
          </div>
        )}
      </header>

      {result ? (
        <div className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
          <div className="flex items-center gap-3 border-b border-border bg-ok-soft/40 px-5 py-4">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-ok-soft text-ok"><Check size={20} /></span>
            <div><h2 className="text-[15px] font-semibold">{result.pullRequestUrl ? "Pull request opened" : "Changes committed"}</h2><p className="text-[12.5px] text-muted">on <span className="font-mono">{result.branch}</span></p></div>
          </div>
          {/* phones: full-width buttons stacked with the primary action first; sm+: a right-aligned row */}
          <div className="flex flex-col gap-2 px-5 py-3.5 sm:flex-row sm:flex-wrap sm:justify-end">
            {result.pullRequestUrl ? (
              <a href={result.pullRequestUrl} target="_blank" rel="noreferrer noopener" className="order-first sm:order-last"><Button variant="primary" className="w-full sm:w-auto"><GitPullRequest size={15} /> View pull request</Button></a>
            ) : (
              <a href={result.htmlUrl} target="_blank" rel="noreferrer noopener" className="order-first sm:order-last"><Button variant="primary" className="w-full sm:w-auto"><ExternalLink size={15} /> View commit</Button></a>
            )}
            <Button variant="outline" className="w-full sm:w-auto" onClick={() => navigate(`/github/${owner}/${repo}`)}>Back to repository</Button>
            <Button variant="ghost" className="w-full sm:w-auto sm:order-first" onClick={() => setResult(null)}>Keep editing</Button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
          {/* editor / preview */}
          <div className="min-w-0 overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
            {view === "edit" ? (
              // A borderless editor, so it stays a raw textarea; 16px on phones keeps iOS from zooming on focus.
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                spellCheck={isMarkdown}
                placeholder={`# ${repo}\n\nWrite your ${path}…`}
                className="min-h-[420px] w-full resize-y bg-surface p-4 font-mono text-base leading-relaxed outline-none placeholder:text-faint sm:text-[13px]"
              />
            ) : (
              <div className="min-h-[420px] p-5">{content.trim() ? <Markdown>{content}</Markdown> : <p className="text-[13px] text-muted">Nothing to preview yet.</p>}</div>
            )}
          </div>

          {/* commit controls */}
          <aside className="min-w-0 space-y-4 lg:sticky lg:top-4">
            {/* no overflow-hidden here: it would turn the card into the sticky scrollport for the Commit row */}
            <section className="rounded-[var(--radius-card)] border border-border bg-surface">
              <div className="border-b border-border px-4 py-3 text-[12px] font-semibold uppercase tracking-wide text-faint">Commit changes</div>
              <div className="space-y-4 px-4 py-4">
                <div>
                  <label className="mb-1.5 block text-[12px] font-medium text-muted">Branch</label>
                  <div className="mb-2 flex rounded-[var(--radius-control)] border border-border p-0.5 text-[12px]">
                    <button onClick={() => setBranchMode("existing")} className={cn("pressable flex-1 rounded-[6px] px-2 py-1 font-medium [@media(pointer:coarse)]:min-h-9", branchMode === "existing" ? "bg-surface-2 text-foreground" : "text-muted")}>Existing</button>
                    <button onClick={() => setBranchMode("new")} className={cn("pressable flex-1 rounded-[6px] px-2 py-1 font-medium [@media(pointer:coarse)]:min-h-9", branchMode === "new" ? "bg-surface-2 text-foreground" : "text-muted")}>New branch</button>
                  </div>
                  {branchMode === "existing" ? (
                    <SelectMenu value={branch} onChange={setBranch} options={branchOptions} width={280} ariaLabel="Branch" className="w-full font-mono" />
                  ) : (
                    <div className="flex items-center overflow-hidden rounded-[var(--radius-control)] border border-border bg-surface focus-within:border-primary focus-within:ring-focus">
                      <span className="grid h-9 w-9 shrink-0 place-items-center border-r border-border bg-surface-2 text-faint"><GitBranch size={14} /></span>
                      <input value={newBranch} onChange={(e) => setNewBranch(e.target.value.replace(/\s+/g, "-"))} placeholder="docs/update-readme" className="h-9 min-w-0 flex-1 bg-transparent px-2.5 font-mono text-base outline-none placeholder:text-faint sm:text-[13px]" />
                    </div>
                  )}
                </div>

                <div>
                  <label htmlFor="ed-msg" className="mb-1.5 block text-[12px] font-medium text-muted">Commit message</label>
                  <Input id="ed-msg" value={message} onChange={(e) => setMessage(e.target.value)} />
                </div>

                <div className="rounded-[var(--radius-control)] border border-border bg-surface-2 px-3 py-2.5">
                  <label className="flex cursor-pointer items-center justify-between gap-2 text-[12.5px]">
                    <span className="inline-flex items-center gap-1.5"><GitPullRequest size={14} className="text-muted" /> Open a pull request</span>
                    <Toggle checked={openPr} onChange={(on) => { setOpenPr(on); if (on && branchMode === "existing" && branch === defaultBranch) setBranchMode("new"); }} label="Open a pull request" />
                  </label>
                  {openPr && (
                    <div className="mt-2.5 space-y-2">
                      {prBaseSameAsHead && <p className="text-[12.5px] text-danger">Use a branch other than {defaultBranch}.</p>}
                      <Input value={prTitle} onChange={(e) => setPrTitle(e.target.value)} placeholder="PR title (defaults to commit message)" />
                    </div>
                  )}
                </div>

                {error && <div className="rounded-[var(--radius-control)] border border-danger/40 bg-danger-soft px-3 py-2 text-[12.5px] text-danger">{error}</div>}

                {/* Sticky on phones so Commit stays reachable while the branch/PR fields (and keyboard) are open. */}
                <div className="sticky bottom-0 z-10 -mx-4 -mb-4 space-y-2 rounded-b-[var(--radius-card)] border-t border-border bg-surface px-4 pb-[calc(0.75rem+var(--safe-bottom))] pt-3 lg:static lg:m-0 lg:space-y-4 lg:rounded-none lg:border-0 lg:p-0">
                  <Button variant="primary" className="w-full" onClick={save} disabled={!canSave} loading={phase === "saving"}><Check size={15} /> {phase === "saving" ? "Saving…" : openPr ? "Commit & open PR" : "Commit changes"}</Button>
                  {!dirty && <p className="text-center text-[12px] text-faint">No changes yet.</p>}
                </div>
              </div>
            </section>
          </aside>
        </div>
      )}
    </div>
  );
}
