import type { Response } from "express";

type Sub = { res: Response };
const subs = new Map<string, Set<Sub>>();

/** Register an SSE client for a user. Returns an unsubscribe fn. */
export function subscribe(userId: string, res: Response): () => void {
  const sub: Sub = { res };
  let set = subs.get(userId);
  if (!set) {
    set = new Set();
    subs.set(userId, set);
  }
  set.add(sub);
  return () => {
    set!.delete(sub);
    if (set!.size === 0) subs.delete(userId);
  };
}

/** Push an event to all of a user's connected clients. */
export function publish(userId: string, event: { kind: string; [k: string]: unknown }) {
  const set = subs.get(userId);
  if (!set) return;
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const { res } of set) {
    try {
      res.write(payload);
    } catch {
      /* client gone; cleaned up on close */
    }
  }
}
