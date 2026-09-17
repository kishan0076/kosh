import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock,
  ExternalLink,
  File as FileIcon,
  FileUp,
  Folder,
  FolderPlus,
  FolderUp,
  HardDrive,
  Pause,
  Play,
  Plus,
  Plug,
  RotateCcw,
  Trash2,
  Upload,
  UploadCloud,
  X,
} from "lucide-react";
import { formatBytes } from "@kosh/shared";
import { cn } from "@/lib/cn";
import { ago } from "@/lib/time";
import { useData } from "@/data/store";
import { useUi } from "@/data/ui";
import { useDrive, type DriveItemStatus, type DriveQueueItem } from "@/data/drive";
import { driveApi } from "@/data/driveApi";
import { Button, Progress, Spinner } from "@/components/ui";

/* ── recursive folder read for drag-and-dropped folders ── */
async function readEntry(entry: FileSystemEntry, path: string, out: { file: File; relPath: string }[]): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
    out.push({ file, relPath: path + file.name });
  } else if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    // readEntries returns results in batches; keep calling until it's empty.
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
      if (!batch.length) break;
      for (const e of batch) await readEntry(e, `${path}${entry.name}/`, out);
    }
  }
}

async function filesFromDataTransfer(dt: DataTransfer): Promise<{ file: File; relPath: string }[]> {
  const items = Array.from(dt.items).filter((i) => i.kind === "file");
  const entries = items.map((i) => i.webkitGetAsEntry?.() ?? null).filter(Boolean) as FileSystemEntry[];
  if (entries.length) {
    const out: { file: File; relPath: string }[] = [];
    for (const e of entries) await readEntry(e, "", out);
    return out;
  }
  return Array.from(dt.files).map((file) => ({ file, relPath: file.name }));
}

/* ── page ── */
export function Drive() {
  const backend = useData((s) => s.backend);
  const status = useDrive((s) => s.status);
  const configured = useDrive((s) => s.configured);
  const accounts = useDrive((s) => s.accounts);
  const accountId = useDrive((s) => s.accountId);
  const init = useDrive((s) => s.init);
  const [params, setParams] = useSearchParams();
  const toast = useUi((s) => s.toast);
  const handledOAuth = useRef(false);

  useEffect(() => {
    if (backend) void init();
  }, [backend, init]);

  // Handle the OAuth return (?connected=<email> or ?error=<code>) exactly once.
  useEffect(() => {
    const connected = params.get("connected");
    const error = params.get("error");
    if (!connected && !error) return;
    if (handledOAuth.current) return; // guard against StrictMode double-invoke / pre-commit re-run
    handledOAuth.current = true;
    if (connected) {
      toast({ message: `Google account connected`, description: connected, tone: "ok" });
      void useDrive.getState().refreshAccounts();
    } else if (error) {
      const msgs: Record<string, string> = {
        state_mismatch: "The sign-in link expired. Please try connecting again.",
        no_refresh_token: "Google didn't grant offline access. Remove Kosh's access in your Google account, then reconnect.",
        connect_failed: "Couldn't connect that Google account. Please try again.",
      };
      toast({ message: "Couldn't connect Google", description: msgs[error] ?? error, tone: "danger" });
    }
    const next = new URLSearchParams(params);
    next.delete("connected");
    next.delete("error");
    setParams(next, { replace: true });
  }, [params, setParams, toast]);

  if (!backend) return <Gate icon={UploadCloud} title="Google Drive needs the backend" body="This module talks to Google through the Kosh API. Run the API and set VITE_API_URL to use it — see docs/GOOGLE_DRIVE.md." />;
  if (status === "loading") return <div className="grid min-h-[50vh] w-full place-items-center"><Spinner size={26} className="text-primary" /></div>;
  if (status === "error") return <Gate icon={AlertTriangle} title="Couldn't reach Google Drive" body="The Drive service didn't respond. Check the API is running and try again." action={<Button variant="primary" onClick={() => init()}>Retry</Button>} />;
  if (!configured) return <SetupGate />;
  if (!accountId || !accounts.length) return <ConnectGate />;

  return <Dashboard />;
}

/* ── gates ── */
function Gate({ icon: Icon, title, body, action }: { icon: typeof HardDrive; title: string; body: string; action?: ReactNode }) {
  return (
    <div className="mx-auto grid min-h-[55vh] w-full max-w-lg place-items-center">
      <div className="w-full rounded-[var(--radius-card)] border border-border bg-surface px-6 py-10 text-center">
        <span className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-primary-soft text-primary"><Icon size={26} /></span>
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="mx-auto mt-1.5 max-w-sm text-[13px] text-muted">{body}</p>
        {action && <div className="mt-5 flex justify-center">{action}</div>}
      </div>
    </div>
  );
}

function SetupGate() {
  return (
    <Gate
      icon={Plug}
      title="Connect Google Drive"
      body="Google Drive isn't configured on the server yet. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (and enable the Google Drive API in the Google Cloud console). Full steps are in docs/GOOGLE_DRIVE.md."
    />
  );
}

function ConnectGate() {
  return (
    <div className="mx-auto grid min-h-[55vh] w-full max-w-lg place-items-center">
      <div className="w-full rounded-[var(--radius-card)] border border-border bg-surface px-6 py-10 text-center">
        <span className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-primary-soft text-primary"><UploadCloud size={26} /></span>
        <h1 className="text-lg font-semibold">Connect your Google account</h1>
        <p className="mx-auto mt-1.5 max-w-sm text-[13px] text-muted">Securely sign in with Google to upload files and folders to your Drive. Kosh only stores an encrypted token — never your password.</p>
        <a href={driveApi.connectUrl()} className="mt-5 inline-block">
          <Button variant="primary"><GoogleGlyph /> Sign in with Google</Button>
        </a>
      </div>
    </div>
  );
}

function GoogleGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.9 2.4 30.5 0 24 0 14.6 0 6.4 5.4 2.6 13.2l7.9 6.1C12.4 13.1 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.1 5.3-4.6 7l7.1 5.5c4.1-3.8 6.5-9.4 6.5-16z" />
      <path fill="#FBBC05" d="M10.5 28.7c-.5-1.5-.8-3-.8-4.7s.3-3.2.8-4.7l-7.9-6.1C1 16.5 0 20.1 0 24s1 7.5 2.6 10.8l7.9-6.1z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.1-5.5c-2 1.3-4.5 2.1-8.8 2.1-6.3 0-11.6-3.6-13.5-8.8l-7.9 6.1C6.4 42.6 14.6 48 24 48z" />
    </svg>
  );
}

/* ── main dashboard ── */
function Dashboard() {
  const accounts = useDrive((s) => s.accounts);
  const accountId = useDrive((s) => s.accountId);
  const account = accounts.find((a) => a.id === accountId) ?? null;

  return (
    <div className="w-full space-y-5">
      <header className="flex flex-wrap items-center gap-4 rounded-[var(--radius-card)] border border-border bg-surface px-5 py-4">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary"><UploadCloud size={22} /></span>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold leading-tight">Google Drive</h1>
          <p className="mt-0.5 text-[13px] text-muted">Upload files and whole folders straight to your Drive — encrypted in transit, with live progress and resume.</p>
        </div>
        <AccountPicker />
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <div className="space-y-5">
          <FolderBrowser />
          <UploadZone />
          <Queue />
        </div>
        <aside className="space-y-5 lg:sticky lg:top-4">
          <StorageMeter />
          {account && <History />}
        </aside>
      </div>
    </div>
  );
}

/* ── account picker (multi-account) ── */
function AccountPicker() {
  const accounts = useDrive((s) => s.accounts);
  const accountId = useDrive((s) => s.accountId);
  const selectAccount = useDrive((s) => s.selectAccount);
  const disconnect = useDrive((s) => s.disconnect);
  const openConfirm = useUi((s) => s.openConfirm);
  const toast = useUi((s) => s.toast);
  const [open, setOpen] = useState(false);
  const account = accounts.find((a) => a.id === accountId) ?? null;

  // Close the menu on Escape while it's open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const remove = (id: string, email: string) =>
    openConfirm({
      title: "Disconnect this Google account?",
      message: `Kosh will forget its access to ${email}. Files already in Drive are untouched.`,
      confirmLabel: "Disconnect",
      onConfirm: async () => {
        try {
          await disconnect(id);
          toast({ message: "Google account disconnected", tone: "warn" });
        } catch {
          toast({ message: "Couldn't disconnect", tone: "danger" });
        }
      },
    });

  return (
    <div className="relative">
      <button onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open} className="flex items-center gap-2 rounded-full border border-border bg-surface-2 py-1.5 pl-1.5 pr-3 text-[12.5px] transition-colors hover:border-border-strong">
        {account?.picture ? <img src={account.picture} alt="" className="h-6 w-6 rounded-full" /> : <span className="grid h-6 w-6 place-items-center rounded-full bg-primary-soft text-primary"><HardDrive size={13} /></span>}
        <span className="max-w-[160px] truncate font-medium">{account?.email ?? "Select account"}</span>
        <ChevronRight size={14} className={cn("text-muted transition-transform", open && "rotate-90")} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div role="menu" aria-label="Google accounts" className="absolute right-0 z-50 mt-2 w-72 overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface shadow-lg">
            <div className="border-b border-border px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-faint">Google accounts</div>
            {accounts.map((a) => (
              <div key={a.id} className={cn("flex items-center gap-2 px-3 py-2", a.id === accountId && "bg-primary-soft/40")}>
                <button role="menuitem" onClick={() => { void selectAccount(a.id); setOpen(false); }} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                  {a.picture ? <img src={a.picture} alt="" className="h-7 w-7 rounded-full" /> : <span className="grid h-7 w-7 place-items-center rounded-full bg-primary-soft text-primary"><HardDrive size={14} /></span>}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">{a.name ?? a.email}</span>
                    <span className="block truncate text-[11px] text-muted">{a.email}</span>
                  </span>
                  {a.id === accountId && <Check size={15} className="shrink-0 text-primary" />}
                </button>
                <button onClick={() => remove(a.id, a.email)} className="shrink-0 rounded-md p-1 text-faint hover:bg-surface-2 hover:text-danger" aria-label={`Disconnect ${a.email}`}><X size={14} /></button>
              </div>
            ))}
            <a role="menuitem" href={driveApi.connectUrl()} className="flex items-center gap-2 border-t border-border px-3 py-2.5 text-[13px] font-medium text-primary hover:bg-surface-2">
              <Plus size={15} /> Add another account
            </a>
          </div>
        </>
      )}
    </div>
  );
}

/* ── destination folder browser ── */
function FolderBrowser() {
  const path = useDrive((s) => s.path);
  const folders = useDrive((s) => s.folders);
  const foldersLoading = useDrive((s) => s.foldersLoading);
  const openFolder = useDrive((s) => s.openFolder);
  const breadcrumbTo = useDrive((s) => s.breadcrumbTo);
  const makeFolder = useDrive((s) => s.makeFolder);
  const toast = useUi((s) => s.toast);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  async function create() {
    const name = newName.trim();
    if (!name) return;
    try {
      await makeFolder(name);
      toast({ message: `Folder “${name}” created`, tone: "ok" });
      setNewName("");
      setCreating(false);
    } catch {
      toast({ message: "Couldn't create folder", tone: "danger" });
    }
  }

  return (
    <section className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
        <Folder size={16} className="shrink-0 text-primary" />
        <span className="text-[13px] font-semibold">Destination</span>
        <div className="ml-1 flex min-w-0 flex-1 flex-wrap items-center gap-0.5 text-[12.5px]">
          <button onClick={() => breadcrumbTo(-1)} className="rounded px-1.5 py-0.5 font-medium hover:bg-surface-2">My Drive</button>
          {path.map((f, i) => (
            <span key={f.id} className="flex items-center gap-0.5">
              <ChevronRight size={13} className="text-faint" />
              <button onClick={() => breadcrumbTo(i)} className="max-w-[140px] truncate rounded px-1.5 py-0.5 hover:bg-surface-2">{f.name}</button>
            </span>
          ))}
        </div>
        <Button variant="ghost" size="sm" onClick={() => setCreating((v) => !v)}><FolderPlus size={14} /> New folder</Button>
      </div>

      {creating && (
        <div className="flex items-center gap-2 border-b border-border bg-surface-2 px-4 py-2.5">
          <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void create(); if (e.key === "Escape") setCreating(false); }} placeholder="Folder name" className="min-w-0 flex-1 rounded-[var(--radius-control)] border border-border bg-surface px-3 py-1.5 text-[13px] outline-none focus:border-primary focus:ring-focus" />
          <Button variant="primary" size="sm" onClick={create} disabled={!newName.trim()}>Create</Button>
          <Button variant="ghost" size="sm" onClick={() => setCreating(false)}>Cancel</Button>
        </div>
      )}

      <div className="max-h-52 overflow-y-auto p-2">
        {foldersLoading ? (
          <div className="grid place-items-center py-8 text-muted"><Spinner size={20} /></div>
        ) : folders.length === 0 ? (
          <div className="px-2 py-6 text-center text-[12.5px] text-muted">No sub-folders here. Files will upload into this folder.</div>
        ) : (
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            {folders.map((f) => (
              <button key={f.id} onClick={() => openFolder(f)} className="flex items-center gap-2 rounded-[var(--radius-control)] border border-border bg-surface-2 px-2.5 py-2 text-left transition-colors hover:border-primary hover:bg-primary-soft/40">
                <Folder size={16} className="shrink-0 text-primary" />
                <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">{f.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

/* ── upload drop zone ── */
function UploadZone() {
  const addFiles = useDrive((s) => s.addFiles);
  const checkDuplicates = useDrive((s) => s.checkDuplicates);
  const path = useDrive((s) => s.path);
  const toast = useUi((s) => s.toast);
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);

  useEffect(() => {
    const el = folderRef.current;
    if (el) {
      el.setAttribute("webkitdirectory", "");
      el.setAttribute("directory", "");
    }
  }, []);

  const dest = path.length ? path[path.length - 1]!.name : "My Drive";

  const ingest = useCallback(
    (entries: { file: File; relPath?: string }[]) => {
      if (!entries.length) return;
      addFiles(entries);
      void checkDuplicates();
      toast({ message: `Added ${entries.length} file${entries.length === 1 ? "" : "s"} to the queue`, tone: "ok" });
    },
    [addFiles, checkDuplicates, toast],
  );

  async function onDrop(e: DragEvent) {
    e.preventDefault();
    setDrag(false);
    try {
      const entries = await filesFromDataTransfer(e.dataTransfer);
      ingest(entries);
    } catch {
      toast({ message: "Couldn't read those items", tone: "danger" });
    }
  }

  return (
    <section
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={onDrop}
      className={cn("rounded-[var(--radius-card)] border-2 border-dashed bg-surface px-6 py-8 text-center transition-colors", drag ? "border-primary bg-primary-soft/40" : "border-border")}
    >
      <input ref={fileRef} type="file" multiple hidden onChange={(e) => { ingest(Array.from(e.target.files ?? []).map((file) => ({ file }))); if (fileRef.current) fileRef.current.value = ""; }} />
      <input ref={folderRef} type="file" multiple hidden onChange={(e) => { ingest(Array.from(e.target.files ?? []).map((file) => ({ file, relPath: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name }))); if (folderRef.current) folderRef.current.value = ""; }} />
      <span className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-primary-soft text-primary"><Upload size={24} /></span>
      <div className="text-[14.5px] font-semibold">Drag files or folders here</div>
      <p className="mx-auto mt-1 max-w-sm text-[12.5px] text-muted">They’ll upload into <span className="font-medium text-foreground">{dest}</span>. Bulk folders keep their structure.</p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <Button variant="primary" size="sm" onClick={() => fileRef.current?.click()}><FileUp size={15} /> Select files</Button>
        <Button variant="outline" size="sm" onClick={() => folderRef.current?.click()}><FolderUp size={15} /> Select folder</Button>
      </div>
    </section>
  );
}

/* ── upload queue + aggregate dashboard ── */
function Queue() {
  const queue = useDrive((s) => s.queue);
  const startUploads = useDrive((s) => s.startUploads);
  const retryFailed = useDrive((s) => s.retryFailed);
  const clearFinished = useDrive((s) => s.clearFinished);
  const skipDuplicates = useDrive((s) => s.skipDuplicates);

  const stats = useMemo(() => {
    const total = queue.length;
    const completed = queue.filter((i) => i.status === "completed").length;
    const failed = queue.filter((i) => i.status === "failed").length;
    const active = queue.filter((i) => i.status === "uploading").length;
    const remaining = queue.filter((i) => i.status === "queued" || i.status === "uploading" || i.status === "paused").length;
    const dups = queue.filter((i) => i.duplicate && i.status === "queued").length;
    const totalBytes = queue.reduce((a, i) => a + i.size, 0);
    const doneBytes = queue.reduce((a, i) => a + (i.status === "completed" ? i.size : i.uploaded), 0);
    return { total, completed, failed, active, remaining, dups, totalBytes, doneBytes, pct: totalBytes ? Math.round((doneBytes / totalBytes) * 100) : 0 };
  }, [queue]);

  if (!queue.length) return null;
  const canStart = queue.some((i) => i.status === "queued");

  return (
    <section className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[13.5px] font-semibold">
            Upload queue
            <span className="text-[12px] font-normal text-muted">{stats.completed}/{stats.total} done · {formatBytes(stats.doneBytes)} of {formatBytes(stats.totalBytes)}</span>
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <Progress value={stats.pct} tone={stats.failed ? "warn" : "primary"} className="max-w-xs" />
            <span className="tabular text-[11.5px] text-muted">{stats.pct}%</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {stats.failed > 0 && <Button variant="ghost" size="sm" onClick={retryFailed}><RotateCcw size={14} /> Retry failed ({stats.failed})</Button>}
          <Button variant="ghost" size="sm" onClick={clearFinished}>Clear done</Button>
          <Button variant="primary" size="sm" onClick={() => void startUploads()} disabled={!canStart}><UploadCloud size={15} /> Upload {stats.remaining > 0 ? `(${stats.remaining})` : ""}</Button>
        </div>
      </div>

      {stats.dups > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-warn/30 bg-warn-soft px-4 py-2.5 text-[12.5px]">
          <AlertTriangle size={15} className="shrink-0 text-warn" />
          <span className="min-w-0 flex-1">{stats.dups} file{stats.dups === 1 ? "" : "s"} already exist in this folder. Uploading keeps both copies.</span>
          <Button variant="ghost" size="sm" onClick={skipDuplicates}>Skip duplicates</Button>
        </div>
      )}

      <div className="max-h-[420px] divide-y divide-border overflow-y-auto">
        {queue.map((item) => <QueueRow key={item.id} item={item} />)}
      </div>
    </section>
  );
}

const STATUS_META: Record<DriveItemStatus, { label: string; tone: string }> = {
  queued: { label: "Queued", tone: "text-muted" },
  duplicate: { label: "Duplicate", tone: "text-warn" },
  uploading: { label: "Uploading", tone: "text-primary" },
  paused: { label: "Paused", tone: "text-warn" },
  completed: { label: "Done", tone: "text-ok" },
  failed: { label: "Failed", tone: "text-danger" },
  canceled: { label: "Canceled", tone: "text-faint" },
};

function QueueRow({ item }: { item: DriveQueueItem }) {
  const pauseItem = useDrive((s) => s.pauseItem);
  const resumeItem = useDrive((s) => s.resumeItem);
  const cancelItem = useDrive((s) => s.cancelItem);
  const retryItem = useDrive((s) => s.retryItem);
  const removeItem = useDrive((s) => s.removeItem);
  const meta = STATUS_META[item.status];
  const pct = item.size ? Math.round((item.uploaded / item.size) * 100) : item.status === "completed" ? 100 : 0;

  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <Thumb item={item} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{item.relPath.includes("/") ? item.relPath : item.name}</span>
          <span className={cn("shrink-0 text-[11px] font-medium", meta.tone)}>{meta.label}</span>
        </div>
        <div className="mt-1 flex items-center gap-2">
          {(item.status === "uploading" || item.status === "paused") ? (
            <>
              <Progress value={pct} tone={item.status === "paused" ? "warn" : "primary"} className="max-w-[220px]" />
              <span className="tabular shrink-0 text-[11px] text-faint">{formatBytes(item.uploaded)} / {formatBytes(item.size)}</span>
            </>
          ) : (
            <span className="text-[11.5px] text-faint">
              {formatBytes(item.size)}
              {item.duplicate && item.status === "queued" && <span className="ml-1.5 text-warn">· already in folder</span>}
              {item.error && <span className="ml-1.5 text-danger">· {item.error}</span>}
            </span>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {item.status === "uploading" && <IconBtn label="Pause" onClick={() => pauseItem(item.id)}><Pause size={15} /></IconBtn>}
        {item.status === "paused" && <IconBtn label="Resume" onClick={() => resumeItem(item.id)}><Play size={15} /></IconBtn>}
        {item.status === "failed" && <IconBtn label="Retry" onClick={() => retryItem(item.id)}><RotateCcw size={15} /></IconBtn>}
        {item.status === "completed" && item.webViewLink && (
          <a href={item.webViewLink} target="_blank" rel="noreferrer noopener" className="grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-foreground" aria-label="Open in Drive"><ExternalLink size={15} /></a>
        )}
        {(item.status === "queued" || item.status === "uploading" || item.status === "paused") ? (
          <IconBtn label="Cancel" onClick={() => cancelItem(item.id)}><X size={15} /></IconBtn>
        ) : (
          <IconBtn label="Remove" onClick={() => removeItem(item.id)}><Trash2 size={15} /></IconBtn>
        )}
      </div>
    </div>
  );
}

function IconBtn({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return <button onClick={onClick} aria-label={label} className="grid h-8 w-8 place-items-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-foreground">{children}</button>;
}

/** Inline image preview (local blob) for image files; a file-type glyph otherwise. */
function Thumb({ item }: { item: DriveQueueItem }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!item.mimeType.startsWith("image/")) return;
    const u = URL.createObjectURL(item.file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [item.file, item.mimeType]);

  const done = item.status === "completed";
  return (
    <span className="relative grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-lg bg-surface-2 text-muted">
      {url ? <img src={url} alt="" className="h-full w-full object-cover" /> : done ? <CheckCircle2 size={17} className="text-ok" /> : <FileIcon size={16} />}
    </span>
  );
}

/* ── storage usage ── */
function StorageMeter() {
  const quota = useDrive((s) => s.quota);
  if (!quota) return null;
  const hasLimit = quota.limit != null && quota.limit > 0;
  const pct = hasLimit ? Math.min(100, Math.round((quota.usage / quota.limit!) * 100)) : 0;
  return (
    <section className="rounded-[var(--radius-card)] border border-border bg-surface px-4 py-4">
      <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold"><HardDrive size={16} className="text-primary" /> Storage</div>
      {hasLimit ? (
        <>
          <Progress value={pct} tone={pct > 90 ? "danger" : pct > 75 ? "warn" : "primary"} />
          <div className="mt-2 flex items-center justify-between text-[12px] text-muted">
            <span>{formatBytes(quota.usage)} used</span>
            <span>{formatBytes(quota.limit!)} total</span>
          </div>
        </>
      ) : (
        <div className="text-[12.5px] text-muted">{formatBytes(quota.usage)} used (unlimited plan)</div>
      )}
    </section>
  );
}

/* ── upload history ── */
function History() {
  const history = useDrive((s) => s.history);
  if (!history.length) return null;
  return (
    <section className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3 text-[13px] font-semibold"><Clock size={15} className="text-primary" /> Recent uploads</div>
      <div className="max-h-80 divide-y divide-border overflow-y-auto">
        {history.slice(0, 30).map((h) => (
          <div key={h.id} className="flex items-center gap-2.5 px-4 py-2">
            {h.status === "completed" ? <CheckCircle2 size={15} className="shrink-0 text-ok" /> : <AlertTriangle size={15} className="shrink-0 text-danger" />}
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12.5px] font-medium">{h.fileName}</div>
              <div className="truncate text-[11px] text-faint">{formatBytes(h.size)} · {ago(h.createdAt)}</div>
            </div>
            {h.webViewLink && <a href={h.webViewLink} target="_blank" rel="noreferrer noopener" className="shrink-0 rounded-md p-1 text-faint hover:bg-surface-2 hover:text-foreground" aria-label="Open"><ExternalLink size={13} /></a>}
          </div>
        ))}
      </div>
    </section>
  );
}
