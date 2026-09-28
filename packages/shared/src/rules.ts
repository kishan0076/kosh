import type { Item, Stage } from "./types.js";

/**
 * Automations — "IFTTT for your treasury". A rule matches captured items by simple field conditions and
 * applies actions (tag, set stage, add to a collection, pin, archive). The matcher here is pure and tested;
 * the server runs it once per item after capture/enrichment (no rule can trigger another → no loops).
 */

export type RuleField = "kind" | "linkType" | "repoKind" | "source" | "url" | "title" | "tag";

export interface RuleCondition {
  field: RuleField;
  /** For url/title this is a case-insensitive substring; for the others an exact (case-insensitive) match;
   *  for `tag` it's tag membership. */
  value: string;
}

export type RuleActionType = "addTags" | "setStage" | "addToCollection" | "pin" | "archive";

export interface RuleAction {
  type: RuleActionType;
  /** addTags: comma-separated tags · setStage: a Stage · addToCollection: a collection name. */
  value?: string;
}

export interface AutomationRule {
  id: string;
  name: string;
  enabled: boolean;
  match: "all" | "any";
  conditions: RuleCondition[];
  actions: RuleAction[];
  runCount?: number;
  lastRunAt?: string;
  createdAt: string;
  updatedAt: string;
}

type MatchableItem = Pick<Item, "kind" | "linkType" | "source" | "url" | "title" | "tags"> & { github?: { repoKind?: string } };

function conditionMatches(item: MatchableItem, c: RuleCondition): boolean {
  const v = c.value.trim().toLowerCase();
  if (!v) return false;
  switch (c.field) {
    case "kind": return item.kind.toLowerCase() === v;
    case "linkType": return (item.linkType ?? "").toLowerCase() === v;
    case "repoKind": return (item.github?.repoKind ?? "").toLowerCase() === v;
    case "source": return (item.source ?? "").toLowerCase() === v;
    case "url": return (item.url ?? "").toLowerCase().includes(v);
    case "title": return (item.title ?? "").toLowerCase().includes(v);
    case "tag": return item.tags.some((t) => t.toLowerCase() === v);
    default: return false;
  }
}

/** Does this item satisfy the rule? Empty conditions match everything (an intentional "always" rule). */
export function itemMatchesRule(item: MatchableItem, rule: Pick<AutomationRule, "match" | "conditions">): boolean {
  if (!rule.conditions.length) return true;
  const results = rule.conditions.map((c) => conditionMatches(item, c));
  return rule.match === "any" ? results.some(Boolean) : results.every(Boolean);
}

/** Parse an addTags action value into a clean tag list. */
export function parseRuleTags(value: string | undefined): string[] {
  return [...new Set((value ?? "").split(",").map((t) => t.trim().replace(/^#/, "")).filter(Boolean))];
}

export const RULE_STAGES: Stage[] = ["to-try", "trying", "using", "dropped"];
