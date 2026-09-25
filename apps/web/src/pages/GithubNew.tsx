import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Book, ChevronDown, FileCode2, FileText, FolderUp, Github, Globe, Lock, Plus, RefreshCw, Scale, Sparkles, Tag } from "lucide-react";
import { formatBytes, isValidRepoName } from "@kosh/shared";
import { cn } from "@/lib/cn";
import { useData } from "@/data/store";
import { ApiError } from "@/data/api";
import { githubV2Api, type OwnerLite } from "@/data/githubV2Api";
import { useGithubV2, ghToast } from "@/data/githubV2";
import { GITIGNORE_TEMPLATES, LICENSE_TEMPLATES } from "@/lib/githubTemplates";
import { readFolderPlan, readDropPlan, type LoadedRepoFile } from "@/lib/repoFolder";
import { GitHubMark } from "@/lib/icons";
import { Badge, Button, Input, Spinner, Toggle } from "@/components/ui";
import { SelectMenu } from "@/components/overlays";
import { Collapse } from "@/components/motion";
import { GitScanCard } from "@/components/github/GitScanCard";
import { RepoNameField, SecretFindings, TopicsInput, VisibilityPicker, type NameStatus, type SecretFinding } from "@/components/github/RepoForm";

/**
 * Dedicated "New repository" page (replaces the cramped create modal). Exposes the full create surface
 * the API already supports — owner/org, .gitignore + license templates, homepage, topics — with a live
 * name-availability check and a sticky preview of what will be created.
 */
export function GithubNew() {
  const navigate = useNavigate();
  const user = useData((s) => s.user);
  const fallbackLogin = user.github?.login ?? user.login;

  const [owners, setOwners] = useState<OwnerLite[]>([]);
  const [owner, setOwner] = useState<string>(fallbackLogin);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isPrivate, setIsPrivate] = useState(true);

  const [initReadme, setInitReadme] = useState(true);
  const [gitignore, setGitignore] = useState("");
  const [license, setLicense] = useState("");
  const [homepage, setHomepage] = useState("");
  const [topics, setTopics] = useState<string[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Optional: seed the new repo from a local folder (folds in the old /publish flow).
  const seedInputRef = useRef<HTMLInputElement>(null);
  const [showSeed, setShowSeed] = useState(false);
  const [seedFiles, setSeedFiles] = useState<LoadedRepoFile[]>([]);
  const [seedFolder, setSeedFolder] = useState("");
  const [seedFindings, setSeedFindings] = useState<SecretFinding[]>([]);
  const [seedConfirm, setSeedConfirm] = useState(false);
  const [seedReading, setSeedReading] = useState(false);
  const [seedDrag, setSeedDrag] = useState(false);

  const [nameStatus, setNameStatus] = useState<NameStatus>("idle");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Under lg the "You'll get" preview sits above the form as a one-line strip; this expands it.
  const [previewOpen, setPreviewOpen] = useState(false);

  useEffect(() => {
    const el = seedInputRef.current;
    if (el) { el.setAttribute("webkitdirectory", ""); el.setAttribute("directory", ""); }
  }, [showSeed]);

  async function seedIngest(plan: Awaited<ReturnType<typeof readFolderPlan>>) {
    setSeedFolder(plan.topFolder);
    setSeedFiles(plan.files);
    setSeedFindings(plan.findings);
    setSeedConfirm(false);
  }
  async function onSeedPick(list: FileList | null) {
    if (!list || list.length === 0) return;
    setSeedReading(true);
    try { await seedIngest(await readFolderPlan(list)); } catch { /* ignore */ }
    finally { setSeedReading(false); if (seedInputRef.current) seedInputRef.current.value = ""; }
  }
  async function onSeedDrop(e: React.DragEvent) {
    e.preventDefault(); setSeedDrag(false);
    if (!e.dataTransfer.items.length) return;
    setSeedReading(true);
    try { await seedIngest(await readDropPlan(e.dataTransfer)); } catch { /* ignore */ }
    finally { setSeedReading(false); }
  }
  const seedBytes = useMemo(() => seedFiles.reduce((a, f) => a + f.size, 0), [seedFiles]);

  // Load possible owners (user + orgs). Degrade to the connected login if the call fails (sandbox proxy).
  useEffect(() => {
    let live = true;
    githubV2Api
      .owners()
      .then(({ owners }) => {
        if (!live || owners.length === 0) return;
        setOwners(owners);
        setOwner((cur) => (owners.some((o) => o.login === cur) ? cur : owners[0]!.login));
      })
      .catch(() => {
        if (live) setOwners([{ login: fallbackLogin, type: "user" }]);
      });
    return () => { live = false; };
  }, [fallbackLogin]);

  const trimmedName = name.trim();
  const nameValid = isValidRepoName(trimmedName);

  // Debounced availability check.
  const seq = useRef(0);
  useEffect(() => {
    if (!nameValid || !owner) { ++seq.current; setNameStatus("idle"); return; } // invalidate any in-flight check
    const mine = ++seq.current;
    setNameStatus("checking");
    const t = setTimeout(() => {
      githubV2Api
        .nameAvailable(owner, trimmedName)
        .then((r) => { if (seq.current === mine) setNameStatus(r.invalid ? "idle" : r.available ? "available" : "taken"); })
        .catch(() => { if (seq.current === mine) setNameStatus("idle"); });
    }, 450);
    return () => clearTimeout(t);
  }, [trimmedName, nameValid, owner]);

  // GitHub's auto_init always adds a README, so choosing a template forces a README on.
  const readmeForced = !!gitignore || !!license;
  const autoInit = initReadme || readmeForced;
  const seedBlocked = seedFiles.length > 0 && seedFindings.length > 0 && !seedConfirm;
  const canCreate = nameValid && nameStatus !== "taken" && nameStatus !== "checking" && !busy && !seedBlocked;

  const initFiles = useMemo(() => {
    const f: string[] = [];
    if (initReadme || readmeForced) f.push("README.md");
    if (gitignore) f.push(".gitignore");
    if (license) f.push("LICENSE");
    return f;
  }, [initReadme, readmeForced, gitignore, license]);

  async function create() {
    if (!canCreate) return;
    setBusy(true);
    setError(null);
    const isOrg = owners.find((o) => o.login === owner)?.type === "org";
    try {
      const { repo } = await githubV2Api.createRepo({
        name: trimmedName,
        description: description.trim() || undefined,
        private: isPrivate,
        autoInit,
        gitignoreTemplate: gitignore || undefined,
        licenseTemplate: license || undefined,
        homepage: homepage.trim() || undefined,
        org: isOrg ? owner : undefined,
      });
      // Topics are a best-effort follow-up patch — never let them fail the create.
      if (topics.length > 0) {
        try {
          const { topics: saved } = await githubV2Api.setTopics(repo.owner, repo.name, topics);
          repo.topics = saved;
        } catch { /* non-fatal */ }
      }
      // Optional seed: push the picked folder as the first content commit.
      if (seedFiles.length > 0) {
        try {
          await githubV2Api.pushFiles(repo.owner, repo.name, {
            files: seedFiles.map((f) => ({ path: f.path, content: f.content, encoding: f.encoding })),
            message: `Add ${seedFolder} contents`,
            branch: repo.defaultBranch,
            allowSecrets: seedConfirm,
          });
        } catch {
          ghToast(`${repo.fullName} created, but pushing the folder failed — upload it from the repo.`, "warn");
        }
      }
      useGithubV2.getState().upsertRepo(repo);
      ghToast(`Created ${repo.fullName}`, "ok");
      navigate(`/github/${repo.owner}/${repo.name}`);
    } catch (err) {
      if (err instanceof ApiError && err.code === "REPO_NAME_TAKEN") {
        setNameStatus("taken");
        setError(`You already have a repo named "${trimmedName}". Pick a different name.`);
      } else {
        setError(err instanceof ApiError ? err.message : "Couldn't create the repository.");
      }
      setBusy(false);
    }
  }

  const ownerOptions = (owners.length ? owners : [{ login: owner, type: "user" as const }]).map((o) => ({
    value: o.login,
    label: (
      <span className="flex items-center gap-2">
        {o.avatarUrl ? <img src={o.avatarUrl} alt="" referrerPolicy="no-referrer" className="h-4 w-4 rounded-full" /> : <Github size={13} className="text-muted" />}
        <span className="truncate">{o.login}</span>
        {o.type === "org" && <span className="ml-auto rounded-full bg-surface-3 px-1.5 text-[11px] text-muted">org</span>}
      </span>
    ),
  }));

  // The preview body is rendered once for lg+ (always open) and once inside the phone Collapse.
  const preview = (
    <div className="space-y-3 px-4 py-4">
      <div className="flex items-center gap-2">
        <GitHubMark size={17} className="shrink-0 text-muted" />
        <span className="min-w-0 flex-1 truncate font-mono text-[13.5px] font-semibold">{owner}/{trimmedName || <span className="text-faint">name</span>}</span>
        <Badge className="shrink-0">{isPrivate ? <Lock size={10} /> : <Globe size={10} />} {isPrivate ? "Private" : "Public"}</Badge>
      </div>
      {description.trim() && <p className="text-[12.5px] text-muted">{description.trim()}</p>}
      <div className="break-all rounded-[var(--radius-control)] border border-border bg-surface-2 px-2.5 py-2 font-mono text-[12px] text-muted">
        git clone https://github.com/{owner}/{trimmedName || "name"}.git
      </div>
      {initFiles.length > 0 ? (
        <div>
          <div className="mb-1 text-[12px] text-faint">Initial files</div>
          <div className="flex flex-wrap gap-1.5">
            {initFiles.map((f) => <Badge key={f} tone="primary" className="font-mono"><Sparkles size={10} /> {f}</Badge>)}
          </div>
        </div>
      ) : (
        <p className="text-[12px] text-faint">Created empty — you can push your first commit right away.</p>
      )}
      {topics.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {topics.map((t) => <Badge key={t}>#{t}</Badge>)}
        </div>
      )}
    </div>
  );
  const previewSummary = `${owner}/${trimmedName || "name"} · ${isPrivate ? "Private" : "Public"}${initFiles.length ? ` · ${initFiles.join(", ")}` : " · empty"}`;

  return (
    <div className="w-full space-y-5">
      <Button variant="ghost" size="sm" className="-ml-2" onClick={() => navigate("/github")}><ArrowLeft size={15} /> All repositories</Button>

      <header className="flex items-center gap-4 rounded-[var(--radius-card)] border border-border bg-surface px-4 py-4 sm:px-5">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary"><Plus size={22} /></span>
        <div className="min-w-0">
          <h1 className="text-xl font-semibold leading-tight">Create a new repository</h1>
          <p className="mt-0.5 text-[13px] text-muted">A repository holds your project — its code, history, issues and releases.</p>
        </div>
      </header>

      {/* minmax(0,1fr) so intrinsic widths (a long org login, the clone URL) can't size the column past the phone */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        {/* left: form */}
        <div className="min-w-0 space-y-4 rounded-[var(--radius-card)] border border-border bg-surface p-5">
          {/* owner + name */}
          <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-end">
            <div className="min-w-0">
              <label className="mb-1.5 block text-[12px] font-medium text-muted">Owner</label>
              <SelectMenu value={owner} onChange={setOwner} options={ownerOptions} width={240} ariaLabel="Owner" className="w-full sm:w-[160px]" />
            </div>
            <div className="min-w-0">
              <RepoNameField value={name} onChange={setName} ownerPrefix={owner} status={nameStatus} autoFocus onEnter={create} />
            </div>
          </div>

          <div>
            <label htmlFor="nr-desc" className="mb-1.5 block text-[12px] font-medium text-muted">Description <span className="text-faint">(optional)</span></label>
            <Input id="nr-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What is this project?" />
          </div>

          <div>
            <span className="mb-1.5 block text-[12px] font-medium text-muted">Visibility</span>
            <VisibilityPicker isPrivate={isPrivate} onChange={setIsPrivate} />
          </div>

          {/* initialize */}
          <div className="rounded-[var(--radius-control)] border border-border bg-surface-2 p-3.5">
            <div className="mb-2.5 text-[12px] font-semibold uppercase tracking-wide text-faint">Initialize this repository</div>
            <div className="flex items-center justify-between gap-3">
              <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px]"><Book size={15} className="text-muted" /> Add a README {readmeForced && <span className="text-[12px] text-faint">(added automatically with a template)</span>}</span>
              <Toggle checked={initReadme || readmeForced} onChange={setInitReadme} disabled={readmeForced} label="Add a README" />
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 flex items-center gap-1.5 text-[12px] font-medium text-muted"><FileText size={13} /> .gitignore template</label>
                <SelectMenu value={gitignore} onChange={setGitignore} options={GITIGNORE_TEMPLATES} width={240} ariaLabel=".gitignore template" className="w-full" />
              </div>
              <div>
                <label className="mb-1.5 flex items-center gap-1.5 text-[12px] font-medium text-muted"><Scale size={13} /> License</label>
                <SelectMenu value={license} onChange={setLicense} options={LICENSE_TEMPLATES} width={260} ariaLabel="License" className="w-full" />
              </div>
            </div>
          </div>

          {/* seed from a folder (folds in the old /publish flow) */}
          <div className="rounded-[var(--radius-control)] border border-border bg-surface-2 p-3.5">
            <label className="flex cursor-pointer items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-[13px]"><FolderUp size={15} className="text-muted" /> Start from a folder <span className="text-faint">(optional)</span></span>
              <Toggle checked={showSeed} onChange={(on) => { setShowSeed(on); if (!on) { setSeedFiles([]); setSeedFolder(""); setSeedFindings([]); } }} label="Start from a folder" />
            </label>
            {showSeed && (
              <div className="mt-3 space-y-3">
                <p className="text-[12px] text-muted">Push a local project as the repository's first commit. Build files, dependencies and secrets are filtered out in your browser.</p>
                <input ref={seedInputRef} type="file" multiple hidden onChange={(e) => onSeedPick(e.target.files)} />
                <GitScanCard />
                {seedFiles.length === 0 ? (
                  <button
                    type="button"
                    onClick={() => seedInputRef.current?.click()}
                    onDragOver={(e) => { e.preventDefault(); setSeedDrag(true); }}
                    onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setSeedDrag(false); }}
                    onDrop={onSeedDrop}
                    disabled={seedReading}
                    className={cn("flex min-h-[120px] w-full flex-col items-center justify-center gap-2 rounded-[var(--radius-control)] border-2 border-dashed px-4 py-6 text-center transition-colors", seedDrag ? "border-primary bg-primary-soft/50" : "border-border hover:border-primary hover:bg-primary-soft/20")}
                  >
                    <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary-soft text-primary">{seedReading ? <Spinner size={18} /> : <FolderUp size={20} />}</span>
                    <span className="text-[13px] font-medium">{seedReading ? "Reading folder…" : "Drop a folder, or choose one"}</span>
                    {/* phone browsers can't pick a whole folder — say so instead of letting the tap silently fail */}
                    <span className="text-[12.5px] text-muted [@media(pointer:fine)]:hidden">Folder upload works best in a desktop browser.</span>
                  </button>
                ) : (
                  <div className="overflow-hidden rounded-[var(--radius-control)] border border-border">
                    <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-[12.5px]">
                      <FileCode2 size={15} className="shrink-0 text-primary" />
                      <span className="min-w-0 flex-1 truncate font-medium">{seedFolder}</span>
                      <span className="text-faint">{seedFiles.length} file{seedFiles.length === 1 ? "" : "s"} · {formatBytes(seedBytes)}</span>
                      <Button variant="ghost" size="sm" onClick={() => seedInputRef.current?.click()}><RefreshCw size={13} /> Change</Button>
                    </div>
                    <div className="max-h-40 overflow-y-auto">
                      {seedFiles.slice(0, 200).map((f) => (
                        <div key={f.path} className="flex items-center gap-2 border-b border-border px-3 py-1 font-mono text-[12px] last:border-0">
                          <span className="min-w-0 flex-1 truncate">{f.path}</span>
                          <span className="shrink-0 text-faint">{formatBytes(f.size)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <SecretFindings findings={seedFindings} confirmed={seedConfirm} onConfirm={setSeedConfirm} confirmLabel="I've reviewed these and want to push anyway" />
              </div>
            )}
          </div>

          {/* advanced */}
          <Button variant="ghost" size="sm" className="-ml-3 text-primary" onClick={() => setShowAdvanced((v) => !v)}>
            {showAdvanced ? "Hide" : "Show"} advanced options
          </Button>
          {showAdvanced && (
            <div className="space-y-4 border-t border-border pt-4">
              <div>
                <label htmlFor="nr-home" className="mb-1.5 flex items-center gap-1.5 text-[12px] font-medium text-muted"><Globe size={13} /> Homepage <span className="text-faint">(optional)</span></label>
                <Input id="nr-home" value={homepage} onChange={(e) => setHomepage(e.target.value)} placeholder="https://…" />
              </div>
              <div>
                <label className="mb-1.5 flex items-center gap-1.5 text-[12px] font-medium text-muted"><Tag size={13} /> Topics <span className="text-faint">(optional)</span></label>
                <TopicsInput topics={topics} onChange={setTopics} />
              </div>
            </div>
          )}

          {error && <div className="rounded-[var(--radius-control)] border border-danger/40 bg-danger-soft px-3 py-2 text-[12.5px] text-danger">{error}</div>}

          {/* Sticky on phones so Create stays reachable under the seed/advanced sections and the keyboard. */}
          <div className="sticky bottom-0 z-10 -mx-5 -mb-5 flex items-center justify-end gap-2 rounded-b-[var(--radius-card)] border-t border-border bg-surface px-5 pb-[calc(0.75rem+var(--safe-bottom))] pt-3 lg:static lg:mx-0 lg:mb-0 lg:rounded-none lg:px-0 lg:pb-0 lg:pt-4">
            <Button variant="ghost" onClick={() => navigate("/github")} disabled={busy}>Cancel</Button>
            <Button variant="primary" className="flex-1 sm:flex-none" onClick={create} disabled={!canCreate} loading={busy}><Plus size={15} /> Create repository</Button>
          </div>
        </div>

        {/* right: preview — first (a collapsed strip) on phones, a sticky card on lg+ */}
        <aside className="order-first min-w-0 space-y-4 lg:order-none lg:sticky lg:top-4">
          <section className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
            <button type="button" onClick={() => setPreviewOpen((v) => !v)} aria-expanded={previewOpen} className="pressable flex min-h-11 w-full items-center gap-2 px-4 py-2.5 text-left lg:hidden">
              <span className="shrink-0 text-[12px] font-semibold uppercase tracking-wide text-faint">You'll get</span>
              <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-muted">{previewSummary}</span>
              <ChevronDown size={15} className={cn("shrink-0 text-faint transition-transform", previewOpen && "rotate-180")} />
            </button>
            <div className="hidden border-b border-border px-4 py-3 text-[12px] font-semibold uppercase tracking-wide text-faint lg:block">You'll get</div>
            <div className="hidden lg:block">{preview}</div>
            <Collapse open={previewOpen} className="lg:hidden"><div className="border-t border-border">{preview}</div></Collapse>
          </section>
          <p className="px-1 text-[12px] text-faint">Want to push an existing folder instead? Use <button onClick={() => navigate("/github/upload")} className="-my-2 inline-block py-2 font-medium text-primary hover:underline">Upload a folder</button>.</p>
        </aside>
      </div>
    </div>
  );
}
