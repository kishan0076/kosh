import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Book, FileText, Github, Globe, Lock, Plus, Scale, Sparkles, Tag, X } from "lucide-react";
import { isValidRepoName, sanitizeRepoName } from "@kosh/shared";
import { useData } from "@/data/store";
import { ApiError } from "@/data/api";
import { githubV2Api, type OwnerLite } from "@/data/githubV2Api";
import { useGithubV2, ghToast } from "@/data/githubV2";
import { GITIGNORE_TEMPLATES, LICENSE_TEMPLATES } from "@/lib/githubTemplates";
import { GitHubMark } from "@/lib/icons";
import { Button, Input, Spinner, Toggle } from "@/components/ui";
import { SelectMenu } from "@/components/overlays";
import { RepoNameField, VisibilityPicker, type NameStatus } from "@/components/github/RepoForm";

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

  const [nameStatus, setNameStatus] = useState<NameStatus>("idle");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    if (!nameValid || !owner) { setNameStatus("idle"); return; }
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

  const autoInit = initReadme || !!gitignore || !!license;
  const canCreate = nameValid && nameStatus !== "taken" && nameStatus !== "checking" && !busy;

  const initFiles = useMemo(() => {
    const f: string[] = [];
    if (initReadme) f.push("README.md");
    if (gitignore) f.push(".gitignore");
    if (license) f.push("LICENSE");
    return f;
  }, [initReadme, gitignore, license]);

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
        {o.type === "org" && <span className="ml-auto rounded-full bg-surface-3 px-1.5 text-[10px] text-muted">org</span>}
      </span>
    ),
  }));

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5">
      <button onClick={() => navigate("/github")} className="inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-foreground"><ArrowLeft size={15} /> All repositories</button>

      <header className="flex items-center gap-4 rounded-[var(--radius-card)] border border-border bg-surface px-5 py-4">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary"><Plus size={22} /></span>
        <div className="min-w-0">
          <h1 className="text-xl font-semibold leading-tight">Create a new repository</h1>
          <p className="mt-0.5 text-[13px] text-muted">A repository holds your project — its code, history, issues and releases.</p>
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        {/* left: form */}
        <div className="space-y-4 rounded-[var(--radius-card)] border border-border bg-surface p-5">
          {/* owner + name */}
          <div className="grid gap-3 sm:grid-cols-[auto_1fr] sm:items-end">
            <div>
              <label className="mb-1.5 block text-[12px] font-medium text-muted">Owner</label>
              <SelectMenu value={owner} onChange={setOwner} options={ownerOptions} width={240} ariaLabel="Owner" className="w-full sm:w-[160px]" />
            </div>
            <RepoNameField value={name} onChange={setName} ownerPrefix={owner} status={nameStatus} autoFocus onEnter={create} />
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
              <span className="flex items-center gap-2 text-[13px]"><Book size={15} className="text-muted" /> Add a README</span>
              <Toggle checked={initReadme} onChange={setInitReadme} label="Add a README" />
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

          {/* advanced */}
          <button onClick={() => setShowAdvanced((v) => !v)} className="text-[12.5px] font-medium text-primary hover:underline">
            {showAdvanced ? "Hide" : "Show"} advanced options
          </button>
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

          <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
            <Button variant="ghost" onClick={() => navigate("/github")} disabled={busy}>Cancel</Button>
            <Button variant="primary" onClick={create} disabled={!canCreate}>{busy ? <Spinner size={15} /> : <Plus size={15} />} Create repository</Button>
          </div>
        </div>

        {/* right: preview */}
        <aside className="space-y-4 lg:sticky lg:top-4">
          <section className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
            <div className="border-b border-border px-4 py-3 text-[12px] font-semibold uppercase tracking-wide text-faint">You'll get</div>
            <div className="space-y-3 px-4 py-4">
              <div className="flex items-center gap-2">
                <GitHubMark size={17} className="shrink-0 text-muted" />
                <span className="min-w-0 flex-1 truncate font-mono text-[13.5px] font-semibold">{owner}/{trimmedName || <span className="text-faint">name</span>}</span>
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border px-1.5 py-0.5 text-[10.5px] text-muted">
                  {isPrivate ? <Lock size={10} /> : <Globe size={10} />} {isPrivate ? "Private" : "Public"}
                </span>
              </div>
              {description.trim() && <p className="text-[12.5px] text-muted">{description.trim()}</p>}
              <div className="rounded-[var(--radius-control)] border border-border bg-surface-2 px-2.5 py-2 font-mono text-[11.5px] text-muted">
                git clone https://github.com/{owner}/{trimmedName || "name"}.git
              </div>
              {initFiles.length > 0 ? (
                <div>
                  <div className="mb-1 text-[11.5px] text-faint">Initial files</div>
                  <div className="flex flex-wrap gap-1.5">
                    {initFiles.map((f) => <span key={f} className="inline-flex items-center gap-1 rounded-full bg-primary-soft px-2 py-0.5 font-mono text-[11px] text-primary"><Sparkles size={10} /> {f}</span>)}
                  </div>
                </div>
              ) : (
                <p className="text-[11.5px] text-faint">Created empty — you can push your first commit right away.</p>
              )}
              {topics.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {topics.map((t) => <span key={t} className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-muted">#{t}</span>)}
                </div>
              )}
            </div>
          </section>
          <p className="px-1 text-[11.5px] text-faint">Want to push an existing folder instead? Use <button onClick={() => navigate("/github/upload")} className="font-medium text-primary hover:underline">Upload a folder</button>.</p>
        </aside>
      </div>
    </div>
  );
}

/** A compact chip input for repo topics (add on Enter / comma, remove with ×). */
function TopicsInput({ topics, onChange }: { topics: string[]; onChange: (t: string[]) => void }) {
  const [draft, setDraft] = useState("");
  const add = (raw: string) => {
    const t = sanitizeRepoName(raw).toLowerCase();
    if (t && !topics.includes(t) && topics.length < 20) onChange([...topics, t]);
    setDraft("");
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-[var(--radius-control)] border border-border bg-surface px-2 py-1.5 focus-within:border-primary focus-within:ring-focus">
      {topics.map((t) => (
        <span key={t} className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-[12px] text-muted">
          #{t}
          <button onClick={() => onChange(topics.filter((x) => x !== t))} className="hover:text-danger" aria-label={`Remove ${t}`}><X size={11} /></button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") { e.preventDefault(); if (draft.trim()) add(draft); }
          else if (e.key === "Backspace" && !draft && topics.length) onChange(topics.slice(0, -1));
        }}
        onBlur={() => draft.trim() && add(draft)}
        placeholder={topics.length ? "" : "react, cli, typescript…"}
        className="min-w-[8ch] flex-1 bg-transparent px-1 py-0.5 text-[13px] outline-none placeholder:text-faint"
      />
    </div>
  );
}
