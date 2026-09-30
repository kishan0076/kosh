import { useMemo, useState, type ReactNode } from "react";
import {
  Archive,
  ArrowLeft,
  CheckCircle2,
  Copy,
  File as FileIcon,
  FileSpreadsheet,
  FileText,
  Film,
  Folder,
  FolderInput,
  FolderPlus,
  Image as ImageIcon,
  Link2,
  Music,
  RefreshCw,
  Sparkles,
  TriangleAlert,
  X,
} from "lucide-react";
import {
  buildCopyPlan,
  DEST_ROOT,
  driveKindOf,
  formatBytes,
  parseDriveLinks,
  type CollisionStrategy,
  type DupStatus,
  type FileDecision,
  type PlanCopy,
  type ScanFolderLite,
} from "@kosh/shared";
import { cn } from "@/lib/cn";
import { revealClass, revealStyle } from "@/lib/motion";
import { Button, Input, Spinner, Textarea, Toggle } from "@/components/ui";
import { EmptyState } from "@/components/common";
import { useUi } from "@/data/ui";
import { ApiError } from "@/data/api";
import { driveV2Api, type ImportFile, type ImportScanResult } from "@/data/driveV2Api";
import { useDriveV2 } from "@/data/driveV2";

/* ── small presentation helpers ── */

const kindIcon = (mimeType?: string, isFolder = false) => {
  if (isFolder) return Folder;
  switch (driveKindOf({ mimeType })) {
    case "image":
      return ImageIcon;
    case "video":
      return Film;
    case "audio":
      return Music;
    case "sheet":
      return FileSpreadsheet;
    case "pdf":
    case "doc":
    case "slide":
      return FileText;
    case "archive":
      return Archive;
    default:
      return FileIcon;
  }
};

const STATUS_BADGE: Record<DupStatus, { label: string; cls: string }> = {
  new: { label: "New", cls: "bg-ok-soft text-ok" },
  dupInDest: { label: "In Drive", cls: "bg-warn-soft text-warn" },
  dupInSource: { label: "Repeated", cls: "bg-info-soft text-info" },
};

const STRATEGIES: { k: CollisionStrategy; label: string; hint: string }[] = [
  { k: "skip", label: "Skip", hint: "Don't re-import duplicates" },
  { k: "copy", label: "Copy anyway", hint: "Import duplicates too" },
  { k: "rename", label: "Keep both", hint: "Import with “(copy)” added" },
];

// The order a duplicate's per-file decision cycles through when its pill is clicked.
const DECISION_CYCLE: FileDecision[] = ["skip", "copy", "rename"];
const DECISION_LABEL: Record<FileDecision, string> = { skip: "Skip", copy: "Copy", rename: "Keep both" };

const MAX_ROWS = 300; // cap the DOM — the import still processes every scanned file

// Drive throttles bulk writes (429 / 403 rate-limit → the API maps both to 502) and occasionally 5xx.
// Those responses mean the write never applied, so retrying with backoff is safe and is standard for bulk
// copy. NEEDS_RECONNECT (400) and per-item 403/404 are NOT retried.
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
async function withRetry<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i === attempts - 1 || !(err instanceof ApiError) || !RETRYABLE_STATUS.has(err.status ?? 0)) throw err;
      await new Promise((r) => setTimeout(r, Math.min(500 * 2 ** i, 4000)));
    }
  }
  throw lastErr;
}

// Guards against two import runs sharing the global bulkOp/counters — the panel can be closed mid-import
// (the async loop keeps running) and reopened, which would otherwise let a second run start concurrently.
let importRunning = false;

type Phase = "input" | "scanning" | "review" | "running" | "done";

interface ImportResult {
  copied: number;
  failed: number;
  skipped: number;
  folders: number;
  destName: string;
}

export function ImportPanel({ onClose }: { onClose: () => void }) {
  const accountId = useDriveV2((s) => s.accountId)!;
  const spaceId = useDriveV2((s) => s.spaceId);
  const spaceName = useDriveV2((s) => s.spaceName);
  const path = useDriveV2((s) => s.path);
  const loadQuota = useDriveV2((s) => s.loadQuota);
  const toast = useUi((s) => s.toast);

  const currentFolderId = path.at(-1)?.id ?? spaceId ?? "root";
  const currentFolderName = path.at(-1)?.name ?? spaceName ?? "My Drive";

  const [phase, setPhase] = useState<Phase>("input");
  const [linksText, setLinksText] = useState("");
  const [scanError, setScanError] = useState<string | null>(null);
  const [scan, setScan] = useState<ImportScanResult | null>(null);

  const [strategy, setStrategy] = useState<CollisionStrategy>("skip");
  const [overrides, setOverrides] = useState<Record<string, FileDecision>>({});
  const [intoNewFolder, setIntoNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");

  const [result, setResult] = useState<ImportResult | null>(null);

  // Live "N links detected" as the user types (pure, no network).
  const parsedCount = useMemo(() => parseDriveLinks(linksText).length, [linksText]);

  const destName = intoNewFolder && newFolderName.trim() ? newFolderName.trim() : currentFolderName;

  const plan = useMemo(() => {
    if (!scan) return null;
    return buildCopyPlan({ tree: scan.tree, dedup: scan.dedup, strategy, overrides });
  }, [scan, strategy, overrides]);

  const copyBySource = useMemo(() => new Map<string, PlanCopy>((plan?.copies ?? []).map((c) => [c.sourceId, c])), [plan]);

  const folderById = useMemo(() => new Map<string, ScanFolderLite>((scan?.tree.folders ?? []).map((f) => [f.id, f])), [scan]);
  const folderPathLabel = (parentId?: string): string => {
    if (!parentId) return destName;
    const parts: string[] = [];
    let cur = folderById.get(parentId);
    let guard = 0;
    while (cur && guard++ < 60) {
      parts.unshift(cur.name);
      cur = cur.parentId ? folderById.get(cur.parentId) : undefined;
    }
    return parts.length ? parts.join(" / ") : destName;
  };

  // Group scanned files by their folder path for the preview list.
  const groups = useMemo(() => {
    if (!scan) return [] as { path: string; files: ImportFile[] }[];
    const byPath = new Map<string, { path: string; files: ImportFile[] }>();
    for (const f of scan.tree.files) {
      const p = folderPathLabel(f.parentId);
      let g = byPath.get(p);
      if (!g) byPath.set(p, (g = { path: p, files: [] }));
      g.files.push(f);
    }
    return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scan, destName]);

  async function runScan() {
    const links = parseDriveLinks(linksText).map((r) => r.raw);
    if (!links.length) {
      setScanError("Paste at least one Google Drive link or file/folder id.");
      return;
    }
    setPhase("scanning");
    setScanError(null);
    try {
      const res = await driveV2Api.importScan(accountId, links, { driveId: spaceId ?? undefined });
      setScan(res);
      setStrategy("skip");
      setOverrides({});
      // Prefill the "new folder" name from the single folder root, if that's what was pasted.
      const rootFolder = res.refs.find((r) => r.ok && r.kind === "folder");
      setNewFolderName(res.refs.filter((r) => r.ok).length === 1 && rootFolder?.name ? rootFolder.name : "Imported from Drive");
      setPhase("review");
    } catch (err) {
      setPhase("input");
      if (err instanceof ApiError && err.code === "NEEDS_RECONNECT") {
        setScanError("Your Google account needs to be reconnected to scan links.");
      } else {
        setScanError(err instanceof ApiError ? err.message : "Couldn't scan those links. Check that the account can open them.");
      }
    }
  }

  function cycleDecision(file: ImportFile) {
    const status = scan?.dedup.statusById[file.id] ?? "new";
    if (status === "new") return; // new files are always copied — nothing to cycle
    const current = copyBySource.get(file.id)?.decision ?? strategy;
    const next = DECISION_CYCLE[(DECISION_CYCLE.indexOf(current) + 1) % DECISION_CYCLE.length]!;
    setOverrides((o) => ({ ...o, [file.id]: next }));
  }

  async function runImport() {
    if (!plan) return;
    // Never let a second import share the global bulkOp/counters with one already running (the panel can be
    // closed mid-import and reopened, which mounts a fresh panel over the still-running loop).
    if (importRunning) {
      toast({ message: "An import is already running — wait for it to finish.", tone: "warn" });
      return;
    }
    const total = plan.folders.length + plan.stats.filesToCopy;
    if (total === 0) {
      toast({ message: "Nothing to import — every file was skipped.", tone: "warn" });
      return;
    }
    importRunning = true;
    setPhase("running");
    useDriveV2.setState({ bulkOp: { label: "Importing from Drive", total, done: 0 } });
    const bump = () => useDriveV2.setState((s) => (s.bulkOp ? { bulkOp: { ...s.bulkOp, done: s.bulkOp.done + 1 } } : {}));
    let reconnect = false;

    // 1) Resolve the destination root — optionally a freshly created folder under the current one.
    const refMap = new Map<string, string | null>();
    let destRootId = currentFolderId;
    try {
      if (intoNewFolder && newFolderName.trim()) {
        const { file } = await withRetry(() => driveV2Api.createFolder(accountId, { name: newFolderName.trim(), parentId: currentFolderId }));
        destRootId = file.id;
      }
    } catch (err) {
      importRunning = false;
      useDriveV2.setState({ bulkOp: null });
      setPhase("review");
      toast({ message: err instanceof ApiError ? err.message : "Couldn't create the destination folder.", tone: "danger" });
      return;
    }
    refMap.set(DEST_ROOT, destRootId);

    // 2) Recreate folders in dependency order (parents first) so every child has a real parent id. Each
    //    create is retried on transient throttling so one 429/5xx doesn't cascade to fail a whole subtree.
    let foldersMade = 0;
    for (const f of plan.folders) {
      const parent = refMap.get(f.parentRef);
      if (!parent) {
        refMap.set(f.ref, null); // an ancestor failed → this whole subtree can't be placed
        bump();
        continue;
      }
      try {
        const { file } = await withRetry(() => driveV2Api.createFolder(accountId, { name: f.name, parentId: parent }));
        refMap.set(f.ref, file.id);
        foldersMade++;
      } catch (err) {
        refMap.set(f.ref, null);
        if (err instanceof ApiError && err.code === "NEEDS_RECONNECT") reconnect = true;
      }
      bump();
    }

    // 3) Copy files into their (now-created) parents — bounded concurrency, per-file failures don't abort;
    //    each copy is retried on transient throttling. Once a genuine reconnect is seen, drain the rest fast
    //    (mark failed without hammering Drive) instead of firing every remaining request.
    const toCopy = plan.copies.filter((c) => !c.skipped);
    let copied = 0;
    let failed = 0;
    const LIMIT = 4;
    let i = 0;
    const worker = async () => {
      while (i < toCopy.length) {
        const c = toCopy[i++]!;
        const parent = refMap.get(c.parentRef);
        if (!parent || reconnect) {
          failed++;
          bump();
          continue;
        }
        try {
          await withRetry(() => driveV2Api.copy(accountId, c.sourceId, { name: c.name, parents: [parent] }));
          copied++;
        } catch (err) {
          failed++;
          if (err instanceof ApiError && err.code === "NEEDS_RECONNECT") reconnect = true;
        }
        bump();
      }
    };
    await Promise.all(Array.from({ length: Math.min(LIMIT, toCopy.length) }, worker));

    importRunning = false;
    useDriveV2.setState({ bulkOp: null });
    useDriveV2.getState().invalidateViews(); // the destination folder must refetch to show the new items
    void loadQuota();
    setResult({ copied, failed, skipped: plan.stats.filesSkipped, folders: foldersMade, destName });
    setPhase("done");
    if (reconnect) {
      toast({ message: "Some items failed — your Google account may need reconnecting.", tone: "danger" });
    } else {
      toast({
        message: `Imported ${copied} file${copied === 1 ? "" : "s"}${plan.stats.filesSkipped ? `, skipped ${plan.stats.filesSkipped} duplicate${plan.stats.filesSkipped === 1 ? "" : "s"}` : ""}`,
        tone: failed ? "warn" : "ok",
      });
    }
  }

  function reset() {
    setPhase("input");
    setScan(null);
    setResult(null);
    setScanError(null);
    setOverrides({});
    setIntoNewFolder(false);
  }

  const failedRefs = scan?.refs.filter((r) => !r.ok) ?? [];

  return (
    <div className="flex flex-col overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface lg:h-full">
      {/* header */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary"><FolderInput size={17} /></span>
        <div className="min-w-0">
          <div className="text-[14px] font-semibold leading-tight">Import from Drive</div>
          <div className="truncate text-[11.5px] text-muted">Scan any Drive links, skip duplicates, copy into {currentFolderName}</div>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onClose} className="ml-auto" aria-label="Close import"><X size={16} /></Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {/* ── input ── */}
        {(phase === "input" || phase === "scanning") && (
          <div className="mx-auto max-w-2xl space-y-4">
            <div className="rounded-[var(--radius-card)] border border-border bg-surface-2 p-4">
              <label htmlFor="import-links" className="mb-1.5 flex items-center gap-1.5 text-[13px] font-medium">
                <Link2 size={14} className="text-muted" /> Google Drive links
              </label>
              <Textarea
                id="import-links"
                value={linksText}
                onChange={(e) => setLinksText(e.target.value)}
                disabled={phase === "scanning"}
                rows={6}
                placeholder={"Paste one or more links or ids, one per line — e.g.\nhttps://drive.google.com/drive/folders/…\nhttps://drive.google.com/file/d/…/view"}
                className="font-mono text-[12.5px]"
              />
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="text-[12px] text-muted">
                  {parsedCount > 0 ? `${parsedCount} link${parsedCount === 1 ? "" : "s"} detected` : "Folders are scanned recursively — everything inside comes too."}
                </span>
                <Button variant="primary" size="sm" className="ml-auto" disabled={parsedCount === 0} loading={phase === "scanning"} onClick={() => void runScan()}>
                  <Sparkles size={15} /> {phase === "scanning" ? "Scanning…" : "Scan links"}
                </Button>
              </div>
              {scanError && <p className="mt-2 text-[12.5px] text-danger">{scanError}</p>}
            </div>

            <ul className="grid gap-2 text-[12.5px] text-muted sm:grid-cols-3">
              <HowItWorks icon={FolderInput} title="Recursive scan" body="Whole folder trees, files and subfolders." />
              <HowItWorks icon={Copy} title="Duplicate-aware" body="Flags what's already in your Drive." />
              <HowItWorks icon={CheckCircle2} title="Same names" body="Copies keep their original names & structure." />
            </ul>
          </div>
        )}

        {/* ── review ── */}
        {phase === "review" && scan && plan && (
          <div className="mx-auto max-w-3xl space-y-4">
            {scan.summary.fileCount === 0 ? (
              <EmptyState
                size="sm"
                icon={FolderInput}
                title="Nothing to import"
                description={failedRefs.length ? "None of the pasted links could be opened with this account." : "The links you pasted contain no files."}
                action={<Button variant="outline" size="sm" onClick={reset}><ArrowLeft size={14} /> Back</Button>}
              />
            ) : (
              <>
                {/* stats */}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Stat label="Files found" value={scan.summary.fileCount.toLocaleString()} />
                  <Stat label="Total size" value={formatBytes(scan.summary.totalBytes)} />
                  <Stat label="New" value={scan.dedup.counts.new.toLocaleString()} tone="ok" />
                  <Stat label="Duplicates" value={(scan.dedup.counts.dupInDest + scan.dedup.counts.dupInSource).toLocaleString()} tone={scan.dedup.counts.dupInDest + scan.dedup.counts.dupInSource > 0 ? "warn" : undefined} />
                </div>

                {(scan.sourceTruncated || scan.destTruncated || failedRefs.length > 0) && (
                  <div className="space-y-2">
                    {scan.sourceTruncated && <Notice tone="warn">This is a very large set — only the first {scan.summary.fileCount.toLocaleString()} files were scanned.</Notice>}
                    {scan.destTruncated && <Notice tone="warn">Your Drive is large, so the duplicate check sampled part of it — a few duplicates might slip through.</Notice>}
                    {failedRefs.length > 0 && (
                      <Notice tone="danger">
                        {failedRefs.length} link{failedRefs.length === 1 ? "" : "s"} couldn't be opened:{" "}
                        <span className="break-all">{failedRefs.map((r) => r.raw).join(", ")}</span>
                      </Notice>
                    )}
                  </div>
                )}

                {/* duplicate strategy */}
                {scan.dedup.counts.dupInDest + scan.dedup.counts.dupInSource > 0 && (
                  <div className="rounded-[var(--radius-control)] border border-border bg-surface-2 p-3">
                    <div className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-faint">Duplicates</div>
                    <div className="flex flex-wrap gap-1.5">
                      {STRATEGIES.map((s) => (
                        <button
                          key={s.k}
                          onClick={() => { setStrategy(s.k); setOverrides({}); }}
                          title={s.hint}
                          className={cn(
                            "pressable inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-control)] border px-3 text-[13px] font-medium [@media(pointer:coarse)]:h-10",
                            strategy === s.k ? "border-primary bg-primary-soft text-primary" : "border-border text-muted hover:bg-surface-3",
                          )}
                        >
                          {s.label}
                        </button>
                      ))}
                      <span className="ml-auto self-center text-[11.5px] text-muted">{STRATEGIES.find((s) => s.k === strategy)?.hint}. Click a badge below to change one file.</span>
                    </div>
                  </div>
                )}

                {/* destination */}
                <div className="rounded-[var(--radius-control)] border border-border bg-surface-2 p-3">
                  <div className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-faint">Destination</div>
                  <div className="flex items-center gap-2 text-[13px]">
                    <Toggle checked={intoNewFolder} onChange={setIntoNewFolder} label="Create a new folder for this import" />
                    <span className="text-muted">Create a new folder for this import</span>
                  </div>
                  {intoNewFolder ? (
                    <div className="mt-2">
                      <div className="flex items-center gap-2">
                        <FolderPlus size={15} className="shrink-0 text-muted" />
                        <Input aria-label="New folder name" value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)} placeholder="New folder name" maxLength={255} className="max-w-xs" aria-invalid={!newFolderName.trim()} />
                        <span className="truncate text-[12px] text-muted">in {currentFolderName}</span>
                      </div>
                      {!newFolderName.trim() && <p className="mt-1 text-[11.5px] text-danger">Enter a folder name, or turn this off to import into {currentFolderName}.</p>}
                    </div>
                  ) : (
                    <p className="mt-1.5 flex items-center gap-1.5 text-[12.5px] text-muted"><Folder size={14} /> Files import directly into <span className="font-medium text-foreground">{currentFolderName}</span></p>
                  )}
                </div>

                {/* file preview */}
                <FilePreview groups={groups} scan={scan} copyBySource={copyBySource} onCycle={cycleDecision} />
              </>
            )}
          </div>
        )}

        {/* ── running ── */}
        {phase === "running" && (
          <div className="mx-auto flex max-w-sm flex-col items-center gap-3 py-12 text-center">
            <Spinner size={26} className="text-primary" />
            <div className="text-[14px] font-medium">Importing into {destName}…</div>
            <p className="text-[12.5px] text-muted">Copying files and rebuilding folders in your Drive. You can keep working — progress shows at the bottom.</p>
          </div>
        )}

        {/* ── done ── */}
        {phase === "done" && result && (
          <div className="mx-auto max-w-md space-y-5 py-8 text-center">
            <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-ok-soft text-ok"><CheckCircle2 size={28} /></span>
            <div>
              <div className="text-[17px] font-semibold">Import complete</div>
              <p className="mt-1 text-[13px] text-muted">Copied into {result.destName}.</p>
            </div>
            <div className="grid grid-cols-2 gap-3 text-left sm:grid-cols-4">
              <Stat label="Copied" value={result.copied.toLocaleString()} tone="ok" />
              <Stat label="Folders" value={result.folders.toLocaleString()} />
              <Stat label="Skipped" value={result.skipped.toLocaleString()} />
              <Stat label="Failed" value={result.failed.toLocaleString()} tone={result.failed > 0 ? "warn" : undefined} />
            </div>
            <div className="flex justify-center gap-2">
              <Button variant="secondary" size="sm" onClick={reset}><RefreshCw size={14} /> Import more</Button>
              <Button variant="primary" size="sm" onClick={onClose}>Done</Button>
            </div>
          </div>
        )}
      </div>

      {/* review footer (sticky action bar) */}
      {phase === "review" && scan && plan && scan.summary.fileCount > 0 && (
        <div className="flex shrink-0 items-center gap-3 border-t border-border bg-surface px-4 py-3">
          <Button variant="ghost" size="sm" onClick={reset}><ArrowLeft size={14} /> Back</Button>
          <span className="ml-auto text-[12.5px] text-muted">
            {plan.stats.filesToCopy.toLocaleString()} to copy
            {plan.stats.filesSkipped > 0 && ` · ${plan.stats.filesSkipped.toLocaleString()} skipped`}
            {plan.stats.foldersToCreate > 0 && ` · ${plan.stats.foldersToCreate.toLocaleString()} folder${plan.stats.foldersToCreate === 1 ? "" : "s"}`}
          </span>
          <Button variant="primary" size="sm" disabled={plan.stats.filesToCopy === 0 || (intoNewFolder && !newFolderName.trim())} onClick={() => void runImport()}>
            <FolderInput size={15} /> Import {plan.stats.filesToCopy.toLocaleString()} file{plan.stats.filesToCopy === 1 ? "" : "s"}
          </Button>
        </div>
      )}
    </div>
  );
}

function HowItWorks({ icon: Icon, title, body }: { icon: typeof FolderInput; title: string; body: string }) {
  return (
    <li className="rounded-[var(--radius-control)] border border-border bg-surface px-3 py-2.5">
      <div className="mb-0.5 flex items-center gap-1.5 font-medium text-foreground"><Icon size={14} className="text-primary" /> {title}</div>
      {body}
    </li>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warn" }) {
  return (
    <div className="rounded-[var(--radius-control)] border border-border bg-surface-2 px-3 py-2.5">
      <div className={cn("font-display text-[18px] font-semibold tabular", tone === "warn" && "text-warn", tone === "ok" && "text-ok")}>{value}</div>
      <div className="text-[11.5px] text-muted">{label}</div>
    </div>
  );
}

function Notice({ tone, children }: { tone: "warn" | "danger"; children: ReactNode }) {
  return (
    <div className={cn("flex items-start gap-2 rounded-[var(--radius-control)] border px-3 py-2 text-[12.5px]", tone === "danger" ? "border-danger/40 bg-danger-soft text-danger" : "border-warn/40 bg-warn-soft text-warn")}>
      <TriangleAlert size={15} className="mt-0.5 shrink-0" />
      <span className="min-w-0">{children}</span>
    </div>
  );
}

function FilePreview({
  groups,
  scan,
  copyBySource,
  onCycle,
}: {
  groups: { path: string; files: ImportFile[] }[];
  scan: ImportScanResult;
  copyBySource: Map<string, PlanCopy>;
  onCycle: (f: ImportFile) => void;
}) {
  let rendered = 0;
  const totalFiles = scan.summary.fileCount;
  return (
    <div className="overflow-hidden rounded-[var(--radius-control)] border border-border">
      <div className="border-b border-border bg-surface-2 px-3 py-2 text-[12px] font-semibold uppercase tracking-wide text-faint">
        Preview {totalFiles > MAX_ROWS ? `· first ${MAX_ROWS} of ${totalFiles.toLocaleString()}` : `· ${totalFiles.toLocaleString()} file${totalFiles === 1 ? "" : "s"}`}
      </div>
      <div className="max-h-[46vh] overflow-y-auto">
        {groups.map((g, gi) => {
          if (rendered >= MAX_ROWS) return null;
          const visible = g.files.slice(0, MAX_ROWS - rendered);
          rendered += visible.length;
          return (
            <div key={g.path + gi}>
              <div className="sticky top-0 z-10 flex items-center gap-1.5 border-b border-border bg-surface px-3 py-1.5 text-[11.5px] font-medium text-muted">
                <Folder size={12} className="shrink-0" /> <span className="truncate">{g.path}</span>
                <span className="ml-auto shrink-0 text-faint">{g.files.length}</span>
              </div>
              {visible.map((f, i) => {
                const status = scan.dedup.statusById[f.id] ?? "new";
                const copy = copyBySource.get(f.id);
                const skipped = copy?.skipped ?? false;
                const decision = copy?.decision ?? "copy";
                const Icon = kindIcon(f.mimeType);
                const badge = STATUS_BADGE[status];
                const clickable = status !== "new";
                return (
                  <div key={f.id} className={cn("flex items-center gap-2 border-b border-border px-3 py-1.5 text-[12.5px] last:border-0", revealClass(i), skipped && "opacity-45")} style={revealStyle(i)}>
                    <Icon size={15} className="shrink-0 text-muted" />
                    <span className={cn("min-w-0 flex-1 truncate", skipped && "line-through")}>
                      {decision === "rename" && copy ? copy.name : f.name}
                    </span>
                    {f.size != null && <span className="shrink-0 font-mono text-[11px] tabular text-faint">{formatBytes(f.size)}</span>}
                    <button
                      onClick={() => clickable && onCycle(f)}
                      disabled={!clickable}
                      title={clickable ? `Click to change (currently: ${DECISION_LABEL[decision]})` : undefined}
                      className={cn("shrink-0 rounded-full px-1.5 py-0.5 text-[10.5px] font-medium", badge.cls, clickable && "pressable cursor-pointer ring-offset-1 hover:ring-1 hover:ring-border-strong")}
                    >
                      {status === "new" ? badge.label : `${badge.label} · ${DECISION_LABEL[decision]}`}
                    </button>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
