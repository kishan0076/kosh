/**
 * Serialize async critical sections by string key, in-process. A promise chain per key so concurrent
 * read-modify-write sequences — which the Store can't do atomically (no conditional/compare-and-set) —
 * can't interleave and lose updates. Enough to close the race for a single API instance and for the
 * default in-memory store; a horizontally-scaled mongoose deployment additionally needs a DB-level
 * conditional update (unique index, $inc, or a transaction) for the same guarantee.
 *
 * The key map is self-pruning: an entry is removed once its chain drains and no newer holder replaced it,
 * so per-id keys (per pack, per item) don't grow the map without bound.
 */
const chains = new Map<string, Promise<unknown>>();

export function withKeyLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(key) ?? Promise.resolve();
  const run = prev.then(fn, fn); // run regardless of the previous holder's outcome
  const wrapper = run.then(
    () => {},
    () => {},
  ); // never let a rejection poison the chain
  chains.set(key, wrapper);
  void wrapper.then(() => {
    // Drop the key only if we're still the tail (no newer caller queued behind us).
    if (chains.get(key) === wrapper) chains.delete(key);
  });
  return run;
}
