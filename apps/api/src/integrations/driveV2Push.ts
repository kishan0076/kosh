import { randomUUID } from "node:crypto";
import type { Response } from "express";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { getStore } from "../db/index.js";
import { decryptSecret } from "../auth/crypto.js";
import { refreshAccessToken } from "./googleDrive.js";
import { getStartPageToken, GoogleGoneError, listChanges, stopChannel, watchChanges, type DriveChange } from "./googleDriveV2.js";

/**
 * Drive V2 push-sync hub (changes.watch → server webhook → SSE to the browser).
 *
 * Google's `changes.watch` POSTs a headers-only ping to a PUBLIC callback whenever the user's Drive
 * changes; the server then polls `changes.list` and fans the resulting changes out to any connected
 * browser tabs over Server-Sent Events. This makes sync near-instant instead of poll-latency.
 *
 * State is IN-MEMORY and per-process (SSE sockets can't be shared across instances anyway). On restart
 * the registry is empty, so pings for pre-restart channels are ignored (harmless) and simply expire on
 * Google's side; browsers reconnect their SSE and a fresh channel is opened. Single-instance only —
 * a multi-instance deployment would need a shared registry + pub/sub (documented, not built).
 */

interface Channel {
  channelId: string;
  resourceId: string;
  accountId: string;
  userId: string;
  token: string; // per-channel secret echoed in X-Goog-Channel-Token
  pageToken: string; // advanced as we drain changes.list
  expiration: number; // ms epoch
}

const CHANNEL_TTL_MS = 6 * 60 * 60 * 1000; // 6h (Drive caps ≈24h; renew well before)
const RENEW_BUFFER_MS = 10 * 60 * 1000; // renew 10 min before expiry
const RENEW_RETRY_MS = 60 * 1000; // retry a failed renewal after a minute (still inside the buffer)
const TEARDOWN_GRACE_MS = 2 * 60 * 1000; // keep a channel briefly after the last tab leaves
const MAX_DRAIN_PAGES = 10; // changes.list pages per notification burst

const subscribers = new Map<string, Set<Response>>(); // accountId → open SSE responses
const channelsById = new Map<string, Channel>();
const channelByAccount = new Map<string, string>();
const pollLocks = new Set<string>(); // channelId currently polling (coalesce bursts)
const pendingWatch = new Set<string>(); // accountId whose channel is being (re)created — avoid duplicates
const renewTimers = new Map<string, ReturnType<typeof setTimeout>>();
const teardownTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function pushEnabled(): boolean {
  return !!config.google.webhookUrl;
}

/** Mint a fresh access token for an account from its encrypted refresh token. */
async function mintFor(accountId: string): Promise<{ token: string; userId: string } | null> {
  const acc = await getStore().driveAccounts.findById(accountId);
  if (!acc) return null;
  const refresh = decryptSecret(acc.refreshToken);
  if (!refresh) return null;
  const { accessToken } = await refreshAccessToken(refresh);
  return { token: accessToken, userId: acc.userId };
}

/* ── SSE subscribers ── */

export function addSubscriber(accountId: string, res: Response): void {
  cancelTeardown(accountId);
  let set = subscribers.get(accountId);
  if (!set) {
    set = new Set();
    subscribers.set(accountId, set);
  }
  set.add(res);
}

export function removeSubscriber(accountId: string, res: Response): void {
  const set = subscribers.get(accountId);
  if (!set) return;
  set.delete(res);
  if (!set.size) {
    subscribers.delete(accountId);
    scheduleTeardown(accountId); // no tabs left — stop the channel after a short grace period
  }
}

function broadcast(accountId: string, payload: unknown): void {
  const set = subscribers.get(accountId);
  if (!set || !set.size) return;
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of set) {
    try {
      res.write(data);
    } catch {
      /* a dead socket is cleaned up by its own 'close' handler */
    }
  }
}

/* ── channel lifecycle ── */

/** Ensure a live watch channel exists for the account. Resolves TRUE only when a channel is confirmed
 *  live (existing-and-valid, or freshly created) so the caller can honestly tell the browser whether
 *  push is really active — otherwise the UI would show "Live" while receiving nothing. */
export async function ensureWatch(accountId: string, userId: string): Promise<boolean> {
  if (!pushEnabled()) return false;
  const existingId = channelByAccount.get(accountId);
  if (existingId) {
    const ch = channelsById.get(existingId);
    if (ch && ch.expiration - RENEW_BUFFER_MS > Date.now()) return true; // still valid
  }
  return createWatch(accountId, userId);
}

/** Create (or replace) the account's watch channel. Returns true on success, false on any failure —
 *  never throws — so both the /events route and the renew timer can branch on the result. */
async function createWatch(accountId: string, userId: string): Promise<boolean> {
  if (!pushEnabled()) return false;
  if (pendingWatch.has(accountId)) return false; // another (re)create is in flight — one channel per account
  pendingWatch.add(accountId);
  try {
    const minted = await mintFor(accountId);
    if (!minted) return false;
    const oldId = channelByAccount.get(accountId);
    const old = oldId ? channelsById.get(oldId) : undefined;
    // On RENEWAL continue from where the old channel left off so nothing is dropped; on a FRESH watch
    // (no prior channel) anchor at "now" (user corpus — includes Shared-Drive changes).
    const startToken = old?.pageToken ?? (await getStartPageToken(minted.token));
    const channelId = randomUUID();
    const token = randomUUID();
    const watch = await watchChanges(minted.token, startToken, { channelId, address: config.google.webhookUrl!, token, ttlMs: CHANNEL_TTL_MS });
    const ch: Channel = { channelId, resourceId: watch.resourceId, accountId, userId, token, pageToken: startToken, expiration: watch.expiration ?? Date.now() + CHANNEL_TTL_MS };
    channelsById.set(channelId, ch);
    channelByAccount.set(accountId, channelId);
    scheduleRenew(ch);
    // Stop the previous channel (if any) now that the replacement is live.
    if (oldId && oldId !== channelId) {
      channelsById.delete(oldId);
      clearRenew(oldId);
      if (old) void stopChannel(minted.token, old.channelId, old.resourceId).catch(() => {});
    }
    logger.info({ accountId, channelId }, "drive-v2 push: watch started");
    // A renewal carried the token forward — the new channel only pings on FUTURE changes, so drain
    // anything that happened since (incl. pages the old channel hadn't finished) right away.
    if (old) void pollAndBroadcast(ch);
    return true;
  } catch (e) {
    logger.warn({ e, accountId }, "drive-v2 push: watch create failed");
    return false;
  } finally {
    pendingWatch.delete(accountId);
  }
}

function scheduleRenew(ch: Channel): void {
  clearRenew(ch.channelId);
  const delay = Math.max(60_000, ch.expiration - RENEW_BUFFER_MS - Date.now());
  const t = setTimeout(() => {
    // Only renew while someone is still listening; otherwise let it lapse.
    if (!subscribers.get(ch.accountId)?.size) {
      void teardownAccount(ch.accountId).catch(() => {});
      return;
    }
    void (async () => {
      const ok = await createWatch(ch.accountId, ch.userId);
      // A transient renewal failure must NOT permanently kill push — retry before the channel expires,
      // as long as this is still the account's channel and someone is listening. (createWatch no longer
      // throws; it reports success/failure via its boolean.)
      if (!ok && channelByAccount.get(ch.accountId) === ch.channelId && subscribers.get(ch.accountId)?.size) {
        logger.warn({ accountId: ch.accountId }, "drive-v2 push: renew failed, retrying");
        const retry = setTimeout(() => { if (subscribers.get(ch.accountId)?.size) void createWatch(ch.accountId, ch.userId); }, RENEW_RETRY_MS);
        retry.unref?.();
        renewTimers.set(ch.channelId, retry);
      }
    })();
  }, delay);
  t.unref?.();
  renewTimers.set(ch.channelId, t);
}

function clearRenew(channelId: string): void {
  const t = renewTimers.get(channelId);
  if (t) {
    clearTimeout(t);
    renewTimers.delete(channelId);
  }
}

function scheduleTeardown(accountId: string): void {
  cancelTeardown(accountId);
  const t = setTimeout(() => {
    if (!subscribers.get(accountId)?.size) void teardownAccount(accountId).catch(() => {});
  }, TEARDOWN_GRACE_MS);
  t.unref?.();
  teardownTimers.set(accountId, t);
}

function cancelTeardown(accountId: string): void {
  const t = teardownTimers.get(accountId);
  if (t) {
    clearTimeout(t);
    teardownTimers.delete(accountId);
  }
}

/** Stop and forget the account's channel (best-effort channels.stop). */
export async function teardownAccount(accountId: string): Promise<void> {
  cancelTeardown(accountId);
  const channelId = channelByAccount.get(accountId);
  if (!channelId) return;
  const ch = channelsById.get(channelId);
  channelByAccount.delete(accountId);
  channelsById.delete(channelId);
  clearRenew(channelId);
  if (ch) {
    const minted = await mintFor(accountId).catch(() => null);
    if (minted) await stopChannel(minted.token, ch.channelId, ch.resourceId).catch(() => {});
    logger.info({ accountId, channelId }, "drive-v2 push: watch stopped");
  }
}

/* ── incoming notification (from the webhook route) ── */

export async function handleNotification(h: { channelId?: string; token?: string; state?: string }): Promise<void> {
  if (!h.channelId) return;
  const ch = channelsById.get(h.channelId);
  if (!ch) return; // unknown/expired channel — ignore (e.g. after a restart)
  if (h.token !== ch.token) {
    logger.warn({ channelId: h.channelId }, "drive-v2 push: rejected notification (bad channel token)");
    return;
  }
  if (h.state === "sync") return; // the initial handshake ping carries no changes
  await pollAndBroadcast(ch);
}

async function pollAndBroadcast(ch: Channel): Promise<void> {
  if (pollLocks.has(ch.channelId)) return; // coalesce concurrent notifications for the same channel
  // No one is listening (e.g. during the teardown grace window) — don't drain, so the token isn't
  // advanced past changes that would then be lost. The channel is torn down shortly anyway.
  if (!subscribers.get(ch.accountId)?.size) return;
  pollLocks.add(ch.channelId);
  let morePending = false;
  try {
    const minted = await mintFor(ch.accountId);
    if (!minted) return;
    let pageToken = ch.pageToken;
    const collected: DriveChange[] = [];
    for (let i = 0; i < MAX_DRAIN_PAGES; i++) {
      const { changes, newStartPageToken, nextPageToken } = await listChanges(minted.token, pageToken);
      collected.push(...changes);
      pageToken = nextPageToken ?? newStartPageToken ?? pageToken;
      if (!nextPageToken) break;
      if (i === MAX_DRAIN_PAGES - 1) morePending = true; // hit the cap with pages still queued
    }
    ch.pageToken = pageToken;
    if (collected.length) broadcast(ch.accountId, { type: "changes", changes: collected });
  } catch (e) {
    if (e instanceof GoogleGoneError) {
      // The stored page token expired. Left as-is it would poison EVERY future notification (and survive
      // channel renewal, which carries the token forward). Re-anchor at "now" so push works again — the
      // browser's poller/idle-reconcile covers the small gap of changes between the dead token and now.
      try {
        const m = await mintFor(ch.accountId);
        if (m) ch.pageToken = await getStartPageToken(m.token);
        logger.warn({ accountId: ch.accountId }, "drive-v2 push: page token expired, re-anchored");
      } catch (e2) {
        logger.warn({ e: e2, accountId: ch.accountId }, "drive-v2 push: re-anchor after expired token failed");
      }
    } else {
      logger.warn({ e, accountId: ch.accountId }, "drive-v2 push: poll after notification failed");
    }
  } finally {
    pollLocks.delete(ch.channelId);
  }
  // A very large burst exceeded the per-notification page cap — drain the rest promptly rather than
  // waiting for the next ping (only if this channel is still the live one).
  if (morePending && channelsById.get(ch.channelId) === ch) {
    const t = setTimeout(() => void pollAndBroadcast(ch), 500);
    t.unref?.();
  }
}
