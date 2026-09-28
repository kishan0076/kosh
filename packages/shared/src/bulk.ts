/**
 * Agentic bulk ops — one instruction ("archive everything I dropped", "tag all github repos #repo and file
 * them under Tools") plans a multi-step change over the library, previews the exact diff, and applies it only
 * on confirm. This module is the pure, tested core:
 *
 *   command ──(AI, or the deterministic parser here)──▶ BulkPlan
 *   BulkPlan + items ──▶ selectBulkItems() ──▶ previewBulkPlan() ──▶ BulkPreview  (what would change)
 *   confirmed itemIds + actions ──▶ (server applies)
 *
 * Selection composes what already exists: the Ask retriever (`retrieveItems`, for "about X") and the
 * Automations matcher (`itemMatchesRule`, for field conditions). Actions reuse the Automations vocabulary
 * plus their safe inverses and a trash action — so bulk ops introduce no new policy of their own.
 */
import type { Item, Stage } from "./types.js";
import { itemMatchesRule, parseRuleTags, RULE_STAGES, type RuleCondition } from "./rules.js";
import { retrieveItems } from "./search.js";

export type BulkActionType =
  | "addTags"
  | "removeTags"
  | "setStage"
  | "addToCollection"
  | "removeFromCollection"
  | "pin"
  | "unpin"
  | "archive"
  | "delete";

/** The set of actions that lose or hide data — the preview flags these so a confirm is deliberate. */
export const DESTRUCTIVE_ACTIONS: ReadonlySet<BulkActionType> = new Set<BulkActionType>(["delete"]);

export interface BulkAction {
  type: BulkActionType;
  /** addTags/removeTags: comma-separated tags · setStage: a Stage · add/removeFromCollection: a name. */
  value?: string;
}

export interface BulkSelect {
  /** Combine the field conditions with all (AND) or any (OR). */
  mode: "all" | "any";
  conditions: RuleCondition[];
  /** Optional natural-language query → lexical retrieval ("about X") before the field filter. */
  query?: string;
}

export interface BulkPlan {
  /** A one-line human summary of what this will do (shown above the diff). */
  summary: string;
  select: BulkSelect;
  actions: BulkAction[];
}

export interface ItemEffect {
  type: BulkActionType;
  label: string;
  destructive?: boolean;
}

export interface BulkChange {
  itemId: string;
  title: string;
  effects: ItemEffect[];
}

export interface BulkPreview {
  plan: BulkPlan;
  /** Items considered (the live library size). */
  total: number;
  /** Items the selection matched. */
  matched: number;
  /** Per-item effects, only for items the plan actually changes. */
  changes: BulkChange[];
  /** True if any action in the plan is destructive. */
  destructive: boolean;
}

const label = (i: Pick<Item, "title" | "url" | "id">): string => i.title || i.url || "Untitled";

/** Select the items a plan targets: optional lexical retrieval, then the field-condition matcher. */
export function selectBulkItems<T extends Item>(items: T[], select: BulkSelect): T[] {
  const q = select.query?.trim();
  const pool = q ? retrieveItems(items, q).map((h) => h.item) : items;
  if (!select.conditions.length) return pool;
  return pool.filter((i) => itemMatchesRule(i, { match: select.mode, conditions: select.conditions }));
}

/**
 * The concrete effects a set of actions would have on ONE item, skipping no-ops (a tag it already has, a
 * pin when already pinned, an archive when it's not a link…). Collection add/remove is described by name;
 * the server resolves the id and dedupes on apply.
 */
export function describeItemEffects(item: Item, actions: BulkAction[]): ItemEffect[] {
  const effects: ItemEffect[] = [];
  const tags = new Set(item.tags);
  let stage = item.stage;
  let pinned = !!item.pinned;

  for (const a of actions) {
    switch (a.type) {
      case "addTags": {
        const add = parseRuleTags(a.value).filter((t) => !tags.has(t));
        if (add.length) { add.forEach((t) => tags.add(t)); effects.push({ type: a.type, label: `+ ${add.map((t) => `#${t}`).join(" ")}` }); }
        break;
      }
      case "removeTags": {
        const rm = parseRuleTags(a.value).filter((t) => tags.has(t));
        if (rm.length) { rm.forEach((t) => tags.delete(t)); effects.push({ type: a.type, label: `− ${rm.map((t) => `#${t}`).join(" ")}` }); }
        break;
      }
      case "setStage": {
        const s = (a.value ?? "").trim();
        if ((RULE_STAGES as string[]).includes(s) && stage !== s) { const from = stage; stage = s as Stage; effects.push({ type: a.type, label: `stage ${from} → ${stage}` }); }
        break;
      }
      case "addToCollection":
        if (a.value?.trim()) effects.push({ type: a.type, label: `→ collection “${a.value.trim()}”` });
        break;
      case "removeFromCollection":
        if (a.value?.trim()) effects.push({ type: a.type, label: `remove from “${a.value.trim()}”` });
        break;
      case "pin":
        if (!pinned) { pinned = true; effects.push({ type: a.type, label: "pin" }); }
        break;
      case "unpin":
        if (pinned) { pinned = false; effects.push({ type: a.type, label: "unpin" }); }
        break;
      case "archive":
        if (item.kind === "link" && item.url && item.archive?.status !== "ok") effects.push({ type: a.type, label: "archive a snapshot" });
        break;
      case "delete":
        effects.push({ type: a.type, label: "move to trash", destructive: true });
        break;
    }
  }
  return effects;
}

/** Build the full preview: which items match, and the exact per-item effects (no-op items dropped). */
export function previewBulkPlan(items: Item[], plan: BulkPlan): BulkPreview {
  const live = items.filter((i) => !i.deletedAt);
  const matched = selectBulkItems(live, plan.select);
  const changes: BulkChange[] = [];
  for (const it of matched) {
    const effects = describeItemEffects(it, plan.actions);
    if (effects.length) changes.push({ itemId: it.id, title: label(it), effects });
  }
  return {
    plan,
    total: live.length,
    matched: matched.length,
    changes,
    destructive: plan.actions.some((a) => DESTRUCTIVE_ACTIONS.has(a.type)),
  };
}

/* ── deterministic fallback parser (used when AI is off / the cap is hit) ─────────────────────────── */

const KIND_WORDS: Record<string, RuleCondition> = {
  repo: { field: "linkType", value: "repo" }, repos: { field: "linkType", value: "repo" },
  article: { field: "linkType", value: "article" }, articles: { field: "linkType", value: "article" },
  video: { field: "linkType", value: "video" }, videos: { field: "linkType", value: "video" },
  package: { field: "linkType", value: "package" }, packages: { field: "linkType", value: "package" },
  skill: { field: "kind", value: "skill" }, skills: { field: "kind", value: "skill" },
  prompt: { field: "kind", value: "prompt" }, prompts: { field: "kind", value: "prompt" },
  file: { field: "kind", value: "file" }, files: { field: "kind", value: "file" },
  link: { field: "kind", value: "link" }, links: { field: "kind", value: "link" },
};

/**
 * A best-effort natural-language → BulkPlan parser for the common shapes, so bulk ops work with no AI.
 * Recognizes one or more actions (tag/untag/pin/unpin/archive/delete/move to <collection>/mark as <stage>)
 * and filters (from <domain>, <kind> words, tagged <tag>, about/matching <text>). Returns null if it finds
 * no action it understands (the caller then asks the user to rephrase, or relies on AI).
 */
export function parseBulkCommand(command: string): BulkPlan | null {
  const raw = command.trim();
  if (!raw) return null;
  const text = raw.toLowerCase();
  const actions: BulkAction[] = [];
  const conditions: RuleCondition[] = [];
  let query: string | undefined;

  // ── actions ──
  let m: RegExpMatchArray | null;
  // "tag … as/with <tags>" (the tags come after as/with) or "add tag[s] <tags>" (tags right after).
  let tm = text.match(/\btag\b[\s\S]*?\b(?:as|with)\s+([#a-z0-9,\s-]+?)(?=\s+(?:from|to|about|matching|titled|tagged|that|which|where|and)\b|$)/);
  if (!tm) tm = text.match(/\badd tag[s]?\s+([#a-z0-9,\s-]+?)(?=\s+(?:to|from|about|matching|and)\b|$)/);
  if (tm) {
    const tags = parseRuleTags(tm[1]);
    if (tags.length) actions.push({ type: "addTags", value: tags.join(",") });
  }
  if ((m = text.match(/\b(?:untag|remove tag[s]?)\s+([#a-z0-9,\s-]+?)(?=\s+(?:from|to|about|matching|titled|tagged|and)\b|$)/))) {
    const tags = parseRuleTags(m[1]);
    if (tags.length) actions.push({ type: "removeTags", value: tags.join(",") });
  }
  if ((m = text.match(/\b(?:move|file|add)\b.*?\bto\s+(?:the\s+)?([a-z0-9 _-]+?)\s*(?:collection)?(?=\s+(?:from|about|matching|and)\b|$)/))) {
    const name = m[1]?.trim();
    if (name && !KIND_WORDS[name]) actions.push({ type: "addToCollection", value: name });
  }
  if ((m = text.match(/\b(?:mark|set)\b.*?\b(?:as|stage)\s+(to-try|to try|trying|using|dropped)\b/))) {
    const s = m[1] === "to try" ? "to-try" : m[1];
    actions.push({ type: "setStage", value: s });
  }
  if (/\barchive\b/.test(text)) actions.push({ type: "archive" });
  if (/\bunpin\b/.test(text)) actions.push({ type: "unpin" });
  else if (/\bpin\b/.test(text)) actions.push({ type: "pin" });
  if (/\b(delete|trash|remove)\b/.test(text) && !/remove tag|remove from/.test(text)) actions.push({ type: "delete" });

  if (!actions.length) return null;

  // ── filters ──
  for (const [word, cond] of Object.entries(KIND_WORDS)) {
    if (new RegExp(`\\b${word}\\b`).test(text)) { conditions.push(cond); break; }
  }
  if ((m = text.match(/\bfrom\s+([a-z0-9.-]+\.[a-z]{2,})\b/))) conditions.push({ field: "url", value: m[1]! });
  else if ((m = text.match(/\bfrom\s+(github|youtube|reddit|twitter|x|arxiv|medium|substack)\b/))) {
    const host = m[1] === "x" ? "x.com" : m[1] === "twitter" ? "twitter.com" : `${m[1]}.`;
    conditions.push({ field: "url", value: host });
  }
  if ((m = text.match(/\btagged\s+#?([a-z0-9-]+)/))) conditions.push({ field: "tag", value: m[1]! });
  if ((m = text.match(/\b(?:dropped|to-try|trying|using)\b/)) && /\b(dropped|trying|using)\b/.test(text) && !actions.some((a) => a.type === "setStage")) {
    // "everything I dropped" is a filter, not a setStage
  }
  if ((m = text.match(/\b(?:about|matching|regarding|related to)\s+(.+?)(?=\s+and\b|$)/))) query = m[1]?.trim();

  return {
    summary: raw.slice(0, 160),
    select: { mode: "all", conditions, query },
    actions,
  };
}

/** Clamp an untrusted plan (from AI or the client) to the allowed vocabulary and sane bounds. */
export function sanitizeBulkPlan(input: unknown): BulkPlan | null {
  if (!input || typeof input !== "object") return null;
  const o = input as Record<string, unknown>;
  const sel = (o.select ?? {}) as Record<string, unknown>;
  const allowedFields = new Set(["kind", "linkType", "repoKind", "source", "url", "title", "tag"]);
  const allowedActions = new Set<BulkActionType>(["addTags", "removeTags", "setStage", "addToCollection", "removeFromCollection", "pin", "unpin", "archive", "delete"]);

  const conditions: RuleCondition[] = Array.isArray(sel.conditions)
    ? (sel.conditions as unknown[])
        .filter((c): c is RuleCondition => !!c && typeof c === "object" && allowedFields.has((c as RuleCondition).field) && typeof (c as RuleCondition).value === "string")
        .map((c) => ({ field: c.field, value: String(c.value).slice(0, 200) }))
        .slice(0, 10)
    : [];
  const actions: BulkAction[] = Array.isArray(o.actions)
    ? (o.actions as unknown[])
        .filter((a): a is BulkAction => !!a && typeof a === "object" && allowedActions.has((a as BulkAction).type))
        .map((a) => ({ type: a.type, value: typeof a.value === "string" ? a.value.slice(0, 300) : undefined }))
        .slice(0, 10)
    : [];
  if (!actions.length) return null;
  return {
    summary: typeof o.summary === "string" ? o.summary.slice(0, 200) : "",
    select: {
      mode: sel.mode === "any" ? "any" : "all",
      conditions,
      query: typeof sel.query === "string" && sel.query.trim() ? sel.query.trim().slice(0, 200) : undefined,
    },
    actions,
  };
}
