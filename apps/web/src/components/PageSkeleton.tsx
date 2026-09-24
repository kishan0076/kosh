import { cn } from "@/lib/cn";
import { Skeleton } from "./ui";

/**
 * Route-shaped loading placeholders, built only from `<Skeleton>`. Heights are fixed to the real
 * content (list row 72px, table row 44px, card 148px, stat tile 96px, …) so the skeleton→content swap
 * is CLS-free. The `.shimmer` sweep goes static under reduced motion via the index.css rule.
 */
export type SkeletonVariant = "list" | "cards" | "detail" | "table" | "settings" | "dashboard" | "form";

/** Pick the skeleton shape for a route so deep links load into the right silhouette. */
export function skeletonFor(pathname: string): SkeletonVariant {
  const p = pathname.replace(/\/+$/, "") || "/";
  if (p === "/") return "dashboard";
  if (p === "/settings" || p === "/vault") return "settings";
  if (p === "/add" || p === "/skills/new" || /^\/skills\/[^/]+\/edit$/.test(p) || p === "/github/new" || p === "/github/upload") return "form";
  if (p.startsWith("/items/")) return "detail";
  if (p === "/library" || p === "/inbox" || p === "/trash" || p.startsWith("/collections/")) return "list";
  if (p === "/skills" || p === "/prompts" || p === "/collections" || p.startsWith("/github") || p.startsWith("/drive")) return "cards";
  return "cards";
}

/** ItemCard-shaped row: avatar/icon box + `lines` of text. 72px tall. */
export function SkeletonRow({ avatar = true, lines = 2 }: { avatar?: boolean; lines?: number }) {
  return (
    <div className="flex h-[72px] items-center gap-3 rounded-[var(--radius-card)] border border-border bg-surface px-4">
      {avatar && <Skeleton className="h-9 w-9 shrink-0 rounded-lg" />}
      <div className="min-w-0 flex-1 space-y-2">
        {Array.from({ length: lines }, (_, i) => (
          <Skeleton key={i} className={cn("h-3", i === 0 ? "w-3/5" : "w-2/5")} />
        ))}
      </div>
    </div>
  );
}

/** Grid card: optional media block, title, two lines, a chip row. 148px tall. */
export function SkeletonCard({ media = false }: { media?: boolean }) {
  return (
    <div className="flex h-[148px] flex-col rounded-[var(--radius-card)] border border-border bg-surface p-4">
      {media ? <Skeleton className="mb-3 h-10 w-full rounded-lg" /> : <Skeleton className="mb-3 h-8 w-8 rounded-lg" />}
      <Skeleton className="h-3.5 w-3/4" />
      <Skeleton className="mt-2 h-3 w-1/2" />
      <div className="mt-auto flex gap-1.5">
        <Skeleton className="h-5 w-14 rounded-full" />
        <Skeleton className="h-5 w-10 rounded-full" />
      </div>
    </div>
  );
}

/** A paragraph of `lines` bars; the last one is short so it reads as prose. */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn("space-y-2", className)}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cn("h-3", i === lines - 1 ? "w-2/5" : "w-full")} />
      ))}
    </div>
  );
}

/** PageHeader silhouette: icon badge + title + subtitle (h-10 + h-4), same 20px bottom gap. */
function SkeletonHeader() {
  return (
    <div className="mb-5 flex items-center gap-3">
      <Skeleton className="h-10 w-10 shrink-0 rounded-xl" />
      <div className="space-y-2">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-3 w-56 max-w-[60vw]" />
      </div>
    </div>
  );
}

export function PageSkeleton({ variant, rows = 6, header = true }: { variant: SkeletonVariant; rows?: number; header?: boolean }) {
  return (
    <div role="status" aria-busy="true" aria-label="Loading" className="reveal-in">
      {header && <SkeletonHeader />}
      {variant === "list" && (
        <div className="space-y-2">
          {Array.from({ length: rows }, (_, i) => (
            <SkeletonRow key={i} />
          ))}
        </div>
      )}
      {variant === "cards" && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: rows }, (_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      )}
      {variant === "table" && (
        <div className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
          {Array.from({ length: rows }, (_, i) => (
            <div key={i} className={cn("flex h-11 items-center gap-3 px-4", i > 0 && "border-t border-border")}>
              <Skeleton className="h-4 w-4 rounded" />
              <Skeleton className="h-3 flex-1" />
              <Skeleton className="hidden h-3 w-20 sm:block" />
              <Skeleton className="h-3 w-12" />
            </div>
          ))}
        </div>
      )}
      {variant === "settings" && (
        <div className="space-y-4">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="h-32 rounded-[var(--radius-card)] border border-border bg-surface p-5">
              <Skeleton className="h-4 w-36" />
              <Skeleton className="mt-2 h-3 w-64 max-w-full" />
              <Skeleton className="mt-5 h-9 w-full max-w-sm" />
            </div>
          ))}
        </div>
      )}
      {variant === "detail" && (
        <div className="max-w-3xl">
          <Skeleton className="h-7 w-2/3" />
          <div className="mt-3 flex items-center gap-2">
            <Skeleton className="h-4 w-4 rounded-full" />
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-3 w-20" />
          </div>
          <SkeletonText lines={6} className="mt-6" />
          <div className="mt-5 flex gap-2">
            <Skeleton className="h-6 w-16 rounded-full" />
            <Skeleton className="h-6 w-20 rounded-full" />
          </div>
        </div>
      )}
      {variant === "dashboard" && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="h-24 rounded-[var(--radius-card)] border border-border bg-surface p-4">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-7 w-7 rounded-lg" />
                  <Skeleton className="h-3 w-16" />
                </div>
                <Skeleton className="mt-4 h-6 w-12" />
              </div>
            ))}
          </div>
          <div className="mt-4 h-56 rounded-[var(--radius-card)] border border-border bg-surface p-5">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="mt-6 h-36 w-full rounded-lg" />
          </div>
        </>
      )}
      {variant === "form" && (
        <div className="max-w-xl space-y-5">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i}>
              <Skeleton className="mb-2 h-3 w-24" />
              <Skeleton className="h-9 w-full" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
