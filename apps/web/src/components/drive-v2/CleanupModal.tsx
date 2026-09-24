import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Clock, Copy, HardDrive, RefreshCw, Sparkles, Trash2, X } from "lucide-react";
import { computeCleanupBuckets, formatBytes, type CleanupBucket, type CleanupBucketKey } from "@kosh/shared";
import { Badge, Button, Skeleton } from "@/components/ui";
import { Modal } from "@/components/overlays";
import { EmptyState } from "@/components/common";
import { useUi } from "@/data/ui";
import { driveV2Api, type DriveCleanupRecommendation } from "@/data/driveV2Api";
import { useDriveV2 } from "@/data/driveV2";

const BUCKET_ICON: Record<CleanupBucketKey, typeof Copy> = { duplicates: Copy, stale: Clock, large: HardDrive };
const SAFETY_TONE: Record<DriveCleanupRecommendation["safety"], "ok" | "warn" | "danger"> = { safe: "ok", review: "warn", caution: "danger" };
const SAFETY_LABEL: Record<DriveCleanupRecommendation["safety"], string> = { safe: "Safe to clear", review: "Review first", caution: "Be careful" };

/** Bucket-card silhouette (icon, headline + badge, two rationale lines, sample line, action) so the
 *  analyze → results swap doesn't jump. */
function BucketSkeleton() {
  return (
    <div className="rounded-[var(--radius-control)] border border-border p-3.5">
      <div className="flex flex-wrap items-start gap-3">
        <Skeleton className="h-9 w-9 shrink-0 rounded-lg" />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-center gap-2"><Skeleton className="h-3.5 w-2/5" /><Skeleton className="h-4 w-16 rounded-full" /></div>
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-4/5" />
          <Skeleton className="h-3 w-3/5" />
        </div>
        <div className="flex basis-full justify-end sm:basis-auto"><Skeleton className="h-8 w-20" /></div>
      </div>
    </div>
  );
}

export function CleanupModal({ onClose }: { onClose: () => void }) {
  const accountId = useDriveV2((s) => s.accountId)!;
  const aiEnabled = useDriveV2((s) => s.aiEnabled);
  const spaceId = useDriveV2((s) => s.spaceId);
  const toast = useUi((s) => s.toast);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [buckets, setBuckets] = useState<CleanupBucket[]>([]);
  const [recs, setRecs] = useState<DriveCleanupRecommendation[]>([]);
  const [sampled, setSampled] = useState(false);
  const [applyingKey, setApplyingKey] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0); // bumped by "Try again" to re-run the scan effect

  useEffect(() => {
    let live = true;
    setLoading(true);
    (async () => {
      try {
        // Two scans, merged: largest-first surfaces big files, least-recently-viewed surfaces stale ones —
        // a single size-ordered scan would bias the "stale" bucket toward large files (mirrors InsightsPanel).
        const driveId = spaceId ?? undefined;
        const [bySize, byViewed] = await Promise.all([
          driveV2Api.scan(accountId, { orderBy: "quotaBytesUsed desc", cap: 10, driveId }),
          driveV2Api.scan(accountId, { orderBy: "viewedByMeTime", cap: 2, driveId }),
        ]);
        if (!live) return;
        const merged = new Map<string, (typeof bySize.files)[number]>();
        for (const f of [...bySize.files, ...byViewed.files]) merged.set(f.id, f);
        const found = computeCleanupBuckets([...merged.values()]);
        setBuckets(found);
        setSampled(bySize.truncated || byViewed.truncated);
        setError(null);
        // AI prioritization is a best-effort enhancement — the buckets stand on their own without it.
        if (aiEnabled && found.length) {
          try {
            const digest = found.map((b) => ({ key: b.key, label: b.label, count: b.count, bytes: b.bytes, sampleNames: b.sampleNames }));
            const { recommendations } = await driveV2Api.aiCleanup(accountId, digest);
            if (live) setRecs(recommendations);
          } catch {
            /* keep the deterministic buckets; skip the AI rationale */
          }
        }
      } catch (err) {
        if (live) setError(err instanceof Error ? err.message : "Couldn't analyze your Drive.");
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => { live = false; };
  }, [accountId, aiEnabled, spaceId, attempt]);

  // Order buckets by the AI's recommendation order; append any the model didn't rank.
  const ordered = useMemo(() => {
    const byKey = new Map(buckets.map((b) => [b.key, b]));
    const seen = new Set<string>();
    const out: { bucket: CleanupBucket; rec?: DriveCleanupRecommendation }[] = [];
    for (const r of recs) {
      const bucket = byKey.get(r.key as CleanupBucketKey);
      if (bucket && !seen.has(r.key)) { out.push({ bucket, rec: r }); seen.add(r.key); }
    }
    for (const b of buckets) if (!seen.has(b.key)) out.push({ bucket: b });
    return out;
  }, [buckets, recs]);

  const totalReclaimable = useMemo(() => buckets.reduce((a, b) => a + b.bytes, 0), [buckets]);

  async function apply(bucket: CleanupBucket) {
    if (applyingKey || !bucket.fileIds.length) return;
    setApplyingKey(bucket.key);
    const ids = [...bucket.fileIds];
    const total = ids.length;
    const label = `Trashing ${bucket.label.toLowerCase()}`;
    let processed = 0;
    let ok = 0; // count only files that actually moved, so the toast can't lie on failure
    useDriveV2.setState({ bulkOp: { label, total, done: 0 } });
    const worker = async () => {
      while (ids.length) {
        const id = ids.shift()!;
        try { await driveV2Api.setTrash(accountId, id, true); ok++; } catch { /* keep going; failures aren't counted as done */ }
        processed++;
        useDriveV2.setState({ bulkOp: { label, total, done: processed } });
      }
    };
    try {
      await Promise.all(Array.from({ length: Math.min(4, total) }, worker)); // bounded concurrency, mirrors InsightsPanel
    } finally {
      useDriveV2.setState({ bulkOp: null });
      setApplyingKey(null);
    }
    if (ok > 0) {
      // Drop the cleared group so the header totals + empty-state reflect reality (not a stale mount snapshot).
      setBuckets((bs) => bs.filter((b) => b.key !== bucket.key));
      toast({ message: `Moved ${ok} file${ok === 1 ? "" : "s"} to trash`, tone: ok === total ? "ok" : "warn" });
      void useDriveV2.getState().loadQuota();
      void useDriveV2.getState().load(true); // refresh the list behind the modal so the freed files disappear
    } else {
      toast({ message: "Couldn't move those files to trash — try again.", tone: "danger" });
    }
  }

  return (
    <Modal open onClose={onClose} className="max-w-2xl" labelledBy="cleanup-title">
      <div className="flex shrink-0 items-center gap-3 border-b border-border px-5 py-4">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary"><Sparkles size={19} /></span>
        <div className="min-w-0 flex-1">
          <h2 id="cleanup-title" className="text-[15px] font-semibold">AI Cleanup</h2>
          <p className="text-[12px] text-muted">
            {loading ? "Analyzing your Drive…" : buckets.length ? `Up to ${formatBytes(totalReclaimable)} reclaimable across ${buckets.length} ${buckets.length === 1 ? "group" : "groups"}.` : "Reclaim space from duplicates, stale, and large files."}
          </p>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close cleanup"><X size={16} /></Button>
      </div>

      {/* Scrolls on its own so the header stays put (and, as a phone sheet, the panel never outgrows the viewport). */}
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {loading ? (
          <div className="space-y-3" role="status" aria-busy="true" aria-label="Analyzing your Drive">
            {[0, 1, 2].map((i) => <BucketSkeleton key={i} />)}
          </div>
        ) : error ? (
          <EmptyState
            size="sm"
            icon={AlertTriangle}
            title="Couldn't analyze"
            description={error}
            action={<Button variant="outline" size="sm" onClick={() => setAttempt((a) => a + 1)}><RefreshCw size={14} /> Try again</Button>}
          />
        ) : ordered.length === 0 ? (
          <EmptyState size="sm" icon={Sparkles} title="Your Drive looks tidy" description="No duplicate, stale, or oversized files worth clearing right now." />
        ) : (
          <div className="space-y-3">
            {sampled && (
              <p className="rounded-[var(--radius-control)] bg-warn-soft px-3 py-2 text-[11.5px] text-warn">
                Your Drive is large, so this analyzed a sample of your files — clear these, then run it again for more.
              </p>
            )}
            {ordered.map(({ bucket, rec }) => {
              const Icon = BUCKET_ICON[bucket.key];
              const isApplying = applyingKey === bucket.key;
              const safety = rec?.safety ?? "review";
              return (
                <div key={bucket.key} className="rounded-[var(--radius-control)] border border-border p-3.5">
                  {/* The action drops under the text on phones so the copy keeps a readable column. */}
                  <div className="flex flex-wrap items-start gap-3">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted"><Icon size={17} /></span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[13.5px] font-semibold">{rec?.headline || bucket.label}</span>
                        {rec && <Badge tone={SAFETY_TONE[safety]}>{SAFETY_LABEL[safety]}</Badge>}
                      </div>
                      <p className="mt-0.5 text-[12.5px] text-muted">
                        {rec?.rationale ? `${rec.rationale} ` : ""}
                        {bucket.count} file{bucket.count === 1 ? "" : "s"} · {formatBytes(bucket.bytes)}{bucket.capped ? ` — clearing ${bucket.fileIds.length} at a time` : ""}
                      </p>
                      <p className="mt-1 line-clamp-2 break-words text-[11.5px] text-faint">{bucket.sampleNames.join(" · ")}</p>
                    </div>
                    <div className="flex basis-full justify-end sm:basis-auto sm:shrink-0">
                      <Button
                        variant={safety === "caution" ? "danger" : "outline"}
                        size="sm"
                        disabled={!!applyingKey && !isApplying}
                        loading={isApplying}
                        onClick={() => void apply(bucket)}
                      >
                        <Trash2 size={13} /> Trash {bucket.fileIds.length}
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
            <p className="pt-1 text-[11.5px] text-faint">Files are moved to Drive's trash — you can restore them there until it's emptied.</p>
          </div>
        )}
      </div>
    </Modal>
  );
}
