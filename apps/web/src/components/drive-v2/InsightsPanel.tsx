import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Clock, Copy, Eye, ExternalLink, HardDrive, Layers, Sparkles, Trash2, X } from "lucide-react";
import { formatBytes } from "@kosh/shared";
import { cn } from "@/lib/cn";
import { ago } from "@/lib/time";
import { Button, Progress, Spinner } from "@/components/ui";
import { useUi } from "@/data/ui";
import { driveV2Api, type DriveNode, type DriveScanFile } from "@/data/driveV2Api";
import { useDriveV2 } from "@/data/driveV2";

/** Percent label that stays useful for a huge quota (12 GB of 5 TB is 0.2%, not a bare "0%"). */
function usagePct(usage: number, limit?: number): { label: string; bar: number } {
  if (!limit) return { label: "—", bar: 0 };
  const p = (usage / limit) * 100;
  const label = p >= 10 ? `${Math.round(p)}%` : p >= 0.1 ? `${p.toFixed(1)}%` : usage > 0 ? "<0.1%" : "0%";
  return { label, bar: Math.max(p, usage > 0 ? 1.5 : 0) }; // keep a visible sliver when anything is used
}

/** Build a preview-capable node from a scan record (enough for PreviewOverlay). */
function scanToNode(f: DriveScanFile): DriveNode {
  return { id: f.id, name: f.name, mimeType: f.mimeType, size: f.size, modifiedTime: f.modifiedTime, thumbnailLink: f.thumbnailLink, webViewLink: f.webViewLink, isFolder: false };
}

type Bucket = "images" | "videos" | "documents" | "audio" | "archives" | "other";
const BUCKET_META: Record<Bucket, { label: string; bar: string }> = {
  images: { label: "Images", bar: "bg-primary" },
  videos: { label: "Videos", bar: "bg-danger" },
  documents: { label: "Documents", bar: "bg-info" },
  audio: { label: "Audio", bar: "bg-gold" },
  archives: { label: "Archives", bar: "bg-ok" },
  other: { label: "Other", bar: "bg-muted" },
};
function bucketOf(mime: string): Bucket {
  if (mime.startsWith("image/")) return "images";
  if (mime.startsWith("video/")) return "videos";
  if (mime.startsWith("audio/")) return "audio";
  if (/zip|tar|gzip|compressed|rar|7z/.test(mime)) return "archives";
  if (mime === "application/pdf" || mime.includes("document") || mime.includes("spreadsheet") || mime.includes("presentation") || mime.includes("word") || mime.startsWith("text/")) return "documents";
  return "other";
}
const sizeOf = (f: DriveScanFile) => f.size ?? f.quotaBytesUsed ?? 0;

type Tab = "overview" | "duplicates" | "largest" | "stale";

export function InsightsPanel({ onClose }: { onClose: () => void }) {
  const accountId = useDriveV2((s) => s.accountId)!;
  const spaceId = useDriveV2((s) => s.spaceId);
  const loadQuota = useDriveV2((s) => s.loadQuota);
  const quota = useDriveV2((s) => s.quota);
  const toast = useUi((s) => s.toast);
  const preview = (f: DriveScanFile) => useDriveV2.getState().setPreview(scanToNode(f));

  const [scan, setScan] = useState<DriveScanFile[]>([]);
  const [stale, setStale] = useState<DriveScanFile[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [busy, setBusy] = useState<Set<string>>(new Set());

  useEffect(() => {
    let live = true;
    setLoading(true);
    const driveId = spaceId ?? undefined; // scope insights to the active Shared Drive when one is selected
    Promise.all([driveV2Api.scan(accountId, { orderBy: "quotaBytesUsed desc", cap: 10, driveId }), driveV2Api.scan(accountId, { orderBy: "viewedByMeTime", cap: 2, driveId })])
      .then(([main, staleScan]) => {
        if (!live) return;
        setScan(main.files);
        setTruncated(main.truncated);
        setStale(staleScan.files.slice(0, 40));
        setError(null);
      })
      .catch((err) => { if (live) setError(err instanceof Error ? err.message : "Couldn't analyze your Drive."); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [accountId, spaceId]);

  const breakdown = useMemo(() => {
    const map = new Map<Bucket, { count: number; bytes: number }>();
    let total = 0;
    for (const f of scan) {
      const b = bucketOf(f.mimeType);
      const cur = map.get(b) ?? { count: 0, bytes: 0 };
      cur.count++;
      cur.bytes += sizeOf(f);
      map.set(b, cur);
      total += sizeOf(f);
    }
    const rows = [...map.entries()].map(([bucket, v]) => ({ bucket, ...v })).sort((a, b) => b.bytes - a.bytes);
    return { rows, total };
  }, [scan]);

  const dupGroups = useMemo(() => {
    const byHash = new Map<string, DriveScanFile[]>();
    for (const f of scan) {
      if (!f.md5Checksum) continue;
      const arr = byHash.get(f.md5Checksum) ?? [];
      arr.push(f);
      byHash.set(f.md5Checksum, arr);
    }
    const groups = [...byHash.values()].filter((g) => g.length > 1);
    const reclaimable = groups.reduce((a, g) => a + sizeOf(g[0]!) * (g.length - 1), 0);
    groups.sort((a, b) => sizeOf(b[0]!) * (b.length - 1) - sizeOf(a[0]!) * (a.length - 1));
    return { groups, reclaimable };
  }, [scan]);

  const largest = useMemo(() => [...scan].sort((a, b) => sizeOf(b) - sizeOf(a)).slice(0, 30), [scan]);

  async function trashIds(ids: string[]) {
    setBusy((s) => new Set([...s, ...ids]));
    let ok = 0;
    for (const id of ids) {
      try {
        await driveV2Api.setTrash(accountId, id, true);
        ok++;
      } catch {
        /* keep going */
      }
    }
    const done = new Set(ids);
    setScan((s) => s.filter((f) => !done.has(f.id)));
    setStale((s) => s.filter((f) => !done.has(f.id)));
    setBusy((s) => { const n = new Set(s); ids.forEach((id) => n.delete(id)); return n; });
    void loadQuota();
    toast({ message: `Moved ${ok} item${ok === 1 ? "" : "s"} to trash`, tone: ok ? "ok" : "warn" });
  }

  const TABS: { k: Tab; label: string; icon: typeof Layers }[] = [
    { k: "overview", label: "Overview", icon: HardDrive },
    { k: "duplicates", label: `Duplicates${dupGroups.groups.length ? ` (${dupGroups.groups.length})` : ""}`, icon: Copy },
    { k: "largest", label: "Largest", icon: Layers },
    { k: "stale", label: "Stale", icon: Clock },
  ];

  return (
    <div className="flex flex-col overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface lg:h-full">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <Sparkles size={17} className="text-primary" />
        <span className="text-[14px] font-semibold">Insights</span>
        {truncated && <span className="rounded-full bg-warn-soft px-2 py-0.5 text-[11px] text-warn">sampled first {scan.length.toLocaleString()} files</span>}
        <button onClick={onClose} className="ml-auto grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-foreground" aria-label="Close insights"><X size={16} /></button>
      </div>

      <div className="flex gap-1 border-b border-border px-3 py-2">
        {TABS.map((t) => (
          <button key={t.k} onClick={() => setTab(t.k)} className={cn("inline-flex items-center gap-1.5 rounded-[var(--radius-control)] px-3 py-1.5 text-[13px] font-medium", tab === t.k ? "bg-primary-soft text-primary" : "text-muted hover:bg-surface-2")}>
            <t.icon size={14} /> {t.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="grid h-full min-h-[50vh] place-items-center"><Spinner size={26} className="text-primary" /></div>
        ) : error ? (
          <div className="grid h-full min-h-[50vh] place-items-center text-center">
            <div><div className="text-[14px] font-semibold">Couldn't analyze</div><p className="mt-1 text-[13px] text-muted">{error}</p></div>
          </div>
        ) : tab === "overview" ? (
          <Overview breakdown={breakdown} reclaimable={dupGroups.reclaimable} dupCount={dupGroups.groups.length} fileCount={scan.length} quota={quota} onSeeDuplicates={() => setTab("duplicates")} />
        ) : tab === "duplicates" ? (
          <Duplicates groups={dupGroups.groups} reclaimable={dupGroups.reclaimable} busy={busy} onTrash={trashIds} onPreview={preview} />
        ) : tab === "largest" ? (
          <FileList files={largest} busy={busy} onTrash={(id) => void trashIds([id])} onPreview={preview} meta={(f) => formatBytes(sizeOf(f))} />
        ) : (
          <FileList files={stale} busy={busy} onTrash={(id) => void trashIds([id])} onPreview={preview} meta={(f) => (f.viewedByMeTime ? `last opened ${ago(f.viewedByMeTime)}` : "never opened")} />
        )}
      </div>
    </div>
  );
}

function Overview({ breakdown, reclaimable, dupCount, fileCount, quota, onSeeDuplicates }: { breakdown: { rows: { bucket: Bucket; count: number; bytes: number }[]; total: number }; reclaimable: number; dupCount: number; fileCount: number; quota: { usage: number; limit?: number } | null; onSeeDuplicates: () => void }) {
  const { rows, total } = breakdown;
  const usage = usagePct(quota?.usage ?? 0, quota?.limit);
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Files analyzed" value={fileCount.toLocaleString()} />
        <Stat label={quota?.limit ? "Storage used" : "Storage"} value={quota ? formatBytes(quota.usage) : "—"} sub={quota?.limit ? `of ${formatBytes(quota.limit)} · ${usage.label}` : undefined} />
        <Stat label="Reclaimable (dupes)" value={formatBytes(reclaimable)} tone={reclaimable > 0 ? "warn" : undefined} />
      </div>

      {/* Real account storage (matches the sidebar) — distinct from the analyzed-files breakdown below. */}
      {quota?.limit && (
        <div className="rounded-[var(--radius-control)] border border-border bg-surface-2 px-3.5 py-3">
          <div className="mb-1.5 flex items-baseline justify-between">
            <span className="text-[12.5px] font-medium">Google Drive storage</span>
            <span className="font-mono text-[11.5px] tabular text-muted">{formatBytes(quota.usage)} / {formatBytes(quota.limit)}</span>
          </div>
          <Progress value={usage.bar} tone={usage.bar > 95 ? "danger" : usage.bar > 80 ? "warn" : "primary"} />
        </div>
      )}

      <div>
        <div className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-faint">By type · {formatBytes(total)} analyzed</div>
        {total === 0 ? (
          <p className="text-[13px] text-muted">No sized files found.</p>
        ) : (
          <>
            <div className="flex h-3 w-full overflow-hidden rounded-full bg-surface-3">
              {rows.map((r) => <div key={r.bucket} className={cn("h-full", BUCKET_META[r.bucket].bar)} style={{ width: `${(r.bytes / total) * 100}%` }} title={`${BUCKET_META[r.bucket].label}: ${formatBytes(r.bytes)}`} />)}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {rows.map((r) => (
                <div key={r.bucket} className="flex items-center gap-2 text-[12.5px]">
                  <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", BUCKET_META[r.bucket].bar)} />
                  <span className="flex-1 truncate">{BUCKET_META[r.bucket].label}</span>
                  <span className="text-muted">{formatBytes(r.bytes)}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {dupCount > 0 && (
        <button onClick={onSeeDuplicates} className="flex w-full items-center gap-2.5 rounded-[var(--radius-control)] border border-warn/40 bg-warn-soft px-4 py-3 text-left">
          <AlertTriangle size={17} className="shrink-0 text-warn" />
          <span className="flex-1 text-[13px]"><span className="font-semibold">{dupCount} duplicate group{dupCount === 1 ? "" : "s"}</span> found — up to {formatBytes(reclaimable)} reclaimable.</span>
          <span className="shrink-0 text-[12.5px] font-medium text-warn">Review →</span>
        </button>
      )}
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "warn" }) {
  return (
    <div className="rounded-[var(--radius-control)] border border-border bg-surface-2 px-3 py-2.5">
      <div className={cn("font-display text-[18px] font-semibold tabular", tone === "warn" && "text-warn")}>{value}</div>
      <div className="text-[11.5px] text-muted">{label}</div>
      {sub && <div className="mt-0.5 font-mono text-[10.5px] tabular text-faint">{sub}</div>}
    </div>
  );
}

function Duplicates({ groups, reclaimable, busy, onTrash, onPreview }: { groups: DriveScanFile[][]; reclaimable: number; busy: Set<string>; onTrash: (ids: string[]) => Promise<void>; onPreview: (f: DriveScanFile) => void }) {
  if (!groups.length) return <div className="grid place-items-center py-16 text-center"><div><div className="text-[14px] font-semibold">No duplicates 🎉</div><p className="mt-1 text-[13px] text-muted">No files share identical content.</p></div></div>;
  const extrasOf = (g: DriveScanFile[]) => g.slice(1).map((f) => f.id); // keep the first, trash the rest
  const allExtras = groups.flatMap(extrasOf);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] text-muted">{groups.length} group{groups.length === 1 ? "" : "s"} · up to <span className="font-semibold text-foreground">{formatBytes(reclaimable)}</span> reclaimable</span>
        <Button variant="outline" size="sm" className="ml-auto" onClick={() => void onTrash(allExtras)}><Trash2 size={14} /> Trash all extras ({allExtras.length})</Button>
      </div>
      {groups.map((g) => (
        <div key={g[0]!.md5Checksum} className="overflow-hidden rounded-[var(--radius-control)] border border-border">
          <div className="flex items-center gap-2 border-b border-border bg-surface-2 px-3 py-1.5 text-[12px]">
            <span className="font-medium">{g.length} copies · {formatBytes(sizeOf(g[0]!))} each</span>
            <Button variant="ghost" size="sm" className="ml-auto text-danger" onClick={() => void onTrash(extrasOf(g))}>Trash {g.length - 1} extra{g.length - 1 === 1 ? "" : "s"}</Button>
          </div>
          {g.map((f, i) => (
            <div key={f.id} className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-[12.5px] last:border-0">
              <span className="min-w-0 flex-1 truncate">{f.name}</span>
              {i === 0 && <span className="shrink-0 rounded-full bg-ok-soft px-1.5 text-[10px] text-ok">keep</span>}
              {busy.has(f.id) && <Spinner size={13} className="text-muted" />}
              <button onClick={() => onPreview(f)} className="shrink-0 rounded p-1 text-faint hover:text-primary" aria-label="Preview"><Eye size={14} /></button>
              {f.webViewLink && <a href={f.webViewLink} target="_blank" rel="noreferrer noopener" className="shrink-0 rounded p-1 text-faint hover:text-foreground" aria-label="Open in Drive"><ExternalLink size={13} /></a>}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function FileList({ files, busy, onTrash, onPreview, meta }: { files: DriveScanFile[]; busy: Set<string>; onTrash: (id: string) => void; onPreview: (f: DriveScanFile) => void; meta: (f: DriveScanFile) => string }) {
  if (!files.length) return <div className="grid place-items-center py-16 text-[13px] text-muted">Nothing to show.</div>;
  return (
    <div className="divide-y divide-border">
      {files.map((f) => (
        <div key={f.id} className="flex items-center gap-3 py-2">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-medium">{f.name}</div>
            <div className="font-mono text-[11px] tabular text-faint">{meta(f)}</div>
          </div>
          {busy.has(f.id) ? <Spinner size={14} className="text-muted" /> : (
            <>
              <button onClick={() => onPreview(f)} className="grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-primary" aria-label="Preview"><Eye size={15} /></button>
              {f.webViewLink && <a href={f.webViewLink} target="_blank" rel="noreferrer noopener" className="grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-foreground" aria-label="Open in Drive"><ExternalLink size={15} /></a>}
              <button onClick={() => onTrash(f.id)} className="grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-danger" aria-label="Move to trash"><Trash2 size={15} /></button>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
