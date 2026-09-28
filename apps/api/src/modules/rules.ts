import { itemMatchesRule, parseRuleTags, slugify, RULE_STAGES, type Stage } from "@kosh/shared";
import { getStore, type ServerCollection, type ServerItem } from "../db/index.js";
import { publish } from "../events.js";
import { toClientItem } from "./ingest.js";
import { enqueue } from "./queue.js";
import { archiveItem } from "./archive.js";
import { logger } from "../logger.js";

const nowIso = () => new Date().toISOString();

/** Resolve a collection by name for a user, creating it if it doesn't exist. */
async function resolveCollectionId(userId: string, name: string): Promise<string | null> {
  const store = getStore();
  const cols = await store.collections.find({ userId });
  const match = cols.find((c) => c.name.toLowerCase() === name.toLowerCase());
  if (match) return match.id;
  const created = await store.collections.create({ userId, name, slug: slugify(name), order: cols.length + 1, color: "#4f46e5" } as Omit<ServerCollection, "id">);
  return created.id;
}

/**
 * Run the user's enabled automation rules against a freshly-captured item and apply their actions.
 * Called once per item (after enrichment for links, after create for other kinds), so a rule can never
 * trigger another — no loops. Returns how many rules matched.
 */
export async function applyRules(userId: string, item: ServerItem): Promise<number> {
  const store = getStore();
  let rules;
  try {
    rules = (await store.rules.find({ userId, enabled: true })).filter((r) => itemMatchesRule(item, r));
  } catch (err) {
    logger.warn({ err, userId }, "applyRules: rule load failed");
    return 0;
  }
  if (!rules.length) return 0;

  const tags = new Set(item.tags);
  const collections = new Set(item.collections);
  let stage: Stage = item.stage;
  let pinned = item.pinned;
  let archive = false;
  let changed = false;

  for (const r of rules) {
    for (const a of r.actions) {
      if (a.type === "addTags") {
        for (const t of parseRuleTags(a.value)) if (!tags.has(t)) { tags.add(t); changed = true; }
      } else if (a.type === "setStage" && a.value && (RULE_STAGES as string[]).includes(a.value)) {
        if (stage !== a.value) { stage = a.value as Stage; changed = true; }
      } else if (a.type === "pin") {
        if (!pinned) { pinned = true; changed = true; }
      } else if (a.type === "addToCollection" && a.value?.trim()) {
        const id = await resolveCollectionId(userId, a.value.trim());
        if (id && !collections.has(id)) { collections.add(id); changed = true; }
      } else if (a.type === "archive" && item.kind === "link" && item.url) {
        archive = true;
      }
    }
    await store.rules.updateById(r.id, { runCount: (r.runCount ?? 0) + 1, lastRunAt: nowIso() }).catch(() => undefined);
  }

  if (changed) {
    const updated = await store.items.updateById(item.id, { tags: [...tags], collections: [...collections], stage, pinned, updatedAt: nowIso() });
    if (updated) publish(userId, { kind: "item.updated", item: toClientItem(updated) });
  }
  if (archive) enqueue(`archive:${item.id}`, () => archiveItem(userId, item.id).then(() => undefined), 3);
  return rules.length;
}
