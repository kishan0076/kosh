import { relativeTime } from "@kosh/shared";

/** Wrap shared relativeTime with the current clock (kept out of pure shared code). */
export function ago(iso?: string): string {
  if (!iso) return "";
  return relativeTime(iso, Date.now());
}

/** Format an ISO date as e.g. "Sep 12, 2026". */
export function shortDate(iso?: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** ISO string for `days` ago from now. */
export function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

/** ISO string for `hours` ago from now. */
export function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 3_600_000).toISOString();
}
