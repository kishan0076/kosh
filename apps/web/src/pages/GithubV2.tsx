import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Navigate, Route, Routes, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  Archive,
  ArrowLeft,
  ArrowUpDown,
  Book,
  Check,
  ChevronRight,
  CircleDot,
  Clock,
  ExternalLink,
  Filter,
  GitBranch,
  GitCommit,
  GitFork,
  GitPullRequest,
  Github,
  Globe,
  LayoutGrid,
  List as ListIcon,
  Lock,
  Play,
  Plug,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Star,
  Tag,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { ago } from "@/lib/time";
import { useData } from "@/data/store";
import { useUi } from "@/data/ui";
import { api, ApiError } from "@/data/api";
import { githubV2Api, type BranchLite, type CommitLite, type IssueLite, type PullLite, type ReleaseLite, type RepoDetail, type RepoSummary, type WorkflowRunLite } from "@/data/githubV2Api";
import { useGithubV2, visibleRepos, ghToast, type RepoFilter } from "@/data/githubV2";
import { GitHubMark } from "@/lib/icons";
import { Button, Spinner } from "@/components/ui";
import { Menu, MenuItem, MenuLabel, Modal } from "@/components/overlays";
import { Markdown } from "@/components/markdown";
import { FadeSwap } from "@/components/motion";
import { PushFilesModal } from "@/components/github/PushFilesModal";

/* ── module root: connect gate + nested routes ── */

export function GithubV2() {
  const backend = useData((s) => s.backend);
  const user = useData((s) => s.user);
  const toast = useUi((s) => s.toast);
  const connected = !!user.github?.connected;
  const [searchParams, setSearchParams] = useSearchParams();

  // Handle the OAuth return (?github_connected | ?github_error) once, then strip the params.
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
      toast({ message: "GitHub connection failed. Please try again.", tone: "danger" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!backend) return <Gate title="GitHub needs the backend" body="Run the API and set VITE_API_URL to manage your repositories here." />;
  if (!connected) return <ConnectGate />;

  return (
    <Routes>
      <Route index element={<RepoList />} />
      <Route path=":owner/:repo" element={<RepoDetail />} />
      <Route path="*" element={<Navigate to="/github" replace />} />
    </Routes>
  );
}

function Gate({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="mx-auto grid min-h-[55vh] w-full max-w-lg place-items-center">
      <div className="w-full rounded-[var(--radius-card)] border border-border bg-surface px-6 py-10 text-center">
        <span className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-primary-soft text-primary"><Github size={26} /></span>
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="mx-auto mt-1.5 max-w-sm text-[13px] text-muted">{body}</p>
        {action && <div className="mt-5 flex justify-center">{action}</div>}
      </div>
    </div>
  );
}

function ConnectGate() {
  const [oauth, setOauth] = useState(false);
  useEffect(() => {
    let live = true;
    api.githubConnectConfig().then((c) => { if (live) setOauth(c.oauth); }).catch(() => {});
    return () => { live = false; };
  }, []);
  return (
    <Gate
      title="Connect GitHub"
      body={oauth ? "Approve on GitHub and land right back here to manage all your repositories — create, edit, delete, push and more." : "Connect a GitHub token (with the repo scope) in Settings to manage your repositories here."}
      action={
        oauth ? (
          <Button variant="primary" size="lg" onClick={() => { window.location.href = api.githubConnectUrl("github"); }}>
            <GitHubMark size={16} /> Connect GitHub
          </Button>
        ) : (
          <a href="/settings"><Button variant="primary"><Plug size={15} /> Open Settings</Button></a>
        )
      }
    />
  );
}

/* ── repo list ── */

const FILTERS: { k: RepoFilter; label: string }[] = [
  { k: "all", label: "All" },
  { k: "sources", label: "Sources" },
  { k: "forks", label: "Forks" },
  { k: "public", label: "Public" },
  { k: "private", label: "Private" },
  { k: "archived", label: "Archived" },
  { k: "templates", label: "Templates" },
];
const SORTS: { k: "pushed" | "updated" | "created" | "full_name"; label: string }[] = [
  { k: "pushed", label: "Last pushed" },
  { k: "updated", label: "Last updated" },
  { k: "created", label: "Newest" },
  { k: "full_name", label: "Name (A→Z)" },
];

function RepoList() {
  const status = useGithubV2((s) => s.status);
  const error = useGithubV2((s) => s.error);
  const repos = useGithubV2((s) => s.repos);
  const truncated = useGithubV2((s) => s.truncated);
  const query = useGithubV2((s) => s.query);
  const prefs = useGithubV2((s) => s.prefs);
  const load = useGithubV2((s) => s.load);
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (useGithubV2.getState().status === "idle") void load();
  }, [load]);

  const visible = useMemo(() => visibleRepos(repos, query, prefs), [repos, query, prefs]);
  const stats = useMemo(() => ({
    total: repos.length,
    private: repos.filter((r) => r.private).length,
    stars: repos.reduce((a, r) => a + r.stars, 0),
  }), [repos]);

  return (
    <div className="w-full space-y-4">
      <header className="flex flex-wrap items-center gap-4 rounded-[var(--radius-card)] border border-border bg-surface px-5 py-4">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary"><Github size={22} /></span>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold leading-tight">GitHub</h1>
          <p className="mt-0.5 text-[13px] text-muted">
            {status === "ready" ? `${stats.total} repositories · ${stats.private} private · ${stats.stars.toLocaleString()} stars` : "Manage all your repositories"}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => void load(true)} disabled={status === "loading"} aria-label="Refresh">
          <RefreshCw size={15} className={cn(status === "loading" && "animate-spin")} />
        </Button>
        <Button variant="primary" size="sm" onClick={() => setCreating(true)}><Plus size={15} /> New repository</Button>
      </header>

      <RepoToolbar />

      {status === "loading" && repos.length === 0 ? (
        <div className="grid min-h-[40vh] place-items-center"><Spinner size={24} className="text-primary" /></div>
      ) : status === "error" ? (
        <Gate title="Couldn't load repositories" body={error ?? "GitHub didn't respond."} action={<Button variant="primary" onClick={() => void load(true)}>Retry</Button>} />
      ) : visible.length === 0 ? (
        <div className="rounded-[var(--radius-card)] border border-dashed border-border bg-surface px-6 py-16 text-center">
          <p className="text-[14px] font-medium">{query || prefs.filter !== "all" ? "No repositories match" : "No repositories yet"}</p>
          <p className="mt-1 text-[13px] text-muted">{query || prefs.filter !== "all" ? "Try a different search or filter." : "Create your first repository to get started."}</p>
        </div>
      ) : prefs.layout === "grid" ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((r) => <RepoCard key={r.id} repo={r} onOpen={() => navigate(`/github/${r.owner}/${r.name}`)} />)}
        </div>
      ) : (
        <div className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
          {visible.map((r) => <RepoRow key={r.id} repo={r} onOpen={() => navigate(`/github/${r.owner}/${r.name}`)} />)}
        </div>
      )}

      {truncated && <p className="text-center text-[12px] text-faint">Showing the first {repos.length} repositories. Refine your search to find others.</p>}

      {creating && <CreateRepoModal onClose={() => setCreating(false)} onCreated={(r) => navigate(`/github/${r.owner}/${r.name}`)} />}
    </div>
  );
}

function RepoToolbar() {
  const query = useGithubV2((s) => s.query);
  const prefs = useGithubV2((s) => s.prefs);
  const setQuery = useGithubV2((s) => s.setQuery);
  const setSort = useGithubV2((s) => s.setSort);
  const setFilter = useGithubV2((s) => s.setFilter);
  const setLayout = useGithubV2((s) => s.setLayout);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-[var(--radius-control)] border border-border bg-surface px-2.5 focus-within:border-primary focus-within:ring-focus sm:max-w-sm">
        <Search size={15} className="shrink-0 text-muted" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search repositories…" className="min-w-0 flex-1 bg-transparent text-[13px] outline-none" />
        {query && <button onClick={() => setQuery("")} aria-label="Clear"><X size={14} className="text-faint hover:text-foreground" /></button>}
      </label>

      <Menu align="start" width={190} trigger={({ toggle, ref }) => (
        <button ref={ref} onClick={toggle} className={cn("inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-control)] border px-2.5 text-[13px] hover:bg-surface-2", prefs.filter !== "all" ? "border-primary text-primary" : "border-border text-muted")}><Filter size={15} /> {FILTERS.find((f) => f.k === prefs.filter)?.label}</button>
      )}>
        <MenuLabel>Filter</MenuLabel>
        {FILTERS.map((f) => <MenuItem key={f.k} icon={prefs.filter === f.k ? Check : undefined} onClick={() => setFilter(f.k)}>{f.label}</MenuItem>)}
      </Menu>

      <Menu align="end" width={190} trigger={({ toggle, ref }) => (
        <button ref={ref} onClick={toggle} className="inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-control)] border border-border px-2.5 text-[13px] text-muted hover:bg-surface-2"><ArrowUpDown size={15} /> {SORTS.find((s) => s.k === prefs.sort)?.label}</button>
      )}>
        <MenuLabel>Sort by</MenuLabel>
        {SORTS.map((s) => <MenuItem key={s.k} icon={prefs.sort === s.k ? Check : undefined} onClick={() => setSort(s.k)}>{s.label}</MenuItem>)}
      </Menu>

      <div className="flex h-9 items-center rounded-[var(--radius-control)] border border-border p-0.5">
        <button onClick={() => setLayout("grid")} className={cn("grid h-8 w-8 place-items-center rounded-[6px]", prefs.layout === "grid" ? "bg-surface-2 text-foreground" : "text-muted")} aria-label="Grid"><LayoutGrid size={15} /></button>
        <button onClick={() => setLayout("list")} className={cn("grid h-8 w-8 place-items-center rounded-[6px]", prefs.layout === "list" ? "bg-surface-2 text-foreground" : "text-muted")} aria-label="List"><ListIcon size={15} /></button>
      </div>
    </div>
  );
}

function VisBadge({ repo }: { repo: RepoSummary }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border px-1.5 py-0.5 text-[10.5px] text-muted">
      {repo.private ? <Lock size={10} /> : <Globe size={10} />} {repo.private ? "Private" : "Public"}
    </span>
  );
}

function RepoMeta({ repo }: { repo: RepoSummary }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-muted">
      {repo.language && <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-faint" /> {repo.language}</span>}
      {repo.stars > 0 && <span className="inline-flex items-center gap-1"><Star size={12} /> {repo.stars.toLocaleString()}</span>}
      {repo.forks > 0 && <span className="inline-flex items-center gap-1"><GitFork size={12} /> {repo.forks.toLocaleString()}</span>}
      {repo.pushedAt && <span className="inline-flex items-center gap-1"><Clock size={12} /> {ago(repo.pushedAt)}</span>}
    </div>
  );
}

function RepoCard({ repo, onOpen }: { repo: RepoSummary; onOpen: () => void }) {
  return (
    <button onClick={onOpen} className="card-hover flex h-full flex-col gap-2 rounded-[var(--radius-card)] border border-border bg-surface p-4 text-left">
      <div className="flex items-center gap-2">
        <GitHubMark size={16} className="shrink-0 text-muted" />
        <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-foreground">{repo.name}</span>
        {repo.archived && <Archive size={13} className="shrink-0 text-warn" />}
        <VisBadge repo={repo} />
      </div>
      <p className="line-clamp-2 min-h-[2.4em] text-[12.5px] text-muted">{repo.description || <span className="text-faint">No description</span>}</p>
      <div className="mt-auto pt-1"><RepoMeta repo={repo} /></div>
    </button>
  );
}

function RepoRow({ repo, onOpen }: { repo: RepoSummary; onOpen: () => void }) {
  return (
    <button onClick={onOpen} className="flex w-full items-center gap-3 border-b border-border px-4 py-3 text-left last:border-0 hover:bg-surface-2">
      <GitHubMark size={16} className="shrink-0 text-muted" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13.5px] font-semibold">{repo.name}</span>
          {repo.archived && <Archive size={12} className="shrink-0 text-warn" />}
          <VisBadge repo={repo} />
        </div>
        {repo.description && <p className="mt-0.5 truncate text-[12px] text-muted">{repo.description}</p>}
      </div>
      <div className="hidden sm:block"><RepoMeta repo={repo} /></div>
      <ChevronRight size={16} className="shrink-0 text-faint" />
    </button>
  );
}

/* ── create repo ── */

function CreateRepoModal({ onClose, onCreated }: { onClose: () => void; onCreated: (r: RepoDetail) => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isPrivate, setIsPrivate] = useState(true);
  const [autoInit, setAutoInit] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = /^[A-Za-z0-9._-]+$/.test(name.trim());

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { repo } = await githubV2Api.createRepo({ name: name.trim(), description: description.trim() || undefined, private: isPrivate, autoInit });
      useGithubV2.getState().upsertRepo(repo);
      ghToast(`Created ${repo.fullName}`, "ok");
      onCreated(repo);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't create the repository.");
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} className="w-full max-w-md" labelledBy="create-repo-title">
      <div className="p-5">
        <h2 id="create-repo-title" className="text-[16px] font-semibold">New repository</h2>
        <div className="mt-4 space-y-3.5">
          <div>
            <label htmlFor="cr-name" className="mb-1.5 block text-[12px] font-medium text-muted">Repository name</label>
            <input id="cr-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} placeholder="my-project" className="w-full rounded-[var(--radius-control)] border border-border bg-surface px-3 py-2 font-mono text-[14px] outline-none focus:border-primary focus:ring-focus" />
            {name.trim() && !valid && <p className="mt-1 text-[11.5px] text-danger">Only letters, numbers, '.', '_' and '-' are allowed.</p>}
          </div>
          <div>
            <label htmlFor="cr-desc" className="mb-1.5 block text-[12px] font-medium text-muted">Description <span className="text-faint">(optional)</span></label>
            <input id="cr-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What is this project?" className="w-full rounded-[var(--radius-control)] border border-border bg-surface px-3 py-2 text-[14px] outline-none focus:border-primary focus:ring-focus" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <VisButton icon={Lock} label="Private" selected={isPrivate} onClick={() => setIsPrivate(true)} />
            <VisButton icon={Globe} label="Public" selected={!isPrivate} onClick={() => setIsPrivate(false)} />
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-[13px]">
            <input type="checkbox" checked={autoInit} onChange={(e) => setAutoInit(e.target.checked)} className="h-4 w-4 accent-[var(--primary)]" />
            Initialize with a README
          </label>
          {error && <div className="rounded-[var(--radius-control)] border border-danger/40 bg-danger-soft px-3 py-2 text-[12.5px] text-danger">{error}</div>}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={!valid || busy}>{busy ? <Spinner size={15} /> : <Plus size={15} />} Create</Button>
        </div>
      </div>
    </Modal>
  );
}

function VisButton({ icon: Icon, label, selected, onClick }: { icon: typeof Lock; label: string; selected: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={selected} className={cn("flex items-center gap-2 rounded-[var(--radius-control)] border px-3 py-2 text-[13px]", selected ? "border-primary bg-primary-soft text-primary" : "border-border bg-surface-2 text-muted hover:border-border-strong")}>
      <Icon size={14} /> {label}
    </button>
  );
}

/* ── repo detail (tabbed) ── */

type Tab = "overview" | "commits" | "branches" | "releases" | "issues" | "pulls" | "actions";
const TABS: { k: Tab; label: string; icon: typeof Book }[] = [
  { k: "overview", label: "Overview", icon: Book },
  { k: "commits", label: "Commits", icon: GitCommit },
  { k: "branches", label: "Branches", icon: GitBranch },
  { k: "releases", label: "Releases", icon: Tag },
  { k: "issues", label: "Issues", icon: CircleDot },
  { k: "pulls", label: "Pull requests", icon: GitPullRequest },
  { k: "actions", label: "Actions", icon: Play },
];

function RepoDetail() {
  const { owner = "", repo = "" } = useParams();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<RepoDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [pushing, setPushing] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { repo: d } = await githubV2Api.getRepo(owner, repo);
      setDetail(d);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load this repository.");
    } finally {
      setLoading(false);
    }
  }, [owner, repo]);

  useEffect(() => { void reload(); }, [reload]);

  if (loading) return <div className="grid min-h-[50vh] place-items-center"><Spinner size={24} className="text-primary" /></div>;
  if (error || !detail) {
    return <Gate title="Repository unavailable" body={error ?? "Not found."} action={<Button variant="outline" onClick={() => navigate("/github")}><ArrowLeft size={15} /> Back to repositories</Button>} />;
  }

  return (
    <div className="w-full space-y-4">
      <button onClick={() => navigate("/github")} className="inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-foreground"><ArrowLeft size={15} /> All repositories</button>

      {/* header */}
      <header className="rounded-[var(--radius-card)] border border-border bg-surface px-5 py-4">
        <div className="flex flex-wrap items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary"><GitHubMark size={20} /></span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <a href={detail.htmlUrl} target="_blank" rel="noreferrer noopener" className="truncate text-lg font-semibold hover:text-primary">{detail.owner}/{detail.name}</a>
              <VisBadge repo={detail} />
              {detail.archived && <span className="inline-flex items-center gap-1 rounded-full border border-warn/40 bg-warn-soft px-1.5 py-0.5 text-[10.5px] text-warn"><Archive size={10} /> Archived</span>}
              {detail.fork && <span className="inline-flex items-center gap-1 rounded-full border border-border px-1.5 py-0.5 text-[10.5px] text-muted"><GitFork size={10} /> Fork</span>}
            </div>
            {detail.description && <p className="mt-1 text-[13px] text-muted">{detail.description}</p>}
            <div className="mt-2"><RepoMeta repo={detail} /></div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <a href={detail.htmlUrl} target="_blank" rel="noreferrer noopener"><Button variant="outline" size="sm"><ExternalLink size={14} /> Open</Button></a>
            {detail.canPush && <Button variant="secondary" size="sm" onClick={() => setPushing(true)}><Upload size={14} /> Push files</Button>}
            {detail.canAdmin && <Button variant="ghost" size="sm" onClick={() => setEditing(true)}><Settings2 size={14} /> Settings</Button>}
          </div>
        </div>
      </header>

      {/* tabs */}
      <div className="flex gap-1 overflow-x-auto rounded-[var(--radius-card)] border border-border bg-surface p-1">
        {TABS.map(({ k, label, icon: Icon }) => (
          <button key={k} onClick={() => setTab(k)} className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-[var(--radius-control)] px-3 py-1.5 text-[13px] font-medium transition-colors", tab === k ? "bg-primary-soft text-primary" : "text-muted hover:bg-surface-2 hover:text-foreground")}>
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>

      <FadeSwap k={tab}>
        {tab === "overview" ? <OverviewTab repo={detail} /> : <ListTab repo={detail} tab={tab} />}
      </FadeSwap>

      {editing && <EditRepoModal repo={detail} onClose={() => setEditing(false)} onSaved={(d) => { setDetail(d); useGithubV2.getState().upsertRepo(d); }} onRenamed={(d) => { useGithubV2.getState().upsertRepo(d); navigate(`/github/${d.owner}/${d.name}`, { replace: true }); }} onDelete={() => { setEditing(false); setDeleting(true); }} />}
      {deleting && <DeleteRepoModal repo={detail} onClose={() => setDeleting(false)} onDeleted={() => { useGithubV2.getState().removeRepo(detail.fullName); navigate("/github"); }} />}
      {pushing && <PushFilesModal repo={detail} onClose={() => setPushing(false)} />}
    </div>
  );
}

function OverviewTab({ repo }: { repo: RepoDetail }) {
  const [readme, setReadme] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let live = true;
    setLoading(true);
    githubV2Api.getReadme(repo.owner, repo.name).then(({ readme }) => { if (live) setReadme(readme); }).catch(() => {}).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [repo.owner, repo.name]);

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px] lg:items-start">
      <section className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
        <div className="flex items-center gap-2 border-b border-border px-4 py-2.5 text-[13px] font-semibold"><Book size={15} className="text-muted" /> README</div>
        <div className="px-5 py-4">
          {loading ? <div className="grid h-24 place-items-center"><Spinner size={18} className="text-primary" /></div> : readme ? <Markdown>{readme}</Markdown> : <p className="text-[13px] text-muted">This repository has no README.</p>}
        </div>
      </section>
      <aside className="space-y-3">
        <div className="rounded-[var(--radius-card)] border border-border bg-surface p-4">
          <div className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-faint">About</div>
          <dl className="space-y-2 text-[12.5px]">
            <Row label="Default branch"><span className="font-mono">{repo.defaultBranch}</span></Row>
            {repo.language && <Row label="Language">{repo.language}</Row>}
            {repo.license && <Row label="License">{repo.license}</Row>}
            <Row label="Stars">{repo.stars.toLocaleString()}</Row>
            <Row label="Forks">{repo.forks.toLocaleString()}</Row>
            <Row label="Open issues">{repo.openIssues.toLocaleString()}</Row>
            {repo.subscribers != null && <Row label="Watchers">{repo.subscribers.toLocaleString()}</Row>}
            {repo.createdAt && <Row label="Created">{ago(repo.createdAt)}</Row>}
          </dl>
          {repo.homepage && <a href={repo.homepage} target="_blank" rel="noreferrer noopener" className="mt-3 inline-flex items-center gap-1 text-[12.5px] text-primary hover:underline"><Globe size={13} /> {repo.homepage.replace(/^https?:\/\//, "")}</a>}
        </div>
        {repo.topics.length > 0 && (
          <div className="rounded-[var(--radius-card)] border border-border bg-surface p-4">
            <div className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-faint">Topics</div>
            <div className="flex flex-wrap gap-1.5">
              {repo.topics.map((t) => <span key={t} className="rounded-full bg-primary-soft px-2 py-0.5 text-[11.5px] text-primary">{t}</span>)}
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return <div className="flex items-center justify-between gap-2"><dt className="text-muted">{label}</dt><dd className="truncate font-medium">{children}</dd></div>;
}

/* ── the read-only list tabs (commits/branches/releases/issues/pulls/actions) ── */

function ListTab({ repo, tab }: { repo: RepoDetail; tab: Exclude<Tab, "overview"> }) {
  const [rows, setRows] = useState<unknown[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    setRows(null);
    const { owner, name } = repo;
    const p =
      tab === "commits" ? githubV2Api.commits(owner, name, repo.defaultBranch).then((r) => r.commits)
      : tab === "branches" ? githubV2Api.branches(owner, name).then((r) => r.branches)
      : tab === "releases" ? githubV2Api.releases(owner, name).then((r) => r.releases)
      : tab === "issues" ? githubV2Api.issues(owner, name).then((r) => r.issues)
      : tab === "pulls" ? githubV2Api.pulls(owner, name).then((r) => r.pulls)
      : githubV2Api.actions(owner, name).then((r) => r.runs);
    p.then((data) => { if (live) setRows(data as unknown[]); })
      .catch((err) => { if (live) setError(err instanceof ApiError ? err.message : "Couldn't load."); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [repo, tab]);

  if (loading) return <div className="grid h-40 place-items-center rounded-[var(--radius-card)] border border-border bg-surface"><Spinner size={20} className="text-primary" /></div>;
  if (error) return <div className="rounded-[var(--radius-card)] border border-danger/40 bg-danger-soft px-4 py-6 text-center text-[13px] text-danger">{error}</div>;
  if (!rows || rows.length === 0) return <div className="rounded-[var(--radius-card)] border border-dashed border-border bg-surface px-4 py-12 text-center text-[13px] text-muted">Nothing here yet.</div>;

  return (
    <div className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
      {tab === "commits" && (rows as CommitLite[]).map((c) => (
        <a key={c.sha} href={c.htmlUrl} target="_blank" rel="noreferrer noopener" className="flex items-center gap-3 border-b border-border px-4 py-2.5 last:border-0 hover:bg-surface-2">
          <GitCommit size={15} className="shrink-0 text-muted" />
          <div className="min-w-0 flex-1"><div className="truncate text-[13px] font-medium">{c.message.split("\n")[0]}</div><div className="text-[11.5px] text-faint">{c.authorLogin ?? c.authorName ?? "unknown"} · {c.date ? ago(c.date) : ""} · <span className="font-mono">{c.sha.slice(0, 7)}</span></div></div>
          <ExternalLink size={14} className="shrink-0 text-faint" />
        </a>
      ))}
      {tab === "branches" && (rows as BranchLite[]).map((b) => (
        <div key={b.name} className="flex items-center gap-3 border-b border-border px-4 py-2.5 last:border-0">
          <GitBranch size={15} className="shrink-0 text-muted" />
          <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{b.name}{b.name === repo.defaultBranch && <span className="ml-2 rounded-full bg-primary-soft px-1.5 py-0.5 font-sans text-[10px] text-primary">default</span>}</span>
          {b.protected && <span className="shrink-0 rounded-full border border-border px-1.5 py-0.5 text-[10.5px] text-muted">protected</span>}
          <span className="shrink-0 font-mono text-[11.5px] text-faint">{b.commitSha.slice(0, 7)}</span>
        </div>
      ))}
      {tab === "releases" && (rows as ReleaseLite[]).map((r) => (
        <a key={r.id} href={r.htmlUrl} target="_blank" rel="noreferrer noopener" className="flex items-center gap-3 border-b border-border px-4 py-2.5 last:border-0 hover:bg-surface-2">
          <Tag size={15} className="shrink-0 text-muted" />
          <div className="min-w-0 flex-1"><div className="truncate text-[13px] font-medium">{r.name || r.tag}</div><div className="text-[11.5px] text-faint"><span className="font-mono">{r.tag}</span> · {r.publishedAt ? ago(r.publishedAt) : "unpublished"}</div></div>
          {r.draft && <span className="shrink-0 rounded-full border border-border px-1.5 py-0.5 text-[10.5px] text-muted">draft</span>}
          {r.prerelease && <span className="shrink-0 rounded-full border border-warn/40 bg-warn-soft px-1.5 py-0.5 text-[10.5px] text-warn">pre-release</span>}
        </a>
      ))}
      {tab === "issues" && (rows as IssueLite[]).map((i) => (
        <a key={i.number} href={i.htmlUrl} target="_blank" rel="noreferrer noopener" className="flex items-center gap-3 border-b border-border px-4 py-2.5 last:border-0 hover:bg-surface-2">
          <CircleDot size={15} className="shrink-0 text-ok" />
          <div className="min-w-0 flex-1"><div className="truncate text-[13px] font-medium">{i.title}</div><div className="text-[11.5px] text-faint">#{i.number} · {i.authorLogin ?? "unknown"} · {i.createdAt ? ago(i.createdAt) : ""}</div></div>
          {i.comments > 0 && <span className="shrink-0 text-[11.5px] text-faint">{i.comments} 💬</span>}
        </a>
      ))}
      {tab === "pulls" && (rows as PullLite[]).map((p) => (
        <a key={p.number} href={p.htmlUrl} target="_blank" rel="noreferrer noopener" className="flex items-center gap-3 border-b border-border px-4 py-2.5 last:border-0 hover:bg-surface-2">
          <GitPullRequest size={15} className={cn("shrink-0", p.draft ? "text-muted" : "text-ok")} />
          <div className="min-w-0 flex-1"><div className="truncate text-[13px] font-medium">{p.title}</div><div className="text-[11.5px] text-faint">#{p.number} · {p.authorLogin ?? "unknown"} · <span className="font-mono">{p.head}→{p.base}</span></div></div>
          {p.draft && <span className="shrink-0 rounded-full border border-border px-1.5 py-0.5 text-[10.5px] text-muted">draft</span>}
        </a>
      ))}
      {tab === "actions" && (rows as WorkflowRunLite[]).map((w) => (
        <a key={w.id} href={w.htmlUrl} target="_blank" rel="noreferrer noopener" className="flex items-center gap-3 border-b border-border px-4 py-2.5 last:border-0 hover:bg-surface-2">
          <RunDot conclusion={w.conclusion} status={w.status} />
          <div className="min-w-0 flex-1"><div className="truncate text-[13px] font-medium">{w.name || "Workflow run"}</div><div className="text-[11.5px] text-faint">{w.event} · <span className="font-mono">{w.branch}</span> · {w.createdAt ? ago(w.createdAt) : ""}</div></div>
          <span className="shrink-0 text-[11.5px] text-faint">{w.conclusion ?? w.status}</span>
        </a>
      ))}
    </div>
  );
}

function RunDot({ conclusion, status }: { conclusion?: string; status?: string }) {
  const tone = conclusion === "success" ? "bg-ok" : conclusion === "failure" ? "bg-danger" : status === "in_progress" || status === "queued" ? "bg-warn" : "bg-faint";
  return <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", tone)} />;
}

/* ── edit + delete ── */

function EditRepoModal({ repo, onClose, onSaved, onRenamed, onDelete }: { repo: RepoDetail; onClose: () => void; onSaved: (d: RepoDetail) => void; onRenamed: (d: RepoDetail) => void; onDelete: () => void }) {
  const [name, setName] = useState(repo.name);
  const [description, setDescription] = useState(repo.description ?? "");
  const [isPrivate, setIsPrivate] = useState(repo.private);
  const [homepage, setHomepage] = useState(repo.homepage ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameValid = /^[A-Za-z0-9._-]+$/.test(name.trim());

  const save = async () => {
    if (!nameValid || busy) return;
    setBusy(true);
    setError(null);
    const renamed = name.trim() !== repo.name;
    try {
      const { repo: d } = await githubV2Api.updateRepo(repo.owner, repo.name, {
        name: renamed ? name.trim() : undefined,
        description,
        private: isPrivate,
        homepage,
      });
      ghToast("Repository updated", "ok");
      if (renamed) onRenamed(d); else onSaved(d);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't update the repository.");
      setBusy(false);
    }
  };

  const toggleArchive = async () => {
    setBusy(true);
    setError(null);
    try {
      const { repo: d } = await githubV2Api.updateRepo(repo.owner, repo.name, { archived: !repo.archived });
      ghToast(d.archived ? "Repository archived" : "Repository unarchived", "ok");
      onSaved(d);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't change archive state.");
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} className="w-full max-w-md" labelledBy="edit-repo-title">
      <div className="p-5">
        <h2 id="edit-repo-title" className="text-[16px] font-semibold">Repository settings</h2>
        <div className="mt-4 space-y-3.5">
          <div>
            <label htmlFor="er-name" className="mb-1.5 block text-[12px] font-medium text-muted">Name</label>
            <input id="er-name" value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-[var(--radius-control)] border border-border bg-surface px-3 py-2 font-mono text-[14px] outline-none focus:border-primary focus:ring-focus" />
            {name.trim() && !nameValid && <p className="mt-1 text-[11.5px] text-danger">Only letters, numbers, '.', '_' and '-' are allowed.</p>}
            {nameValid && name.trim() !== repo.name && <p className="mt-1 text-[11.5px] text-warn">Renaming changes the repository URL.</p>}
          </div>
          <div>
            <label htmlFor="er-desc" className="mb-1.5 block text-[12px] font-medium text-muted">Description</label>
            <input id="er-desc" value={description} onChange={(e) => setDescription(e.target.value)} className="w-full rounded-[var(--radius-control)] border border-border bg-surface px-3 py-2 text-[14px] outline-none focus:border-primary focus:ring-focus" />
          </div>
          <div>
            <label htmlFor="er-home" className="mb-1.5 block text-[12px] font-medium text-muted">Homepage <span className="text-faint">(optional)</span></label>
            <input id="er-home" value={homepage} onChange={(e) => setHomepage(e.target.value)} placeholder="https://…" className="w-full rounded-[var(--radius-control)] border border-border bg-surface px-3 py-2 text-[14px] outline-none focus:border-primary focus:ring-focus" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <VisButton icon={Lock} label="Private" selected={isPrivate} onClick={() => setIsPrivate(true)} />
            <VisButton icon={Globe} label="Public" selected={!isPrivate} onClick={() => setIsPrivate(false)} />
          </div>
          {error && <div className="rounded-[var(--radius-control)] border border-danger/40 bg-danger-soft px-3 py-2 text-[12.5px] text-danger">{error}</div>}
        </div>

        <div className="mt-4 flex items-center justify-between">
          <Button variant="ghost" size="sm" onClick={toggleArchive} disabled={busy}><Archive size={14} /> {repo.archived ? "Unarchive" : "Archive"}</Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button variant="primary" onClick={save} disabled={!nameValid || busy}>{busy ? <Spinner size={15} /> : <Check size={15} />} Save</Button>
          </div>
        </div>

        {repo.canAdmin && (
          <div className="mt-5 rounded-[var(--radius-control)] border border-danger/30 bg-danger-soft/40 px-3.5 py-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[13px] font-semibold text-danger">Delete this repository</div>
                <div className="text-[11.5px] text-muted">This cannot be undone.</div>
              </div>
              <Button variant="outline" size="sm" className="border-danger/40 text-danger hover:bg-danger-soft" onClick={onDelete}><Trash2 size={14} /> Delete</Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

function DeleteRepoModal({ repo, onClose, onDeleted }: { repo: RepoDetail; onClose: () => void; onDeleted: () => void }) {
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const match = confirm === repo.fullName;

  const del = async () => {
    if (!match || busy) return;
    setBusy(true);
    setError(null);
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
        <h2 id="del-repo-title" className="text-[16px] font-semibold text-danger">Delete repository</h2>
        <p className="mt-2 text-[13px] text-muted">This permanently deletes <span className="font-mono font-medium text-foreground">{repo.fullName}</span>, its code, issues, PRs and releases. This cannot be undone.</p>
        <label htmlFor="del-confirm" className="mb-1.5 mt-4 block text-[12px] font-medium text-muted">Type <span className="font-mono text-foreground">{repo.fullName}</span> to confirm</label>
        <input id="del-confirm" autoFocus value={confirm} onChange={(e) => setConfirm(e.target.value)} onKeyDown={(e) => e.key === "Enter" && del()} className="w-full rounded-[var(--radius-control)] border border-border bg-surface px-3 py-2 font-mono text-[13px] outline-none focus:border-danger focus:ring-focus" />
        {error && <div className="mt-3 rounded-[var(--radius-control)] border border-danger/40 bg-danger-soft px-3 py-2 text-[12.5px] text-danger">{error}</div>}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" className="bg-danger hover:bg-danger" onClick={del} disabled={!match || busy}>{busy ? <Spinner size={15} /> : <Trash2 size={15} />} Delete forever</Button>
        </div>
      </div>
    </Modal>
  );
}

