import { randomUUID } from "node:crypto";
import type { Response } from "express";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { getStore } from "../db/index.js";
import { decryptSecret } from "../auth/crypto.js";
import { refreshAccessToken } from "./googleDrive.js";
import { getStartPageToken, listChanges, stopChannel, watchChanges, type DriveChange } from "./googleDriveV2.js";

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

/** Ensure a live watch channel exists for the account (creates or renews as needed). */
export async function ensureWatch(accountId: string, userId: string): Promise<void> {
  if (!pushEnabled()) return;
  const existingId = channelByAccount.get(accountId);
  if (existingId) {
    const ch = channelsById.get(existingId);
    if (ch && ch.expiration - RENEW_BUFFER_MS > Date.now()) return; // still valid
  }
  await createWatch(accountId, userId);
}

async function createWatch(accountId: string, userId: string): Promise<void> {
  if (!pushEnabled()) return;
  if (pendingWatch.has(accountId)) return; // another (re)create is in flight — one channel per account
  pendingWatch.add(accountId);
  try {
    const minted = await mintFor(accountId);
    if (!minted) return;
    const oldId = channelByAccount.get(accountId);
    const startToken = await getStartPageToken(minted.token); // user corpus — includes Shared-Drive changes
    const channelId = randomUUID();
    const token = randomUUID();
    const watch = await watchChanges(minted.token, startToken, { channelId, address: config.google.webhookUrl!, token, ttlMs: CHANNEL_TTL_MS });
    const ch: Channel = { channelId, resourceId: watch.resourceId, accountId, userId, token, pageToken: startToken, expiration: watch.expiration ?? Date.now() + CHANNEL_TTL_MS };
    channelsById.set(channelId, ch);
    channelByAccount.set(accountId, channelId);
    scheduleRenew(ch);
    // Stop the previous channel (if any) now that the replacement is live.
    if (oldId && oldId !== channelId) {
      const old = channelsById.get(oldId);
      channelsById.delete(oldId);
      clearRenew(oldId);
      if (old) void stopChannel(minted.token, old.channelId, old.resourceId).catch(() => {});
    }
    logger.info({ accountId, channelId }, "drive-v2 push: watch started");
  } finally {
    pendingWatch.delete(accountId);
  }
}

function scheduleRenew(ch: Channel): void {
  clearRenew(ch.channelId);
  const delay = Math.max(60_000, ch.expiration - RENEW_BUFFER_MS - Date.now());
  const t = setTimeout(() => {
    // Only renew while someone is still listening; otherwise let it lapse.
    if (subscribers.get(ch.accountId)?.size) void createWatch(ch.accountId, ch.userId).catch((e) => logger.warn({ e }, "drive-v2 push: renew failed"));
    else void teardownAccount(ch.accountId).catch(() => {});
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
    logger.warn({ e, accountId: ch.accountId }, "drive-v2 push: poll after notification failed");
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
