import { useLocation } from "react-router-dom";
import { cn } from "@/lib/cn";
import { Skeleton } from "./ui";

/**
 * Route-shaped loading placeholders, built only from `<Skeleton>`. Heights are fixed to the real
 * content (list row 72px, table row 44px, card 148px, stat tile 96px, …) so the skeleton→content swap
 * is CLS-free. The `.shimmer` sweep goes static under reduced motion via the index.css rule.
 *
 * The shell renders `<PageSkeleton variant={skeletonFor(pathname)} />` during hydration, and several
 * pages render one for their own loading state. The coarse `variant` picks the silhouette; the finer
 * card/filter shape (which route within a "cards" page) is read from the live location so a deep link
 * already looks like where it's going.
 */
export type SkeletonVariant =
  | "list"
  | "cards"
  | "detail"
  | "table"
  | "settings"
  | "dashboard"
  | "form"
  | "home"
  | "library"
  | "drive"
  | "vault";

/** Pick the skeleton shape for a route so deep links load into the right silhouette. */
export function skeletonFor(pathname: string): SkeletonVariant {
  const p = pathname.replace(/\/+$/, "") || "/";
  if (p === "/") return "home";
  if (p === "/vault") return "vault";
  if (p === "/settings") return "settings";
  if (p === "/add" || p === "/skills/new" || /^\/skills\/[^/]+\/edit$/.test(p) || p === "/github/new" || p === "/github/upload") return "form";
  if (p.startsWith("/items/")) return "detail";
  if (p === "/library") return "library";
  if (p === "/inbox" || p === "/trash") return "list";
  if (p.startsWith("/collections/")) return "cards"; // collection detail is a card grid (with a back link)
  // GitHub sub-routes each land on their page's own shape rather than a card grid that then re-swaps.
  if (p === "/github/health") return "dashboard";
  if (/^\/github\/[^/]+\/[^/]+\/settings$/.test(p)) return "settings";
  if (/^\/github\/[^/]+\/[^/]+\/edit$/.test(p)) return "form";
  if (/^\/github\/[^/]+\/[^/]+/.test(p)) return "detail";
  if (p.startsWith("/drive")) return "drive";
  if (p === "/skills" || p === "/prompts" || p === "/collections" || p.startsWith("/github")) return "cards";
  return "cards";
}

/** Per-route shape for the "cards" variant: the action button wraps under the header on phones, some
 *  routes carry filter chip rows, and card heights differ (skills 176, prompts 252, collections 82). */
function cardsShape(pathname: string) {
  const p = pathname.replace(/\/+$/, "") || "/";
  if (p === "/skills") return { action: true, filters: 2, cardH: "h-[176px]", kind: "card" as const, grid: "grid-cols-1 sm:grid-cols-2 xl:grid-cols-3" };
  if (p === "/prompts") return { action: true, filters: 0, cardH: "h-[252px]", kind: "prompt" as const, grid: "grid-cols-1 md:grid-cols-2" };
  if (p === "/collections") return { action: true, filters: 0, cardH: "h-[82px]", kind: "row" as const, grid: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3" };
  if (p.startsWith("/collections/")) return { action: false, filters: 0, cardH: "h-[176px]", kind: "card" as const, grid: "grid-cols-1 sm:grid-cols-2 xl:grid-cols-3", backLink: true };
  return { action: true, filters: 0, cardH: "h-[148px]", kind: "card" as const, grid: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3" };
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

/** Grid card: optional media block, title, two lines, a chip row. 148px tall by default. */
export function SkeletonCard({ media = false, height = "h-[148px]" }: { media?: boolean; height?: string }) {
  return (
    <div className={cn("flex flex-col rounded-[var(--radius-card)] border border-border bg-surface p-4", height)}>
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

/** Prompt card: title, description, a fenced-body block, variable chips, a footer row. ≈252px. */
function SkeletonPromptCard({ height }: { height: string }) {
  return (
    <div className={cn("flex flex-col rounded-[var(--radius-card)] border border-border bg-surface p-4", height)}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-3.5 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
        </div>
        <Skeleton className="h-6 w-16 rounded-full" />
      </div>
      <Skeleton className="mt-3 h-16 w-full rounded-[var(--radius-control)]" />
      <div className="mt-3 flex gap-1.5">
        <Skeleton className="h-5 w-16 rounded" />
        <Skeleton className="h-5 w-12 rounded" />
      </div>
      <div className="mt-auto flex items-center justify-between gap-2 border-t border-border pt-3">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-8 w-24 rounded-[var(--radius-control)]" />
      </div>
    </div>
  );
}

/** Collection card: a short horizontal row (icon + name + count). ≈82px. */
function SkeletonRowCard({ height }: { height: string }) {
  return (
    <div className={cn("flex items-center gap-4 rounded-[var(--radius-card)] border border-border bg-surface p-4", height)}>
      <Skeleton className="h-12 w-12 shrink-0 rounded-xl" />
      <div className="min-w-0 flex-1 space-y-2">
        <Skeleton className="h-3.5 w-2/3" />
        <Skeleton className="h-3 w-16" />
      </div>
    </div>
  );
}

/** A horizontal chip-filter row (edge-to-edge on phones), matching the pages' pill filters. */
function SkeletonChipRow({ n = 5 }: { n?: number }) {
  return (
    <div className="flex gap-1.5 overflow-hidden pb-1" aria-hidden>
      {Array.from({ length: n }, (_, i) => (
        <Skeleton key={i} className="h-9 w-16 shrink-0 rounded-full [@media(pointer:coarse)]:h-10" />
      ))}
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
  const { pathname } = useLocation();
  const shape = variant === "cards" ? cardsShape(pathname) : null;
  // Home and Vault paint their own top area; the rest share the PageHeader silhouette (unless suppressed).
  const ownTop = variant === "home" || variant === "vault" || variant === "drive";
  const showHeader = header && !ownTop && !(shape?.backLink ?? false);

  return (
    <div role="status" aria-busy="true" aria-label="Loading" className="reveal-in">
      {shape?.backLink && <Skeleton className="-ml-2 mb-2 h-8 w-40 rounded-[var(--radius-control)]" />}
      {shape?.backLink && header && <SkeletonHeader />}
      {showHeader && <SkeletonHeader />}

      {variant === "home" && (
        <div className="space-y-6">
          <div className="space-y-2">
            <Skeleton className="h-8 w-56 max-w-[70vw]" />
            <Skeleton className="h-4 w-72 max-w-[85vw]" />
          </div>
          <Skeleton className="h-[60px] w-full rounded-[var(--radius-card)]" />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
            <div className="h-64 rounded-[var(--radius-card)] border border-border bg-surface p-5 lg:col-span-8">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="mt-2 h-3 w-56 max-w-full" />
              <div className="mt-4 space-y-2.5">
                {Array.from({ length: 3 }, (_, i) => (
                  <Skeleton key={i} className="h-14 w-full rounded-[var(--radius-control)]" />
                ))}
              </div>
            </div>
            <div className="h-40 rounded-[var(--radius-card)] border border-border bg-surface p-5 lg:col-span-4">
              <Skeleton className="h-4 w-32" />
              <div className="mt-4 space-y-2">
                {Array.from({ length: 2 }, (_, i) => (
                  <Skeleton key={i} className="h-12 w-full rounded-[var(--radius-control)]" />
                ))}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="h-[116px] rounded-[var(--radius-card)] border border-border bg-surface p-3 sm:p-4">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-7 w-7 rounded-lg" />
                  <Skeleton className="h-3 w-16" />
                </div>
                <Skeleton className="mt-4 h-6 w-14" />
                <Skeleton className="mt-3 h-2.5 w-20" />
              </div>
            ))}
          </div>
          <div className="h-56 rounded-[var(--radius-card)] border border-border bg-surface p-5">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="mt-6 h-36 w-full rounded-lg" />
          </div>
        </div>
      )}

      {variant === "vault" && (
        <div className="mx-auto mt-16 max-w-sm text-center">
          <Skeleton className="mx-auto h-14 w-14 rounded-2xl" />
          <Skeleton className="mx-auto mt-3 h-6 w-36" />
          <Skeleton className="mx-auto mt-2 h-3 w-56 max-w-[80vw]" />
          <div className="mt-6 space-y-3 rounded-[var(--radius-card)] border border-border bg-surface p-5 text-left">
            <Skeleton className="h-9 w-full rounded-[var(--radius-control)]" />
            <Skeleton className="h-9 w-full rounded-[var(--radius-control)]" />
          </div>
        </div>
      )}

      {variant === "drive" && (
        <div className="space-y-5">
          {/* header card: icon + title/subtitle + account pill */}
          <div className="flex flex-col gap-4 rounded-[var(--radius-card)] border border-border bg-surface px-4 py-4 sm:flex-row sm:items-center sm:px-5">
            <div className="flex min-w-0 flex-1 items-center gap-4">
              <Skeleton className="h-11 w-11 shrink-0 rounded-xl" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-6 w-40" />
                <Skeleton className="h-3 w-64 max-w-[70vw]" />
              </div>
            </div>
            <Skeleton className="h-10 w-full rounded-full sm:w-56" />
          </div>
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
            <div className="min-w-0 space-y-5">
              {/* destination card: header row + 6-cell folder grid */}
              <div className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
                <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
                  <Skeleton className="h-4 w-4 shrink-0 rounded" />
                  <Skeleton className="h-3.5 w-24" />
                  <Skeleton className="ml-auto h-8 w-28 rounded-[var(--radius-control)]" />
                </div>
                <div className="grid grid-cols-2 gap-1.5 p-2 sm:grid-cols-3">
                  {Array.from({ length: 6 }, (_, i) => (
                    <Skeleton key={i} className="h-10 rounded-[var(--radius-control)]" />
                  ))}
                </div>
              </div>
              {/* dashed drop zone */}
              <Skeleton className="h-44 w-full rounded-[var(--radius-card)]" />
            </div>
            {/* aside (lg only): storage meter + history rows */}
            <aside className="hidden min-w-0 space-y-5 lg:block">
              <div className="rounded-[var(--radius-card)] border border-border bg-surface px-4 py-4">
                <Skeleton className="h-3.5 w-24" />
                <Skeleton className="mt-3 h-1.5 w-full rounded-full" />
                <div className="mt-2 flex items-center justify-between">
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-3 w-16" />
                </div>
              </div>
              <div className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
                <div className="border-b border-border px-4 py-3"><Skeleton className="h-3.5 w-32" /></div>
                <div className="divide-y divide-border">
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
              </div>
            </aside>
          </div>
        </div>
      )}

      {variant === "library" && (
        <>
          <div className="mb-5 space-y-2">
            <SkeletonChipRow n={6} />
            <Skeleton className="h-9 w-full rounded-[var(--radius-control)] sm:max-w-xs" />
            <SkeletonChipRow n={5} />
            <SkeletonChipRow n={5} />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: rows }, (_, i) => (
              <SkeletonCard key={i} height="h-[176px]" />
            ))}
          </div>
        </>
      )}

      {variant === "list" && (
        <div className="space-y-2">
          {Array.from({ length: rows }, (_, i) => (
            <SkeletonRow key={i} />
          ))}
        </div>
      )}

      {variant === "cards" && shape && (
        <>
          {header && shape.action && <Skeleton className="-mt-2 mb-5 h-10 w-32 rounded-[var(--radius-control)] sm:hidden" />}
          {header && shape.filters > 0 && (
            <div className="mb-5 space-y-2">
              {Array.from({ length: shape.filters }, (_, i) => (
                <SkeletonChipRow key={i} n={5} />
              ))}
            </div>
          )}
          <div className={cn("grid gap-4", shape.grid)}>
            {Array.from({ length: rows }, (_, i) =>
              shape.kind === "prompt" ? (
                <SkeletonPromptCard key={i} height={shape.cardH} />
              ) : shape.kind === "row" ? (
                <SkeletonRowCard key={i} height={shape.cardH} />
              ) : (
                <SkeletonCard key={i} height={shape.cardH} />
              ),
            )}
          </div>
        </>
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
