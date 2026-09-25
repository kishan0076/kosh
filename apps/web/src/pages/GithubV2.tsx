import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Navigate, Route, Routes, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  Activity,
  Archive,
  ArrowLeft,
  ArrowUpDown,
  Book,
  Check,
  CheckSquare,
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
  Pencil,
  Play,
  Plug,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Square,
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
import { startConnect } from "@/lib/connect";
import { githubV2Api, type BranchLite, type CommitLite, type IssueLite, type PullLite, type ReleaseLite, type RepoDetail, type RepoSummary, type WorkflowRunLite } from "@/data/githubV2Api";
import { useGithubV2, visibleRepos, ghToast, type RepoFilter } from "@/data/githubV2";
import { GitHubMark } from "@/lib/icons";
import { Badge, Button, Input } from "@/components/ui";
import { Menu, MenuItem, MenuLabel, Modal } from "@/components/overlays";
import { useBottomStack } from "@/components/Toaster";
import { EmptyState } from "@/components/common";
import { Markdown } from "@/components/markdown";
import { FadeSwap, Reveal } from "@/components/motion";
import { PageSkeleton, SkeletonRow, SkeletonText } from "@/components/PageSkeleton";
import { revealClass, revealStyle } from "@/lib/motion";
import { GithubNew } from "./GithubNew";
import { GithubUpload } from "./GithubUpload";
import { GithubSettings } from "./GithubSettings";
import { GithubHealth } from "./GithubHealth";
import { GithubEdit } from "./GithubEdit";

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
      <Route path="new" element={<GithubNew />} />
      <Route path="health" element={<GithubHealth />} />
      <Route path="upload" element={<GithubUpload />} />
      <Route path=":owner/:repo/upload" element={<GithubUpload />} />
      <Route path=":owner/:repo/edit" element={<GithubEdit />} />
      <Route path=":owner/:repo/settings" element={<GithubSettings />} />
      <Route path=":owner/:repo" element={<RepoDetail />} />
      <Route path=":owner/:repo/:tab" element={<RepoDetail />} />
      <Route path="*" element={<Navigate to="/github" replace />} />
    </Routes>
  );
}

/** `compact` for inline list/detail errors (no tall vertical centering — the toolbar is right above). */
function Gate({ title, body, action, compact }: { title: string; body: string; action?: ReactNode; compact?: boolean }) {
  return (
    <div className={cn("mx-auto grid w-full max-w-lg place-items-center", compact ? "py-6" : "min-h-[55vh]")}>
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
          <Button variant="primary" size="lg" onClick={() => { void startConnect("github", "github"); }}>
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
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulk, setBulk] = useState<BulkAction | null>(null);

  useEffect(() => {
    if (useGithubV2.getState().status === "idle") void load();
  }, [load]);

  const visible = useMemo(() => visibleRepos(repos, query, prefs), [repos, query, prefs]);
  const selectedRepos = useMemo(() => visible.filter((r) => selected.has(r.id)), [visible, selected]);
  const toggleSel = (id: number) => setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const exitSelect = () => { setSelectMode(false); setSelected(new Set()); };
  const onCardClick = (r: RepoSummary) => (selectMode ? toggleSel(r.id) : navigate(`/github/${r.owner}/${r.name}`));
  const stats = useMemo(() => ({
    total: repos.length,
    private: repos.filter((r) => r.private).length,
    stars: repos.reduce((a, r) => a + r.stars, 0),
  }), [repos]);

  const filtered = !!query || prefs.filter !== "all";
  // Re-key the collection on filter/sort so the first cards reveal again; typing a query does not.
  const listKey = `${prefs.filter}:${prefs.sort}`;

  return (
    // Bottom padding in select mode keeps the last card clear of the fixed selection bar.
    <div className={cn("w-full space-y-4", selectMode && "pb-24")}>
      {/* On phones the title block takes the full first row and the actions form a 2-col grid under it. */}
      <header className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface px-4 py-4 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4 sm:px-5">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary"><Github size={22} /></span>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold leading-tight">GitHub</h1>
            <p className="mt-0.5 text-pretty text-[13px] text-muted">
              {status === "ready" ? `${stats.total} repositories · ${stats.private} private · ${stats.stars.toLocaleString()} stars` : "Manage all your repositories"}
            </p>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={() => void load(true)} disabled={status === "loading"} aria-label="Refresh">
            <RefreshCw size={15} className={cn(status === "loading" && "animate-spin")} />
          </Button>
        </div>
        {/* ghost buttons get a border below sm so they read as buttons in the grid, not floating labels */}
        <div className="grid grid-cols-2 gap-2 sm:flex sm:w-auto sm:items-center">
          <Button variant="ghost" size="sm" className="border-border sm:border-transparent" onClick={() => navigate("/github/health")}><Activity size={15} /> Health</Button>
          <Button variant={selectMode ? "secondary" : "ghost"} size="sm" className={cn(!selectMode && "border-border sm:border-transparent")} onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}><CheckSquare size={15} /> {selectMode ? "Done" : "Select"}</Button>
          <Button variant="outline" size="sm" onClick={() => navigate("/github/upload")}><Upload size={15} /> Upload folder</Button>
          <Button variant="primary" size="sm" className="col-span-2 sm:col-span-1" onClick={() => navigate("/github/new")}><Plus size={15} /> New repository</Button>
        </div>
      </header>

      <RepoToolbar />

      {status === "loading" && repos.length === 0 ? (
        <PageSkeleton variant={prefs.layout === "list" ? "table" : "cards"} header={false} rows={6} />
      ) : status === "error" ? (
        <Gate compact title="Couldn't load repositories" body={error ?? "GitHub didn't respond."} action={<Button variant="primary" onClick={() => void load(true)}>Retry</Button>} />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={Github}
          title={filtered ? "No repositories match" : "No repositories yet"}
          description={
            filtered ? "Try a different search or filter." : (
              <>
                Create your first repository to get started.
                <span className="mt-2 block text-[12px] text-faint">
                  Expecting existing repos? Kosh needs a classic GitHub <span className="font-medium">OAuth App</span> (with the <span className="font-mono">repo</span> scope) — a <span className="font-medium">GitHub App</span> only shows repositories it's installed on. See <span className="font-mono">docs/GITHUB.md</span>.
                </span>
              </>
            )
          }
          action={!filtered && <Button variant="primary" onClick={() => navigate("/github/new")}><Plus size={15} /> New repository</Button>}
        />
      ) : prefs.layout === "grid" ? (
        <div key={listKey} className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((r, i) => <RepoCard key={r.id} repo={r} index={i} onOpen={() => onCardClick(r)} selectMode={selectMode} selected={selected.has(r.id)} />)}
        </div>
      ) : (
        <div key={listKey} className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
          {visible.map((r, i) => <RepoRow key={r.id} repo={r} index={i} onOpen={() => onCardClick(r)} selectMode={selectMode} selected={selected.has(r.id)} />)}
        </div>
      )}

      {truncated && <p className="text-center text-[12px] text-faint">Showing the first {repos.length} repositories. Refine your search to find others.</p>}

      {selectMode && selectedRepos.length > 0 && <SelectionBar repos={selectedRepos} onAction={setBulk} onClear={() => setSelected(new Set())} />}
      {bulk && <BulkModal action={bulk} repos={selectedRepos} onClose={() => setBulk(null)} onDone={() => { setBulk(null); exitSelect(); }} />}
    </div>
  );
}

type BulkAction = "archive" | "unarchive" | "makePrivate" | "makePublic" | "delete";
const BULK_META: Record<BulkAction, { label: string; icon: typeof Archive; verb: string; danger?: boolean }> = {
  archive: { label: "Archive", icon: Archive, verb: "Archive" },
  unarchive: { label: "Unarchive", icon: Archive, verb: "Unarchive" },
  makePrivate: { label: "Make private", icon: Lock, verb: "Make private" },
  makePublic: { label: "Make public", icon: Globe, verb: "Make public" },
  delete: { label: "Delete", icon: Trash2, verb: "Delete", danger: true },
};

function SelectionBar({ repos, onAction, onClear }: { repos: RepoSummary[]; onAction: (a: BulkAction) => void; onClear: () => void }) {
  // Archive / visibility / delete all require admin — offer them only when every selected repo qualifies,
  // otherwise the server would reject the ones the user can't manage.
  const admin = repos.every((r) => r.canAdmin);
  // Phones: a full-width bar hugging the bottom safe area with icon-only actions (labelled for AT);
  // sm+: the floating pill with labels. z-40 sits under the bulk modal (z-50) and the toaster (z-70).
  const actionCls = "min-w-10 px-2.5 sm:min-w-0 sm:px-3";
  // Publishes its height as --bottom-stack so a toast (bulk result) lands above the bar, not on it.
  const ref = useRef<HTMLDivElement>(null);
  useBottomStack(ref);
  return (
    <div ref={ref} className="pointer-events-none fixed inset-x-0 bottom-0 z-40 mb-safe flex justify-center px-3 pb-3 sm:bottom-4 sm:px-4 sm:pb-0">
      <Reveal className="pointer-events-auto flex w-full items-center gap-1 rounded-2xl border border-border bg-elevated px-2 py-1.5 shadow-[var(--shadow-pop)] sm:w-auto sm:gap-2 sm:rounded-full sm:px-3 sm:py-2">
        <span className="shrink-0 px-2 text-[13px] font-semibold tabular sm:px-1">{repos.length} selected</span>
        <span className="hidden h-4 w-px bg-border sm:block" />
        <div className="flex min-w-0 flex-1 items-center justify-end gap-1 overflow-x-auto [scrollbar-width:none] sm:flex-none sm:gap-2 sm:overflow-visible">
          {admin ? (
            <>
              <Button variant="ghost" size="sm" className={actionCls} onClick={() => onAction("archive")} aria-label="Archive"><Archive size={15} /> <span className="hidden sm:inline">Archive</span></Button>
              <Button variant="ghost" size="sm" className={actionCls} onClick={() => onAction("makePrivate")} aria-label="Make private"><Lock size={15} /> <span className="hidden sm:inline">Private</span></Button>
              <Button variant="ghost" size="sm" className={actionCls} onClick={() => onAction("makePublic")} aria-label="Make public"><Globe size={15} /> <span className="hidden sm:inline">Public</span></Button>
              <Button variant="ghost" size="sm" className={cn(actionCls, "text-danger hover:bg-danger-soft")} onClick={() => onAction("delete")} aria-label="Delete"><Trash2 size={15} /> <span className="hidden sm:inline">Delete</span></Button>
            </>
          ) : (
            <span className="min-w-0 truncate px-1 text-[12px] text-muted">Some selected repos aren't yours to manage</span>
          )}
        </div>
        <span className="hidden h-4 w-px bg-border sm:block" />
        <Button variant="ghost" size="icon-sm" className="shrink-0 rounded-full" onClick={onClear} aria-label="Clear selection"><X size={15} /></Button>
      </Reveal>
    </div>
  );
}

/** Run a bulk action across the selected repos with a small concurrency pool + partial-failure report. */
function BulkModal({ action, repos, onClose, onDone }: { action: BulkAction; repos: RepoSummary[]; onClose: () => void; onDone: () => void }) {
  const meta = BULK_META[action];
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<{ repo: RepoSummary; ok: boolean; error?: string }[] | null>(null);
  const needsType = action === "delete";
  const ready = !needsType || confirm.trim().toLowerCase() === "delete";

  async function run() {
    if (!ready || busy) return;
    setBusy(true);
    const out: { repo: RepoSummary; ok: boolean; error?: string }[] = [];
    let i = 0;
    const worker = async () => {
      while (i < repos.length) {
        const r = repos[i++]!;
        try {
          if (action === "delete") { await githubV2Api.deleteRepo(r.owner, r.name, r.fullName); useGithubV2.getState().removeRepo(r.fullName); }
          else {
            const patch = action === "archive" ? { archived: true } : action === "unarchive" ? { archived: false } : action === "makePrivate" ? { private: true } : { private: false };
            const { repo: d } = await githubV2Api.updateRepo(r.owner, r.name, patch);
            useGithubV2.getState().upsertRepo(d);
          }
          out.push({ repo: r, ok: true });
        } catch (err) {
          out.push({ repo: r, ok: false, error: err instanceof ApiError ? err.message : "failed" });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, repos.length) }, worker));
    setBusy(false);
    const failed = out.filter((o) => !o.ok);
    ghToast(`${meta.verb}: ${out.length - failed.length} succeeded${failed.length ? `, ${failed.length} failed` : ""}`, failed.length ? "warn" : "ok");
    if (failed.length === 0) onDone();
    else setResults(out);
  }

  return (
    <Modal open onClose={busy ? () => {} : onClose} className="w-full max-w-md" labelledBy="bulk-title">
      {/* body scrolls, footer stays visible (the Modal panel is a flex column / bottom sheet on phones) */}
      <div className="min-h-0 flex-1 overflow-y-auto p-5 pb-2">
        <h2 id="bulk-title" className={cn("flex items-center gap-2 text-[16px] font-semibold", meta.danger && "text-danger")}><meta.icon size={17} /> {meta.verb} {repos.length} {repos.length === 1 ? "repository" : "repositories"}</h2>
        {results ? (
          <div className="mt-3 space-y-1">
            {results.map((o) => (
              <div key={o.repo.id} className="flex items-center gap-2 text-[12.5px]">
                <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", o.ok ? "bg-ok" : "bg-danger")} />
                <span className="min-w-0 flex-1 truncate font-mono">{o.repo.fullName}</span>
                <span className="shrink-0 text-faint">{o.ok ? "done" : o.error}</span>
              </div>
            ))}
          </div>
        ) : (
          <>
            <p className="mt-2 text-[13px] text-muted">This applies to {repos.length} selected {repos.length === 1 ? "repository" : "repositories"}{meta.danger ? " and cannot be undone" : ""}.</p>
            <div className="mt-3 max-h-40 space-y-0.5 overflow-y-auto rounded-[var(--radius-control)] border border-border bg-surface-2 px-3 py-2">
              {repos.map((r) => <div key={r.id} className="truncate font-mono text-[12px] text-muted">{r.fullName}</div>)}
            </div>
            {needsType && (
              <div className="mt-3">
                <label htmlFor="bulk-confirm" className="mb-1 block text-[12px] font-medium text-muted">Type <span className="font-mono text-foreground">delete</span> to confirm</label>
                <Input id="bulk-confirm" autoFocus value={confirm} onChange={(e) => setConfirm(e.target.value)} className="focus:border-danger" />
              </div>
            )}
          </>
        )}
      </div>
      <div className="flex shrink-0 justify-end gap-2 px-5 pb-5 pt-3">
        <Button variant="ghost" onClick={onClose} disabled={busy}>{results ? "Close" : "Cancel"}</Button>
        {!results && <Button variant={meta.danger ? "danger" : "primary"} onClick={run} disabled={!ready} loading={busy}><meta.icon size={15} /> {meta.verb}</Button>}
      </div>
    </Modal>
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
      {/* The search takes its own row on phones (basis-full); filter / sort / layout form the row below. */}
      <label className="flex h-10 basis-full min-w-0 items-center gap-2 rounded-[var(--radius-control)] border border-border bg-surface px-2.5 focus-within:border-primary focus-within:ring-focus sm:h-9 sm:basis-auto sm:flex-1 sm:max-w-sm">
        <Search size={15} className="shrink-0 text-muted" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search repositories…" className="min-w-0 flex-1 self-stretch bg-transparent text-base outline-none placeholder:text-faint sm:text-[13px]" />
        {query && <button onClick={() => setQuery("")} className="-mr-1 grid h-8 w-8 shrink-0 place-items-center rounded-full text-faint hover:bg-surface-2 hover:text-foreground" aria-label="Clear"><X size={14} /></button>}
      </label>

      <Menu align="start" width={190} trigger={({ toggle, ref }) => (
        <button ref={ref} onClick={toggle} className={cn("pressable inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-control)] border px-2.5 text-[13px] hover:bg-surface-2 [@media(pointer:coarse)]:h-10", prefs.filter !== "all" ? "border-primary text-primary" : "border-border text-muted")}><Filter size={15} /> {FILTERS.find((f) => f.k === prefs.filter)?.label}</button>
      )}>
        <MenuLabel>Filter</MenuLabel>
        {FILTERS.map((f) => <MenuItem key={f.k} icon={prefs.filter === f.k ? Check : undefined} onClick={() => setFilter(f.k)}>{f.label}</MenuItem>)}
      </Menu>

      <Menu align="end" width={190} trigger={({ toggle, ref }) => (
        <button ref={ref} onClick={toggle} className="pressable inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-control)] border border-border px-2.5 text-[13px] text-muted hover:bg-surface-2 [@media(pointer:coarse)]:h-10"><ArrowUpDown size={15} /> {SORTS.find((s) => s.k === prefs.sort)?.label}</button>
      )}>
        <MenuLabel>Sort by</MenuLabel>
        {SORTS.map((s) => <MenuItem key={s.k} icon={prefs.sort === s.k ? Check : undefined} onClick={() => setSort(s.k)}>{s.label}</MenuItem>)}
      </Menu>

      <div className="ml-auto flex items-center rounded-[var(--radius-control)] border border-border p-0.5 sm:ml-0">
        <button onClick={() => setLayout("grid")} className={cn("pressable grid h-8 w-8 place-items-center rounded-[6px] [@media(pointer:coarse)]:h-9 [@media(pointer:coarse)]:w-10", prefs.layout === "grid" ? "bg-surface-2 text-foreground" : "text-muted")} aria-label="Grid"><LayoutGrid size={15} /></button>
        <button onClick={() => setLayout("list")} className={cn("pressable grid h-8 w-8 place-items-center rounded-[6px] [@media(pointer:coarse)]:h-9 [@media(pointer:coarse)]:w-10", prefs.layout === "list" ? "bg-surface-2 text-foreground" : "text-muted")} aria-label="List"><ListIcon size={15} /></button>
      </div>
    </div>
  );
}

function VisBadge({ repo }: { repo: RepoSummary }) {
  return (
    <Badge className="shrink-0">
      {repo.private ? <Lock size={10} /> : <Globe size={10} />} {repo.private ? "Private" : "Public"}
    </Badge>
  );
}

function RepoMeta({ repo }: { repo: RepoSummary }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted">
      {repo.language && <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-faint" /> {repo.language}</span>}
      {repo.stars > 0 && <span className="inline-flex items-center gap-1"><Star size={12} /> {repo.stars.toLocaleString()}</span>}
      {repo.forks > 0 && <span className="inline-flex items-center gap-1"><GitFork size={12} /> {repo.forks.toLocaleString()}</span>}
      {repo.pushedAt && <span className="inline-flex items-center gap-1"><Clock size={12} /> {ago(repo.pushedAt)}</span>}
    </div>
  );
}

function RepoCard({ repo, index, onOpen, selectMode, selected }: { repo: RepoSummary; index: number; onOpen: () => void; selectMode?: boolean; selected?: boolean }) {
  return (
    <button onClick={onOpen} style={revealStyle(index)} className={cn("card-hover pressable flex h-full flex-col gap-2 rounded-[var(--radius-card)] border bg-surface p-4 text-left", revealClass(index), selected ? "border-primary ring-2 ring-primary/40" : "border-border")}>
      <div className="flex items-center gap-2">
        {selectMode && (selected ? <CheckSquare size={16} className="shrink-0 text-primary" /> : <Square size={16} className="shrink-0 text-faint" />)}
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

function RepoRow({ repo, index, onOpen, selectMode, selected }: { repo: RepoSummary; index: number; onOpen: () => void; selectMode?: boolean; selected?: boolean }) {
  return (
    <button onClick={onOpen} style={revealStyle(index)} className={cn("pressable flex w-full items-center gap-3 border-b border-border px-4 py-3 text-left last:border-0 hover:bg-surface-2 active:bg-surface-2", revealClass(index), selected && "bg-primary-soft/40")}>
      {selectMode && (selected ? <CheckSquare size={16} className="shrink-0 text-primary" /> : <Square size={16} className="shrink-0 text-faint" />)}
      <GitHubMark size={16} className="shrink-0 text-muted" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13.5px] font-semibold">{repo.name}</span>
          {repo.archived && <Archive size={12} className="shrink-0 text-warn" />}
          <VisBadge repo={repo} />
        </div>
        {repo.description && <p className="mt-0.5 truncate text-[12px] text-muted">{repo.description}</p>}
        {/* phones get the meta line under the description; wider screens keep it as a trailing column */}
        <div className="mt-1 sm:hidden"><RepoMeta repo={repo} /></div>
      </div>
      <div className="hidden sm:block"><RepoMeta repo={repo} /></div>
      <ChevronRight size={16} className="shrink-0 text-faint" />
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
  const { owner = "", repo = "", tab: tabParam } = useParams();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<RepoDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // The active tab lives in the URL (/github/:owner/:repo/:tab) so it bookmarks and survives refresh.
  const tab: Tab = (TABS.some((t) => t.k === tabParam) ? tabParam : "overview") as Tab;
  const goTab = (k: Tab) => navigate(k === "overview" ? `/github/${owner}/${repo}` : `/github/${owner}/${repo}/${k}`);

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

  if (loading) return <PageSkeleton variant="detail" />;
  if (error || !detail) {
    return <Gate compact title="Repository unavailable" body={error ?? "Not found."} action={<Button variant="outline" onClick={() => navigate("/github")}><ArrowLeft size={15} /> Back to repositories</Button>} />;
  }

  return (
    <div className="w-full space-y-4">
      <Button variant="ghost" size="sm" className="-ml-2" onClick={() => navigate("/github")}><ArrowLeft size={15} /> All repositories</Button>

      {/* header */}
      <header className="rounded-[var(--radius-card)] border border-border bg-surface px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary"><GitHubMark size={20} /></span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <a href={detail.htmlUrl} target="_blank" rel="noreferrer noopener" className="min-w-0 max-w-full truncate py-0.5 text-lg font-semibold hover:text-primary">{detail.owner}/{detail.name}</a>
              <VisBadge repo={detail} />
              {detail.archived && <Badge tone="warn" className="shrink-0"><Archive size={10} /> Archived</Badge>}
              {detail.fork && <Badge className="shrink-0"><GitFork size={10} /> Fork</Badge>}
            </div>
            {detail.description && <p className="mt-1 text-[13px] text-muted">{detail.description}</p>}
            <div className="mt-2"><RepoMeta repo={detail} /></div>
          </div>
          {/* phones: the actions drop under the description as one equal-width row; sm+: trailing group */}
          <div className="grid w-full min-w-0 auto-cols-fr grid-flow-col gap-2 sm:flex sm:w-auto sm:shrink-0 sm:items-center">
            <a href={detail.htmlUrl} target="_blank" rel="noreferrer noopener" className="min-w-0"><Button variant="outline" size="sm" className="w-full sm:w-auto"><ExternalLink size={14} /> Open</Button></a>
            {detail.canPush && <Button variant="secondary" size="sm" className="min-w-0 px-2 sm:px-3" onClick={() => navigate(`/github/${detail.owner}/${detail.name}/upload`)}><Upload size={14} className="shrink-0" /> <span className="sm:hidden">Upload</span><span className="hidden sm:inline">Upload folder</span></Button>}
            {detail.canAdmin && <Button variant="ghost" size="sm" className="border-border sm:border-transparent" onClick={() => navigate(`/github/${detail.owner}/${detail.name}/settings`)}><Settings2 size={14} /> Settings</Button>}
          </div>
        </div>
      </header>

      <TabStrip tab={tab} onChange={goTab} />

      <FadeSwap k={tab}>
        {tab === "overview" ? <OverviewTab repo={detail} /> : <ListTab repo={detail} tab={tab} />}
      </FadeSwap>
    </div>
  );
}

/** Horizontal tab strip. On phones only ~3 tabs fit: the active one is scrolled into view (deep links to
 *  /pulls or /actions) and a right-edge fade signals there is more until the strip is scrolled to its end. */
function TabStrip({ tab, onChange }: { tab: Tab; onChange: (k: Tab) => void }) {
  const stripRef = useRef<HTMLDivElement>(null);
  const [atEnd, setAtEnd] = useState(true);
  const syncEnd = useCallback(() => {
    const el = stripRef.current;
    if (el) setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 2);
  }, []);
  useEffect(() => {
    stripRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ inline: "nearest", block: "nearest" });
    syncEnd();
  }, [tab, syncEnd]);

  return (
    <div className="relative">
      <div ref={stripRef} role="tablist" onScroll={syncEnd} className="flex snap-x gap-1 overflow-x-auto rounded-[var(--radius-card)] border border-border bg-surface p-1 [scrollbar-width:none]">
        {TABS.map(({ k, label, icon: Icon }) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            onClick={() => onChange(k)}
            className={cn(
              "pressable inline-flex shrink-0 snap-start items-center gap-1.5 rounded-[var(--radius-control)] px-3 py-1.5 text-[13px] font-medium transition-colors [@media(pointer:coarse)]:min-h-10",
              tab === k ? "bg-primary-soft text-primary" : "text-muted hover:bg-surface-2 hover:text-foreground",
            )}
          >
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>
      <span aria-hidden className={cn("pointer-events-none absolute inset-y-px right-px w-10 rounded-r-[var(--radius-card)] bg-gradient-to-l from-surface to-transparent transition-opacity", atEnd && "opacity-0")} />
    </div>
  );
}

function OverviewTab({ repo }: { repo: RepoDetail }) {
  const navigate = useNavigate();
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
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2 text-[13px] font-semibold">
          <span className="flex items-center gap-2"><Book size={15} className="text-muted" /> README</span>
          {repo.canPush && <Button variant="ghost" size="sm" onClick={() => navigate(`/github/${repo.owner}/${repo.name}/edit?path=README.md`)}><Pencil size={13} /> {readme ? "Edit" : "Add"}</Button>}
        </div>
        <div className="px-5 py-4">
          {loading ? <SkeletonText lines={6} /> : readme ? <Markdown>{readme}</Markdown> : <p className="text-[13px] text-muted">This repository has no README. <button onClick={() => navigate(`/github/${repo.owner}/${repo.name}/edit?path=README.md`)} className="font-medium text-primary hover:underline">Add one</button>.</p>}
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
          {repo.homepage && <a href={repo.homepage} target="_blank" rel="noreferrer noopener" className="mt-1.5 inline-flex min-h-8 max-w-full items-center gap-1 text-[12.5px] text-primary hover:underline"><Globe size={13} className="shrink-0" /> <span className="truncate">{repo.homepage.replace(/^https?:\/\//, "")}</span></a>}
        </div>
        {repo.topics.length > 0 && (
          <div className="rounded-[var(--radius-card)] border border-border bg-surface p-4">
            <div className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-faint">Topics</div>
            <div className="flex flex-wrap gap-1.5">
              {repo.topics.map((t) => <Badge key={t} tone="primary">{t}</Badge>)}
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

  const meta = TABS.find((t) => t.k === tab)!;
  if (loading) {
    return (
      <div className="space-y-2" role="status" aria-busy="true" aria-label="Loading">
        {Array.from({ length: 5 }, (_, i) => <SkeletonRow key={i} avatar={false} />)}
      </div>
    );
  }
  if (error) return <div className="rounded-[var(--radius-card)] border border-danger/40 bg-danger-soft px-4 py-6 text-center text-[13px] text-danger">{error}</div>;
  if (!rows || rows.length === 0) return <EmptyState size="sm" icon={meta.icon} title="Nothing here yet" description={`This repository has no ${meta.label.toLowerCase()}.`} />;

  const rowCls = "pressable flex items-center gap-3 border-b border-border px-4 py-2.5 last:border-0 hover:bg-surface-2 active:bg-surface-2";
  const subCls = "text-[12px] text-muted";
  return (
    <div className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
      {tab === "commits" && (rows as CommitLite[]).map((c) => (
        <a key={c.sha} href={c.htmlUrl} target="_blank" rel="noreferrer noopener" className={cn(rowCls, "items-start")}>
          <GitCommit size={15} className="mt-0.5 shrink-0 text-muted" />
          {/* two lines so conventional-commit prefixes don't eat the whole visible subject on phones */}
          <div className="min-w-0 flex-1"><div className="line-clamp-2 break-words text-[13px] font-medium">{c.message.split("\n")[0]}</div><div className={subCls}>{c.authorLogin ?? c.authorName ?? "unknown"} · {c.date ? ago(c.date) : ""} · <span className="font-mono text-[11.5px]">{c.sha.slice(0, 7)}</span></div></div>
          <ExternalLink size={14} className="mt-0.5 shrink-0 text-faint" />
        </a>
      ))}
      {tab === "branches" && (rows as BranchLite[]).map((b) => (
        <div key={b.name} className="flex items-center gap-3 border-b border-border px-4 py-2.5 last:border-0">
          <GitBranch size={15} className="shrink-0 text-muted" />
          <span className="flex min-w-0 flex-1 items-center gap-2 font-mono text-[13px]"><span className="min-w-0 truncate">{b.name}</span>{b.name === repo.defaultBranch && <Badge tone="primary" className="font-sans">default</Badge>}</span>
          {b.protected && <Badge className="shrink-0">protected</Badge>}
          <span className="shrink-0 font-mono text-[11.5px] text-faint">{b.commitSha.slice(0, 7)}</span>
        </div>
      ))}
      {tab === "releases" && (rows as ReleaseLite[]).map((r) => (
        <a key={r.id} href={r.htmlUrl} target="_blank" rel="noreferrer noopener" className={rowCls}>
          <Tag size={15} className="shrink-0 text-muted" />
          <div className="min-w-0 flex-1"><div className="truncate text-[13px] font-medium">{r.name || r.tag}</div><div className={subCls}><span className="font-mono">{r.tag}</span> · {r.publishedAt ? ago(r.publishedAt) : "unpublished"}</div></div>
          {r.draft && <Badge className="shrink-0">draft</Badge>}
          {r.prerelease && <Badge tone="warn" className="shrink-0">pre-release</Badge>}
        </a>
      ))}
      {tab === "issues" && (rows as IssueLite[]).map((i) => (
        <a key={i.number} href={i.htmlUrl} target="_blank" rel="noreferrer noopener" className={rowCls}>
          <CircleDot size={15} className="shrink-0 text-ok" />
          <div className="min-w-0 flex-1"><div className="truncate text-[13px] font-medium">{i.title}</div><div className={subCls}>#{i.number} · {i.authorLogin ?? "unknown"} · {i.createdAt ? ago(i.createdAt) : ""}</div></div>
          {i.comments > 0 && <span className="shrink-0 text-[12px] text-muted">{i.comments} 💬</span>}
        </a>
      ))}
      {tab === "pulls" && (rows as PullLite[]).map((p) => (
        <a key={p.number} href={p.htmlUrl} target="_blank" rel="noreferrer noopener" className={rowCls}>
          <GitPullRequest size={15} className={cn("shrink-0", p.draft ? "text-muted" : "text-ok")} />
          <div className="min-w-0 flex-1"><div className="truncate text-[13px] font-medium">{p.title}</div><div className={cn(subCls, "[overflow-wrap:anywhere]")}>#{p.number} · {p.authorLogin ?? "unknown"} · <span className="font-mono">{p.head}→{p.base}</span></div></div>
          {p.draft && <Badge className="shrink-0">draft</Badge>}
        </a>
      ))}
      {tab === "actions" && (rows as WorkflowRunLite[]).map((w) => (
        <a key={w.id} href={w.htmlUrl} target="_blank" rel="noreferrer noopener" className={rowCls}>
          <RunDot conclusion={w.conclusion} status={w.status} />
          <div className="min-w-0 flex-1"><div className="truncate text-[13px] font-medium">{w.name || "Workflow run"}</div><div className={cn(subCls, "[overflow-wrap:anywhere]")}>{humanize(w.event)} · <span className="font-mono">{w.branch}</span> · {w.createdAt ? ago(w.createdAt) : ""}</div></div>
          <RunBadge conclusion={w.conclusion} status={w.status} />
        </a>
      ))}
    </div>
  );
}

/** "workflow_dispatch" → "Workflow dispatch": GitHub's enum strings, made readable. */
function humanize(s?: string): string {
  if (!s) return "";
  const t = s.replace(/_/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function runTone(conclusion?: string, status?: string): "ok" | "danger" | "warn" | "neutral" {
  if (conclusion === "success") return "ok";
  if (conclusion === "failure") return "danger";
  if (status === "in_progress" || status === "queued") return "warn";
  return "neutral";
}

function RunDot({ conclusion, status }: { conclusion?: string; status?: string }) {
  const tone = { ok: "bg-ok", danger: "bg-danger", warn: "bg-warn", neutral: "bg-faint" }[runTone(conclusion, status)];
  return <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", tone)} />;
}

function RunBadge({ conclusion, status }: { conclusion?: string; status?: string }) {
  return <Badge tone={runTone(conclusion, status)} className="shrink-0">{humanize(conclusion ?? status ?? "unknown")}</Badge>;
}
