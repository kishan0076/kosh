import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Archive, ArrowLeft, Check, GitBranch, Globe, Settings2, Tag, Trash2 } from "lucide-react";
import { isValidRepoName } from "@kosh/shared";
import { ApiError } from "@/data/api";
import { githubV2Api, type BranchLite, type RepoDetail } from "@/data/githubV2Api";
import { useGithubV2, ghToast } from "@/data/githubV2";
import { GitHubMark } from "@/lib/icons";
import { Button, Input, Spinner } from "@/components/ui";
import { Modal, SelectMenu } from "@/components/overlays";
import { RepoNameField, TopicsInput, VisibilityPicker } from "@/components/github/RepoForm";

/**
 * Dedicated repository Settings page (replaces the cramped EditRepoModal). Rename, description,
 * homepage, visibility, default branch, topics, archive — plus an inline Danger Zone that launches the
 * type-to-confirm delete (the one place a blocking modal is still the right call).
 */
export function GithubSettings() {
  const { owner = "", repo = "" } = useParams();
  const navigate = useNavigate();

  const [detail, setDetail] = useState<RepoDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [branches, setBranches] = useState<BranchLite[]>([]);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [homepage, setHomepage] = useState("");
  const [isPrivate, setIsPrivate] = useState(true);
  const [defaultBranch, setDefaultBranch] = useState("");
  const [topics, setTopics] = useState<string[]>([]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setLoadError(null);
    githubV2Api
      .getRepo(owner, repo)
      .then(({ repo: d }) => {
        if (!live) return;
        setDetail(d);
        setName(d.name); setDescription(d.description ?? ""); setHomepage(d.homepage ?? "");
        setIsPrivate(d.private); setDefaultBranch(d.defaultBranch); setTopics(d.topics);
      })
      .catch((err) => { if (live) setLoadError(err instanceof ApiError ? err.message : "Couldn't load this repository."); })
      .finally(() => { if (live) setLoading(false); });
    githubV2Api.branches(owner, repo).then(({ branches }) => { if (live) setBranches(branches); }).catch(() => {});
    return () => { live = false; };
  }, [owner, repo]);

  if (loading) return <div className="grid min-h-[50vh] place-items-center"><Spinner size={24} className="text-primary" /></div>;
  if (loadError || !detail) {
    return (
      <div className="mx-auto grid min-h-[50vh] w-full max-w-lg place-items-center">
        <div className="w-full rounded-[var(--radius-card)] border border-border bg-surface px-6 py-10 text-center">
          <h1 className="text-lg font-semibold">Settings unavailable</h1>
          <p className="mt-1.5 text-[13px] text-muted">{loadError ?? "Not found."}</p>
          <div className="mt-5 flex justify-center"><Button variant="outline" onClick={() => navigate("/github")}><ArrowLeft size={15} /> Back to repositories</Button></div>
        </div>
      </div>
    );
  }

  const nameValid = isValidRepoName(name.trim());
  const renamed = name.trim() !== detail.name;
  const topicsChanged = topics.join(",") !== detail.topics.join(",");
  const dirty = renamed || description !== (detail.description ?? "") || homepage !== (detail.homepage ?? "") || isPrivate !== detail.private || defaultBranch !== detail.defaultBranch || topicsChanged;

  async function save() {
    if (!nameValid || busy || !detail) return;
    setBusy(true); setError(null);
    try {
      const patch: Parameters<typeof githubV2Api.updateRepo>[2] = {
        description,
        private: isPrivate,
        homepage,
        ...(renamed ? { name: name.trim() } : {}),
        ...(defaultBranch !== detail.defaultBranch ? { defaultBranch } : {}),
      };
      const { repo: d } = await githubV2Api.updateRepo(detail.owner, detail.name, patch);
      let next = d;
      let topicsFailed = false;
      if (topicsChanged) {
        try { const { topics: saved } = await githubV2Api.setTopics(d.owner, d.name, topics); next = { ...d, topics: saved }; }
        catch { topicsFailed = true; setTopics(d.topics); } // revert the field to the server's truth
      }
      useGithubV2.getState().upsertRepo(next);
      setDetail(next);
      ghToast(topicsFailed ? "Saved, but topics couldn't be updated" : "Repository updated", topicsFailed ? "warn" : "ok");
      if (renamed) navigate(`/github/${next.owner}/${next.name}/settings`, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save changes.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleArchive() {
    if (busy || !detail) return;
    setBusy(true); setError(null);
    try {
      const { repo: d } = await githubV2Api.updateRepo(detail.owner, detail.name, { archived: !detail.archived });
      useGithubV2.getState().upsertRepo(d);
      setDetail(d);
      ghToast(d.archived ? "Repository archived" : "Repository unarchived", "ok");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't change archive state.");
    } finally {
      setBusy(false);
    }
  }

  const branchOptions = (branches.length ? branches.map((b) => b.name) : [defaultBranch].filter(Boolean)).map((n) => ({ value: n, label: <span className="font-mono">{n}</span> }));

  return (
    <div className="w-full space-y-5">
      <button onClick={() => navigate(`/github/${owner}/${repo}`)} className="inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-foreground"><ArrowLeft size={15} /> Back to repository</button>

      <header className="flex items-center gap-4 rounded-[var(--radius-card)] border border-border bg-surface px-5 py-4">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary"><Settings2 size={22} /></span>
        <div className="min-w-0">
          <h1 className="text-xl font-semibold leading-tight">Settings</h1>
          <p className="mt-0.5 truncate font-mono text-[13px] text-muted">{detail.owner}/{detail.name}</p>
        </div>
      </header>

      {/* general */}
      <section className="space-y-4 rounded-[var(--radius-card)] border border-border bg-surface p-5">
        <div className="text-[12px] font-semibold uppercase tracking-wide text-faint">General</div>
        <div>
          <RepoNameField value={name} onChange={setName} ownerPrefix={detail.owner} label="Repository name" onEnter={save} />
          {nameValid && renamed && <p className="mt-1 text-[11.5px] text-warn">Renaming changes the repository URL — existing links and clones will break.</p>}
        </div>
        <div>
          <label htmlFor="s-desc" className="mb-1.5 block text-[12px] font-medium text-muted">Description</label>
          <Input id="s-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What is this project?" />
        </div>
        <div>
          <label htmlFor="s-home" className="mb-1.5 flex items-center gap-1.5 text-[12px] font-medium text-muted"><Globe size={13} /> Homepage</label>
          <Input id="s-home" value={homepage} onChange={(e) => setHomepage(e.target.value)} placeholder="https://…" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <span className="mb-1.5 block text-[12px] font-medium text-muted">Visibility</span>
            <VisibilityPicker isPrivate={isPrivate} onChange={setIsPrivate} variant="compact" />
          </div>
          <div>
            <label className="mb-1.5 flex items-center gap-1.5 text-[12px] font-medium text-muted"><GitBranch size={13} /> Default branch</label>
            <SelectMenu value={defaultBranch} onChange={setDefaultBranch} options={branchOptions} width={280} ariaLabel="Default branch" className="w-full" />
          </div>
        </div>
        <div>
          <label className="mb-1.5 flex items-center gap-1.5 text-[12px] font-medium text-muted"><Tag size={13} /> Topics</label>
          <TopicsInput topics={topics} onChange={setTopics} />
        </div>

        {error && <div className="rounded-[var(--radius-control)] border border-danger/40 bg-danger-soft px-3 py-2 text-[12.5px] text-danger">{error}</div>}

        <div className="flex items-center justify-between border-t border-border pt-4">
          <Button variant="ghost" size="sm" onClick={toggleArchive} disabled={busy}><Archive size={14} /> {detail.archived ? "Unarchive" : "Archive"}</Button>
          <Button variant="primary" onClick={save} disabled={!nameValid || !dirty || busy}>{busy ? <Spinner size={15} /> : <Check size={15} />} Save changes</Button>
        </div>
      </section>

      {/* danger zone */}
      {detail.canAdmin && (
        <section className="overflow-hidden rounded-[var(--radius-card)] border border-danger/30">
          <div className="border-b border-danger/20 bg-danger-soft/40 px-5 py-2.5 text-[12px] font-semibold uppercase tracking-wide text-danger">Danger zone</div>
          <div className="flex flex-wrap items-center justify-between gap-3 bg-surface px-5 py-4">
            <div>
              <div className="text-[13.5px] font-semibold">Delete this repository</div>
              <div className="text-[12px] text-muted">Permanently removes {detail.fullName}, its code, issues, PRs and releases.</div>
            </div>
            <Button variant="outline" size="sm" className="border-danger/40 text-danger hover:bg-danger-soft" onClick={() => setDeleting(true)}><Trash2 size={14} /> Delete</Button>
          </div>
        </section>
      )}

      {deleting && <DeleteRepoModal repo={detail} onClose={() => setDeleting(false)} onDeleted={() => { useGithubV2.getState().removeRepo(detail.fullName); navigate("/github"); }} />}
    </div>
  );
}

/** Type-to-confirm destructive delete — the canonical correct use of a blocking modal. */
function DeleteRepoModal({ repo, onClose, onDeleted }: { repo: RepoDetail; onClose: () => void; onDeleted: () => void }) {
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const match = confirm === repo.fullName;

  const del = async () => {
    if (!match || busy) return;
    setBusy(true); setError(null);
    try {
      await githubV2Api.deleteRepo(repo.owner, repo.name, confirm);
      ghToast(`Deleted ${repo.fullName}`, "warn");
      onDeleted();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't delete the repository.");
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} className="w-full max-w-md" labelledBy="del-repo-title">
      <div className="p-5">
        <h2 id="del-repo-title" className="flex items-center gap-2 text-[16px] font-semibold text-danger"><GitHubMark size={17} /> Delete repository</h2>
        <p className="mt-2 text-[13px] text-muted">This permanently deletes <span className="font-mono font-medium text-foreground">{repo.fullName}</span>, its code, issues, PRs and releases. This cannot be undone.</p>
        <label htmlFor="del-confirm" className="mb-1.5 mt-4 block text-[12px] font-medium text-muted">Type <span className="font-mono text-foreground">{repo.fullName}</span> to confirm</label>
        <input id="del-confirm" autoFocus value={confirm} onChange={(e) => setConfirm(e.target.value)} onKeyDown={(e) => e.key === "Enter" && del()} className="w-full rounded-[var(--radius-control)] border border-border bg-surface px-3 py-2 font-mono text-[13px] outline-none focus:border-danger focus:ring-focus" />
        {error && <div className="mt-3 rounded-[var(--radius-control)] border border-danger/40 bg-danger-soft px-3 py-2 text-[12.5px] text-danger">{error}</div>}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="danger" onClick={del} disabled={!match || busy}>{busy ? <Spinner size={15} /> : <Trash2 size={15} />} Delete forever</Button>
        </div>
      </div>
    </Modal>
  );
}
