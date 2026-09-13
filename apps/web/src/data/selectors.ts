import type { Item, Skill, Stage, Tool } from "@kosh/shared";
import { STAGES } from "@kosh/shared";

export const live = (items: Item[]): Item[] => items.filter((i) => !i.deletedAt);
export const trashed = (items: Item[]): Item[] => items.filter((i) => !!i.deletedAt);

/** Items whose stage still needs a decision (Inbox = to-try, freshly captured). */
export const inbox = (items: Item[]): Item[] =>
  live(items)
    .filter((i) => i.stage === "to-try")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

export interface KpiDelta {
  value: number;
  deltaPct: number | null;
  direction: "up" | "down" | "flat";
}

function withinDays(iso: string, days: number, now: number): boolean {
  return now - new Date(iso).getTime() <= days * 86_400_000;
}
function betweenDays(iso: string, from: number, to: number, now: number): boolean {
  const age = now - new Date(iso).getTime();
  return age > from * 86_400_000 && age <= to * 86_400_000;
}

/** A KPI comparing the last 30 days vs the prior 30. */
export function periodKpi(items: Item[], now: number, predicate: (i: Item) => boolean): KpiDelta {
  const list = live(items).filter(predicate);
  const value = list.length;
  const current = list.filter((i) => withinDays(i.createdAt, 30, now)).length;
  const prior = list.filter((i) => betweenDays(i.createdAt, 30, 60, now)).length;
  let deltaPct: number | null = null;
  let direction: KpiDelta["direction"] = "flat";
  if (prior > 0) {
    deltaPct = Math.round(((current - prior) / prior) * 100);
    direction = deltaPct > 0 ? "up" : deltaPct < 0 ? "down" : "flat";
  } else if (current > 0) {
    deltaPct = 100;
    direction = "up";
  }
  return { value, deltaPct, direction };
}

export interface HomeStats {
  total: KpiDelta;
  skills: KpiDelta;
  toTry: KpiDelta;
  watched: number;
  copiedSkills: number;
  indexOnlySkills: number;
}

export function homeStats(items: Item[], skills: Skill[], now: number): HomeStats {
  const watched = live(items)
    .filter((i) => i.github?.watch?.enabled)
    .reduce((a, i) => a + (i.github?.watch?.newSince ?? 0), 0);
  return {
    total: periodKpi(items, now, () => true),
    skills: periodKpi(items, now, (i) => i.kind === "skill"),
    toTry: periodKpi(items, now, (i) => i.stage === "to-try"),
    watched,
    copiedSkills: skills.filter((s) => !s.indexOnly && !s.deletedAt).length,
    indexOnlySkills: skills.filter((s) => s.indexOnly && !s.deletedAt).length,
  };
}

/** Daily saved-item counts for the last `days` days (oldest → newest). */
export function savedTrend(items: Item[], days: number, now: number): { label: string; date: string; value: number }[] {
  const buckets: { label: string; date: string; value: number }[] = [];
  const list = live(items);
  for (let d = days - 1; d >= 0; d--) {
    const day = new Date(now - d * 86_400_000);
    const key = day.toISOString().slice(0, 10);
    const value = list.filter((i) => i.createdAt.slice(0, 10) === key).length;
    buckets.push({
      label: day.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      date: key,
      value,
    });
  }
  return buckets;
}

/** Count of items created per weekday (Sun→Sat). */
export function weekdayActivity(items: Item[]): { label: string; value: number }[] {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const counts = new Array(7).fill(0);
  for (const i of live(items)) {
    counts[new Date(i.createdAt).getDay()] += 1;
  }
  return days.map((label, idx) => ({ label, value: counts[idx] }));
}

export function stageFunnel(items: Item[]): { stage: Stage; value: number }[] {
  const list = live(items);
  return STAGES.map((stage) => ({ stage, value: list.filter((i) => i.stage === stage).length }));
}

/** "Using" ÷ ("using" + "dropped") — how much of what you tried you kept. */
export function keepRate(items: Item[]): number {
  const list = live(items);
  const using = list.filter((i) => i.stage === "using").length;
  const dropped = list.filter((i) => i.stage === "dropped").length;
  const denom = using + dropped;
  return denom === 0 ? 0 : Math.round((using / denom) * 100);
}

export function toolBreakdown(skills: Skill[]): { tool: Tool; value: number }[] {
  const tools: Tool[] = ["claude", "codex", "cursor", "gemini", "generic"];
  const counts = new Map<Tool, number>();
  for (const s of skills.filter((s) => !s.deletedAt)) {
    for (const t of s.tools) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return tools.map((tool) => ({ tool, value: counts.get(tool) ?? 0 })).filter((x) => x.value > 0);
}

export function topTags(items: Item[], limit = 12): { tag: string; value: number }[] {
  const counts = new Map<string, number>();
  for (const i of live(items)) for (const t of i.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts.entries()]
    .map(([tag, value]) => ({ tag, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}

export function allTags(items: Item[]): { tag: string; value: number }[] {
  return topTags(items, 999);
}

/** Repos being watched that report new upstream changes. */
export function watchedChanges(items: Item[]): Item[] {
  return live(items).filter((i) => i.github?.watch?.enabled && (i.github?.watch?.newSince ?? 0) > 0);
}

const DAY = 86_400_000;

/** Deterministic 0..1 hash so the daily shortlist is stable within a day. */
function stableHash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 1000;
}

/** Tags used by items already in the "using" stage — your revealed preferences. */
function affinityTags(items: Item[]): Set<string> {
  const set = new Set<string>();
  for (const i of live(items)) if (i.stage === "using") for (const t of i.tags) set.add(t);
  return set;
}

/** Ranked daily shortlist of to-try items to actually try next. Stable per day. */
export function shortlist(items: Item[], now: number, limit = 3): Item[] {
  const today = new Date(now).toISOString().slice(0, 10);
  const affinity = affinityTags(items);
  const candidates = live(items).filter(
    (i) => i.stage === "to-try" && !(i.snoozedUntil && new Date(i.snoozedUntil).getTime() > now),
  );
  const scored = candidates.map((i) => {
    const ageDays = (now - new Date(i.createdAt).getTime()) / DAY;
    const freshness = Math.max(0, 1 - ageDays / 30);
    const tagAffinity = i.tags.length ? i.tags.filter((t) => affinity.has(t)).length / i.tags.length : 0;
    const quickWin = i.kind === "prompt" || i.kind === "skill" || !!i.github?.install?.command ? 1 : 0.4;
    const momentum = i.github?.watch?.newSince ? 1 : 0.5;
    const sourceTrust = i.foundVia?.kind === "person" || i.foundVia?.kind === "list" ? 1 : 0.5;
    const jitter = stableHash(`${today}:${i.id}`) * 0.06;
    const score = freshness * 0.35 + tagAffinity * 0.25 + quickWin * 0.2 + momentum * 0.15 + sourceTrust * 0.05 + jitter;
    return { i, score };
  });
  return scored.sort((a, b) => b.score - a.score).slice(0, limit).map((s) => s.i);
}

export interface AttentionItem {
  id: string;
  kind: "dead" | "risky-skill" | "stale" | "drift";
  itemId: string;
  title: string;
  detail: string;
}

/** To-try items that have gone stale (older than `days`). */
export function staleToTry(items: Item[], now: number, days = 21): Item[] {
  return live(items).filter((i) => i.stage === "to-try" && now - new Date(i.createdAt).getTime() > days * DAY);
}

/** A single prioritized "inbox-zero for your toolbox" list. */
export function needsAttention(items: Item[], skills: Skill[], now: number): AttentionItem[] {
  const out: AttentionItem[] = [];
  for (const i of live(items)) {
    if (i.status === "dead") out.push({ id: `dead-${i.id}`, kind: "dead", itemId: i.id, title: i.title ?? i.url ?? "Untitled", detail: "Dead link — clean up or replace" });
  }
  for (const s of skills.filter((s) => !s.deletedAt)) {
    const v = s.versions.at(-1);
    if (v?.scan.risky && s.trust === "unreviewed" && !s.indexOnly) {
      out.push({ id: `risky-${s.id}`, kind: "risky-skill", itemId: s.itemId, title: s.displayName, detail: `${v.scan.findings.length} scan findings — review before installing` });
    }
  }
  for (const i of staleToTry(items, now)) {
    out.push({ id: `stale-${i.id}`, kind: "stale", itemId: i.id, title: i.title ?? i.url ?? "Untitled", detail: "Sitting in to-try for a while — decide or drop" });
  }
  return out.slice(0, 8);
}

export interface CurationHealth {
  score: number;
  nextBestAction: string;
  components: { label: string; value: number }[];
}

/** One number for how healthy the vault is, plus the single next best action. */
export function curationHealth(items: Item[], skills: Skill[], now: number): CurationHealth {
  const list = live(items);
  const total = Math.max(1, list.length);
  const attention = needsAttention(items, skills, now);
  const dead = list.filter((i) => i.status === "dead").length;
  const stale = staleToTry(items, now).length;
  const risky = skills.filter((s) => !s.deletedAt && s.versions.at(-1)?.scan.risky && s.trust === "unreviewed").length;
  const decided = list.filter((i) => i.stage !== "to-try").length;

  const cleanliness = 1 - Math.min(1, dead / total);
  const freshness = 1 - Math.min(1, stale / total);
  const safety = 1 - Math.min(1, risky / Math.max(1, skills.length));
  const decisiveness = decided / total;

  const score = Math.round((cleanliness * 0.25 + freshness * 0.2 + safety * 0.3 + decisiveness * 0.25) * 100);

  let nextBestAction = "Your vault is in great shape ✨";
  if (risky > 0) nextBestAction = `${risky} risky skill${risky > 1 ? "s need" : " needs"} review`;
  else if (dead > 0) nextBestAction = `${dead} dead link${dead > 1 ? "s" : ""} to clean up`;
  else if (stale > 0) nextBestAction = `${stale} item${stale > 1 ? "s" : ""} stuck in to-try`;
  else if (attention.length) nextBestAction = `${attention.length} things need attention`;

  return {
    score,
    nextBestAction,
    components: [
      { label: "Safety", value: Math.round(safety * 100) },
      { label: "Freshness", value: Math.round(freshness * 100) },
      { label: "Decisiveness", value: Math.round(decisiveness * 100) },
      { label: "Cleanliness", value: Math.round(cleanliness * 100) },
    ],
  };
}

export interface Recommendation {
  id: string;
  reason: string;
  title: string;
  itemId?: string;
  action: string;
}

/** "Because you saved X" — mined from data already stored. */
export function recommendations(items: Item[], _skills: Skill[]): Recommendation[] {
  const out: Recommendation[] = [];
  const list = live(items);

  // uncopied sibling skills inside repos you saved
  for (const i of list) {
    const idx = i.github?.skillIndex;
    if (idx) {
      const uncopied = idx.filter((s) => !s.snapshotted);
      if (uncopied.length && uncopied[0]) {
        out.push({
          id: `sib-${i.id}`,
          reason: `Inside ${i.title}`,
          title: uncopied[0].name,
          itemId: i.id,
          action: "Keep a copy",
        });
      }
    }
  }

  // watched lists with new items
  for (const i of watchedChanges(items)) {
    out.push({ id: `new-${i.id}`, reason: "New upstream", title: `${i.github?.watch?.newSince} new in ${i.title}`, itemId: i.id, action: "Review" });
  }

  // to-try items sharing tags with your "using" set
  const affinity = affinityTags(items);
  for (const i of list) {
    if (i.stage === "to-try" && i.tags.some((t) => affinity.has(t))) {
      const shared = i.tags.find((t) => affinity.has(t));
      out.push({ id: `aff-${i.id}`, reason: `Matches #${shared}`, title: i.title ?? i.url ?? "Untitled", itemId: i.id, action: "Open" });
    }
  }

  return out.slice(0, 4);
}
