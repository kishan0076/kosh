import { memo, useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent, type ReactNode } from "react";
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
import { type DriveAccount } from "@/data/driveApi";
import { startConnect } from "@/lib/connect";
import { Badge, Button, Input, Progress, Skeleton } from "@/components/ui";
import { Menu, MenuItem, MenuLabel, MenuSeparator, useMenuClose } from "@/components/overlays";
import { EmptyState } from "@/components/common";
import { PageSkeleton } from "@/components/PageSkeleton";

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

// Directory picking needs `webkitdirectory`; iOS Safari claims the property but opens a plain file
// picker (or nothing), so the "Select folder" control is a dead end there and is not rendered.
const isIOS =
  typeof navigator !== "undefined" &&
  (/iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));
const canPickDir = typeof document !== "undefined" && "webkitdirectory" in document.createElement("input") && !isIOS;

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
  // Same silhouette AppShell shows for /drive while the vault hydrates, so the two loading phases don't flip shape.
  if (status === "loading") return <PageSkeleton variant="cards" />;
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
        <Button variant="primary" className="mt-5" onClick={() => { void startConnect("google", "drive"); }}><GoogleGlyph /> Sign in with Google</Button>
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
      {/* Phones: icon + copy on one row, the account pill on its own below (a 234px pill beside a flex-1
          text block squeezed the title to one word per line at 390px). */}
      <header className="flex flex-col gap-4 rounded-[var(--radius-card)] border border-border bg-surface px-4 py-4 sm:flex-row sm:items-center sm:px-5">
        <div className="flex min-w-0 flex-1 items-center gap-4">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary"><UploadCloud size={22} /></span>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold leading-tight">Google Drive</h1>
            <p className="mt-0.5 text-[13px] text-muted">Upload files and whole folders straight to your Drive — encrypted in transit, with live progress and resume.</p>
          </div>
        </div>
        <AccountPicker />
      </header>

      {/* grid-cols-1 = minmax(0,1fr): without it the implicit track sizes to the children's min-content
          (nowrap folder/file names) and the whole dashboard pans sideways inside <main> on phones. */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <div className="min-w-0 space-y-5">
          <FolderBrowser />
          <UploadZone />
          <Queue />
        </div>
        <aside className="min-w-0 space-y-5 lg:sticky lg:top-4">
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
  const account = accounts.find((a) => a.id === accountId) ?? null;

  const remove = (id: string, email: string) =>
    openConfirm({
      title: "Disconnect this Google account?",
      message: (
        <>
          Kosh will forget its access to <b className="break-all font-medium text-foreground">{email}</b>. Files already in Drive are untouched.
        </>
      ),
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
    <Menu
      align="end"
      width={288}
      trigger={({ open, toggle, ref }) => (
        <button
          ref={ref}
          onClick={toggle}
          aria-haspopup="menu"
          aria-expanded={open}
          className="flex max-w-full items-center gap-2 self-start rounded-full border border-border bg-surface-2 py-1.5 pl-1.5 pr-3 text-[13px] transition-colors hover:border-border-strong active:bg-surface-3 pressable [@media(pointer:coarse)]:min-h-10 sm:self-auto"
        >
          {account?.picture ? <img src={account.picture} alt="" referrerPolicy="no-referrer" className="h-6 w-6 rounded-full" /> : <span className="grid h-6 w-6 place-items-center rounded-full bg-primary-soft text-primary"><HardDrive size={13} /></span>}
          <span className="min-w-0 max-w-[220px] truncate font-medium sm:max-w-[160px]">{account?.email ?? "Select account"}</span>
          <ChevronRight size={14} className={cn("shrink-0 text-muted transition-transform", open && "rotate-90")} />
        </button>
      )}
    >
      <MenuLabel>Google accounts</MenuLabel>
      {accounts.map((a) => (
        <AccountRow key={a.id} account={a} active={a.id === accountId} onSelect={() => void selectAccount(a.id)} onRemove={() => remove(a.id, a.email)} />
      ))}
      <MenuSeparator />
      <MenuItem icon={Plus} onClick={() => { void startConnect("google", "drive"); }}>Add another account</MenuItem>
    </Menu>
  );
}

/** One row in the account Menu: select (auto-closes) plus a disconnect control. */
function AccountRow({ account: a, active, onSelect, onRemove }: { account: DriveAccount; active: boolean; onSelect: () => void; onRemove: () => void }) {
  const close = useMenuClose();
  return (
    <div className={cn("flex items-center gap-1 rounded-md", active && "bg-primary-soft/40")}>
      <button onClick={() => { onSelect(); close(); }} className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2.5 py-1.5 text-left transition-colors hover:bg-surface-2 active:bg-surface-3">
        {a.picture ? <img src={a.picture} alt="" referrerPolicy="no-referrer" className="h-7 w-7 rounded-full" /> : <span className="grid h-7 w-7 place-items-center rounded-full bg-primary-soft text-primary"><HardDrive size={14} /></span>}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium">{a.name ?? a.email}</span>
          <span className="block truncate text-[12px] text-muted">{a.email}</span>
        </span>
        {active && <Check size={15} className="shrink-0 text-primary" />}
      </button>
      {/* A full 40px target: the destructive ✕ used to be 22px, 4px from the select button's right edge. */}
      <button onClick={() => { close(); onRemove(); }} className="grid h-10 w-10 shrink-0 place-items-center rounded-md text-faint transition-colors hover:bg-danger-soft hover:text-danger active:bg-danger-soft active:text-danger" aria-label={`Disconnect ${a.email}`}><X size={15} /></button>
    </div>
  );
}

/* ── destination folder browser ── */
function FolderBrowser() {
  const path = useDrive((s) => s.path);
  const folders = useDrive((s) => s.folders);
  const foldersLoading = useDrive((s) => s.foldersLoading);
  const foldersError = useDrive((s) => s.foldersError);
  const openFolder = useDrive((s) => s.openFolder);
  const breadcrumbTo = useDrive((s) => s.breadcrumbTo);
  const loadFolders = useDrive((s) => s.loadFolders);
  const makeFolder = useDrive((s) => s.makeFolder);
  const toast = useUi((s) => s.toast);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const crumbsRef = useRef<HTMLDivElement>(null);

  // The crumb row scrolls sideways on phones; keep the current folder (the last crumb) in view.
  useEffect(() => {
    const el = crumbsRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [path]);

  async function create() {
    const name = newName.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      await makeFolder(name);
      toast({ message: `Folder “${name}” created`, tone: "ok" });
      setNewName("");
      setCreating(false);
    } catch {
      toast({ message: "Couldn't create folder", tone: "danger" });
    } finally {
      setBusy(false);
    }
  }

  const crumb = "min-h-8 shrink-0 rounded px-2 hover:bg-surface-2 active:bg-surface-3 [@media(pointer:coarse)]:min-h-10";

  return (
    <section className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
        <Folder size={16} className="shrink-0 text-primary" />
        <span className="text-[13px] font-semibold">Destination</span>
        {/* Phones: the breadcrumb takes its own horizontally-scrolling row under the title; ≥sm it sits
            inline between the title and the button and wraps like before. */}
        <div
          ref={crumbsRef}
          className="order-last flex basis-full items-center gap-0.5 overflow-x-auto whitespace-nowrap py-0.5 text-[13px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:order-none sm:ml-1 sm:min-w-0 sm:flex-1 sm:basis-0 sm:flex-wrap sm:overflow-visible sm:whitespace-normal"
        >
          <button onClick={() => breadcrumbTo(-1)} aria-current={path.length === 0 ? "location" : undefined} className={cn(crumb, "font-medium")}>My Drive</button>
          {path.map((f, i) => (
            <span key={f.id} className="flex shrink-0 items-center gap-0.5">
              <ChevronRight size={13} className="shrink-0 text-faint" />
              <button onClick={() => breadcrumbTo(i)} aria-current={i === path.length - 1 ? "location" : undefined} className={cn(crumb, "max-w-[45vw] truncate sm:max-w-[140px]")}>{f.name}</button>
            </span>
          ))}
        </div>
        <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setCreating((v) => !v)}><FolderPlus size={14} /> New folder</Button>
      </div>

      {creating && (
        <div className="flex items-center gap-2 border-b border-border bg-surface-2 px-4 py-2.5">
          <Input
            autoFocus
            enterKeyHint="done"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void create(); if (e.key === "Escape") setCreating(false); }}
            placeholder="Folder name"
            className="min-w-0 flex-1 [@media(pointer:coarse)]:h-10"
          />
          <Button variant="primary" onClick={create} loading={busy} disabled={!newName.trim()}>Create</Button>
          <Button variant="ghost" onClick={() => setCreating(false)}>Cancel</Button>
        </div>
      )}

      {/* No inner scroller on phones (a finger in the box scrolled the list instead of the page). */}
      <div className="max-h-none overflow-y-auto p-2 sm:max-h-52">
        {foldersLoading ? (
          <FolderSkeleton />
        ) : foldersError ? (
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 px-2 py-4 text-center text-[13px]">
            <span className="text-danger">Couldn't list folders. {foldersError}</span>
            <Button variant="ghost" size="sm" onClick={() => void loadFolders()}><RotateCcw size={14} /> Retry</Button>
          </div>
        ) : folders.length === 0 ? (
          <div className="px-2 py-6 text-center text-[13px] text-muted">No sub-folders here. Files will upload into this folder.</div>
        ) : (
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            {folders.map((f) => (
              <button key={f.id} onClick={() => openFolder(f)} className="flex min-h-10 cursor-pointer items-center gap-2 rounded-[var(--radius-control)] border border-border bg-surface-2 px-2.5 py-2 text-left transition-colors hover:border-primary hover:bg-primary-soft/40 active:border-primary active:bg-primary-soft/60 pressable">
                <Folder size={16} className="shrink-0 text-primary" />
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{f.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

/** Six folder-cell silhouettes in the real grid, at the real 40px cell height (no jump on swap). */
function FolderSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading folders" className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="flex h-10 items-center gap-2 rounded-[var(--radius-control)] border border-border bg-surface-2 px-2.5">
          <Skeleton className="h-4 w-4 shrink-0 rounded" />
          <Skeleton className={cn("h-3", i % 3 === 1 ? "w-4/5" : "w-3/5")} />
        </div>
      ))}
    </div>
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

  // The whole card opens the file picker (there is no drag on a phone); the buttons stay the
  // keyboard-reachable controls, so a click that started on one of them is theirs alone.
  function onZoneClick(e: MouseEvent<HTMLElement>) {
    if ((e.target as HTMLElement).closest("button, input, a")) return;
    fileRef.current?.click();
  }

  return (
    <section
      onClick={onZoneClick}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={onDrop}
      className={cn("cursor-pointer rounded-[var(--radius-card)] border-2 border-dashed bg-surface px-4 py-8 text-center transition-colors active:bg-surface-2 pressable sm:px-6", drag ? "border-primary bg-primary-soft/40" : "border-border")}
    >
      <input ref={fileRef} type="file" multiple hidden onChange={(e) => { ingest(Array.from(e.target.files ?? []).map((file) => ({ file }))); if (fileRef.current) fileRef.current.value = ""; }} />
      <input ref={folderRef} type="file" multiple hidden onChange={(e) => { ingest(Array.from(e.target.files ?? []).map((file) => ({ file, relPath: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name }))); if (folderRef.current) folderRef.current.value = ""; }} />
      <span className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-primary-soft text-primary"><Upload size={24} /></span>
      <div className="text-[14.5px] font-semibold">
        <span className="sm:hidden">Tap to add files</span>
        <span className="hidden sm:inline">Drag files or folders here</span>
      </div>
      <p className="mx-auto mt-1 max-w-sm text-[13px] text-muted">They’ll upload into <span className="font-medium text-foreground">{dest}</span>.{canPickDir && " Bulk folders keep their structure."}</p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <Button variant="primary" onClick={() => fileRef.current?.click()}><FileUp size={15} /> Select files</Button>
        {canPickDir && <Button variant="outline" onClick={() => folderRef.current?.click()}><FolderUp size={15} /> Select folder</Button>}
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
      {/* Phones stack: stats + full-width progress, then one action row with the primary CTA right-aligned. */}
      <div className="flex flex-col gap-3 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:gap-x-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 text-[13.5px] font-semibold">
            Upload queue
            <span className="text-[12px] font-normal text-muted">{stats.completed}/{stats.total} done · {formatBytes(stats.doneBytes)} of {formatBytes(stats.totalBytes)}</span>
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <Progress value={stats.pct} tone={stats.failed ? "warn" : "primary"} className="sm:max-w-xs" />
            <span className="tabular shrink-0 text-[12.5px] text-muted">{stats.pct}%</span>
          </div>
        </div>
        <div className="flex w-full flex-wrap items-center gap-1.5 sm:w-auto">
          {stats.failed > 0 && <Button variant="ghost" size="sm" onClick={retryFailed}><RotateCcw size={14} /> Retry failed ({stats.failed})</Button>}
          <Button variant="ghost" size="sm" onClick={clearFinished}>Clear done</Button>
          <Button variant="primary" size="sm" className="ml-auto sm:ml-0" onClick={() => void startUploads()} disabled={!canStart}><UploadCloud size={15} /> Upload {stats.remaining > 0 ? `(${stats.remaining})` : ""}</Button>
        </div>
      </div>

      {stats.dups > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-warn/30 bg-warn-soft px-4 py-2.5 text-[13px]">
          <AlertTriangle size={15} className="shrink-0 text-warn" />
          <span className="min-w-0 flex-1">{stats.dups} file{stats.dups === 1 ? "" : "s"} already exist in this folder. Uploading keeps both copies.</span>
          <Button variant="ghost" size="sm" className="ml-auto" onClick={skipDuplicates}>Skip duplicates</Button>
        </div>
      )}

      {/* The page scrolls on phones; the box only caps its height where it shares the viewport with the aside. */}
      <div className="max-h-none divide-y divide-border overflow-y-auto lg:max-h-[420px]">
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

// Memoized: a progress tick patches one item (the others keep their reference), so only that row
// re-renders instead of the whole list. `.reveal-in` runs once on mount — rows are prepended when
// enqueued and keyed by id, so later patches never replay it.
const QueueRow = memo(function QueueRow({ item }: { item: DriveQueueItem }) {
  const pauseItem = useDrive((s) => s.pauseItem);
  const resumeItem = useDrive((s) => s.resumeItem);
  const cancelItem = useDrive((s) => s.cancelItem);
  const retryItem = useDrive((s) => s.retryItem);
  const removeItem = useDrive((s) => s.removeItem);
  const meta = STATUS_META[item.status];
  const pct = item.size ? Math.round((item.uploaded / item.size) * 100) : item.status === "completed" ? 100 : 0;
  const inFlight = item.status === "uploading" || item.status === "paused";
  const name = item.relPath.includes("/") ? item.relPath : item.name;

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 reveal-in">
      <Thumb item={item} />
      <div className="min-w-0 flex-1">
        {/* The name owns the full width (two lines max); status moved into the meta row below. */}
        <div className="line-clamp-2 break-all text-[13px] font-medium leading-snug" title={name}>{name}</div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
          <span className={cn("font-medium", meta.tone)}>{meta.label}</span>
          {inFlight ? (
            <>
              {/* Inline between status and bytes with room (≥sm); on phones it drops to its own full-width line. */}
              <Progress value={pct} tone={item.status === "paused" ? "warn" : "primary"} className="order-last basis-full sm:order-none sm:w-40 sm:basis-auto" />
              <span className="tabular text-muted">{formatBytes(item.uploaded)} / {formatBytes(item.size)}</span>
            </>
          ) : (
            <span className="tabular text-[12.5px] text-muted">{formatBytes(item.size)}</span>
          )}
          {item.duplicate && item.status === "queued" && <Badge tone="warn">Already in folder</Badge>}
        </div>
        {item.error && <div className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-danger" title={item.error}>{item.error}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {/* Only the session/offset request is network-bound: Resume/Retry re-queue optimistically, then
            the Pause slot spins until Google answers. Pause itself aborts the chunk at once. */}
        {item.status === "uploading" && <IconBtn label="Pause" loading={item.sessionPending} onClick={() => pauseItem(item.id)}><Pause size={15} /></IconBtn>}
        {item.status === "paused" && <IconBtn label="Resume" onClick={() => resumeItem(item.id)}><Play size={15} /></IconBtn>}
        {item.status === "failed" && <IconBtn label="Retry" onClick={() => retryItem(item.id)}><RotateCcw size={15} /></IconBtn>}
        {item.status === "completed" && item.webViewLink && (
          <a href={item.webViewLink} target="_blank" rel="noreferrer noopener" className="grid h-8 w-8 place-items-center rounded-[var(--radius-control)] text-muted transition-colors hover:bg-surface-2 hover:text-foreground active:bg-surface-3 pressable [@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:w-10" aria-label="Open in Drive"><ExternalLink size={15} /></a>
        )}
        {(item.status === "queued" || item.status === "uploading" || item.status === "paused") ? (
          <IconBtn label="Cancel" onClick={() => cancelItem(item.id)}><X size={15} /></IconBtn>
        ) : (
          <IconBtn label="Remove" onClick={() => removeItem(item.id)}><Trash2 size={15} /></IconBtn>
        )}
      </div>
    </div>
  );
});

function IconBtn({ label, onClick, loading, children }: { label: string; onClick: () => void; loading?: boolean; children: ReactNode }) {
  return <Button variant="ghost" size="icon-sm" aria-label={label} loading={loading} onClick={onClick}>{children}</Button>;
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
  const loaded = useDrive((s) => s.quotaLoaded);
  if (loaded && !quota) return null;
  const hasLimit = !!quota && quota.limit != null && quota.limit > 0;
  const pct = quota && hasLimit ? Math.min(100, Math.round((quota.usage / quota.limit!) * 100)) : 0;
  return (
    <section className="rounded-[var(--radius-card)] border border-border bg-surface px-4 py-4">
      <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold"><HardDrive size={16} className="text-primary" /> Storage</div>
      {!quota ? (
        // Same bar + two-figure footprint as the loaded card, so the aside doesn't grow in steps.
        <div role="status" aria-busy="true" aria-label="Loading storage">
          <Skeleton className="h-1.5 w-full rounded-full" />
          <div className="mt-2 flex items-center justify-between">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-3 w-16" />
          </div>
        </div>
      ) : hasLimit ? (
        <div className="reveal-in">
          <Progress value={pct} tone={pct > 90 ? "danger" : pct > 75 ? "warn" : "primary"} />
          <div className="mt-2 flex items-center justify-between text-[12px] text-muted">
            <span className="tabular">{formatBytes(quota.usage)} used</span>
            <span className="tabular">{formatBytes(quota.limit!)} total</span>
          </div>
        </div>
      ) : (
        <div className="text-[13px] text-muted reveal-in"><span className="tabular">{formatBytes(quota.usage)}</span> used (unlimited plan)</div>
      )}
    </section>
  );
}

/* ── upload history ── */
function History() {
  const history = useDrive((s) => s.history);
  const loaded = useDrive((s) => s.historyLoaded);
  return (
    <section className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3 text-[13px] font-semibold"><Clock size={15} className="text-primary" /> Recent uploads</div>
      {!loaded ? (
        <div role="status" aria-busy="true" aria-label="Loading uploads" className="divide-y divide-border">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="flex h-[52px] items-center gap-2.5 px-4">
              <Skeleton className="h-4 w-4 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <Skeleton className={cn("h-3", i % 2 ? "w-1/2" : "w-3/4")} />
                <Skeleton className="h-2.5 w-1/3" />
              </div>
            </div>
          ))}
        </div>
      ) : history.length === 0 ? (
        <div className="p-3">
          <EmptyState size="sm" icon={Clock} title="No uploads yet" description="Files you upload appear here." />
        </div>
      ) : (
        <div className="max-h-none divide-y divide-border overflow-y-auto reveal-in lg:max-h-80">
          {history.slice(0, 30).map((h) => (
            <div key={h.id} className="flex min-h-[52px] items-center gap-2.5 px-4 py-1.5">
              {h.status === "completed" ? <CheckCircle2 size={15} className="shrink-0 text-ok" /> : <AlertTriangle size={15} className="shrink-0 text-danger" />}
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium" title={h.fileName}>{h.fileName}</div>
                <div className="truncate text-[12px] text-muted"><span className="tabular">{formatBytes(h.size)}</span> · {ago(h.createdAt)}</div>
              </div>
              {h.webViewLink && (
                <a href={h.webViewLink} target="_blank" rel="noreferrer noopener" className="-mr-2 grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius-control)] text-muted transition-colors hover:bg-surface-2 hover:text-foreground active:bg-surface-3 pressable" aria-label="Open in Drive"><ExternalLink size={16} /></a>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
