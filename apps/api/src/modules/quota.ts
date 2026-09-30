import { getStore } from "../db/index.js";

const DEFAULT_QUOTA = 2 * 1024 * 1024 * 1024; // matches the per-account default set at creation

/**
 * Per-user storage accounting, computed from truth — the user's live file items, deduped by content hash
 * (objects are content-addressed and shared, so the same object referenced by two items counts once). No
 * running counter means nothing to drift; the cost is one items query per upload, which is acceptable.
 */
export async function storageUsage(uid: string): Promise<{ total: number; has: (hash: string) => boolean }> {
  const items = await getStore().items.find({ userId: uid, kind: "file", deletedAt: null });
  const sizes = new Map<string, number>();
  for (const i of items) {
    const o = i.fileObject;
    if (o?.objectId) sizes.set(o.objectId, o.size ?? 0);
  }
  let total = 0;
  for (const s of sizes.values()) total += s;
  return { total, has: (hash) => sizes.has(hash) };
}

export async function quotaFor(uid: string): Promise<number> {
  const user = await getStore().users.findById(uid);
  return user?.storageQuota ?? DEFAULT_QUOTA;
}

/** Recompute usage from truth and persist it on the user, so the UI's storage meter stays accurate. */
export async function refreshStorageUsed(uid: string): Promise<void> {
  const { total } = await storageUsage(uid);
  await getStore().users.updateById(uid, { storageUsed: total }).catch(() => {});
}
