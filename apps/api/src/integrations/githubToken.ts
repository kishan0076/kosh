import { getStore } from "../db/index.js";
import { decryptSecret, encryptSecret } from "../auth/crypto.js";
import { logger } from "../logger.js";
import { GithubAuthError, refreshGithubToken, type GithubTokenGrant } from "./github.js";
import type { ServerUser } from "../db/types.js";

/* ── GitHub token provider ───────────────────────────────────────────────────
 * Keeps a user's "Connect GitHub" session alive without manual reconnects. Whether a token expires is
 * a property of the OAuth app: a classic OAuth App with non-expiring tokens issues NO refresh token and
 * NO expiry — we then use the access token forever. A GitHub App / OAuth App with expiring tokens issues
 * an 8-hour access token plus a rotating refresh token (~6-month life); we persist both (encrypted) and
 * mint a fresh access token on demand, so the connection auto-renews and effectively never drops.
 * Mirrors the Drive refresh-token flow (googleDrive.refreshAccessToken + driveAccounts.refreshToken). */

const SKEW_MS = 60_000; // renew a minute early so a token can't expire mid-request

// Serialize refreshes per user: two concurrent requests must not both refresh, or the second would
// present an already-rotated (now invalid) refresh token. A promise chain per user suffices for a single
// API instance; a multi-instance deployment would additionally want a DB lock.
const refreshLocks = new Map<string, Promise<unknown>>();
function withUserLock<T>(uid: string, fn: () => Promise<T>): Promise<T> {
  const prev = refreshLocks.get(uid) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  refreshLocks.set(uid, next.then(() => {}, () => {}));
  return next;
}

/** The encrypted fields to persist for a fresh grant. `githubScopes` is only overwritten when the grant
 *  carries scopes (a refresh response omits them — we carry the prior ones forward instead of wiping). */
export function githubGrantPatch(grant: GithubTokenGrant): Partial<ServerUser> {
  const now = Date.now();
  const patch: Partial<ServerUser> = {
    githubToken: encryptSecret(grant.accessToken),
    githubRefreshToken: grant.refreshToken ? encryptSecret(grant.refreshToken) : undefined,
    githubTokenExpiresAt: grant.expiresIn ? new Date(now + grant.expiresIn * 1000).toISOString() : undefined,
    githubRefreshTokenExpiresAt: grant.refreshTokenExpiresIn ? new Date(now + grant.refreshTokenExpiresIn * 1000).toISOString() : undefined,
  };
  if (grant.scopes.length) patch.githubScopes = grant.scopes.join(" ");
  return patch;
}

/** True once an ISO expiry is within SKEW of now. No expiry recorded → non-expiring token (not expired).
 *  A present-but-unparseable value fails CLOSED (treated as expired) so corruption forces a refresh/
 *  reconnect rather than silently trusting a possibly-dead token. */
function expired(iso: string | undefined): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return true; // corrupt expiry → fail closed
  return t - SKEW_MS <= Date.now();
}

/** A currently-valid GitHub access token for the user, refreshed first if it has expired and a live
 *  refresh token exists. Returns null when the user has NO connection at all. Throws GithubAuthError
 *  when the access token has expired and cannot be refreshed (the caller maps this to NEEDS_RECONNECT). */
export async function getValidGithubToken(uid: string): Promise<string | null> {
  const store = getStore();
  const user = await store.users.findById(uid);
  const access = decryptSecret(user?.githubToken);
  if (!user || !access) return null;

  // Non-expiring token, or still within its lifetime → use as-is.
  if (!expired(user.githubTokenExpiresAt)) return access;

  // Expired: recover only via a live refresh token.
  const refresh = decryptSecret(user.githubRefreshToken);
  if (!refresh || expired(user.githubRefreshTokenExpiresAt)) {
    throw new GithubAuthError("Your GitHub connection has expired. Reconnect GitHub.");
  }
  return withUserLock(uid, async () => {
    // Re-read inside the lock — a concurrent request may have already refreshed it.
    const fresh = await store.users.findById(uid);
    const freshAccess = decryptSecret(fresh?.githubToken);
    if (fresh && freshAccess && !expired(fresh.githubTokenExpiresAt)) return freshAccess;
    const freshRefresh = decryptSecret(fresh?.githubRefreshToken) ?? refresh;
    const grant = await refreshGithubToken(freshRefresh, fresh?.githubScopes);
    await store.users.updateById(uid, githubGrantPatch(grant));
    logger.info({ uid }, "refreshed GitHub access token");
    return grant.accessToken;
  });
}

/** Null-safe variant for opportunistic callers (enrichment, snapshots) that already tolerate no token:
 *  never throws — an expired-and-unrefreshable connection simply degrades to the server/anon token. */
export async function tryGithubToken(uid: string): Promise<string | null> {
  try {
    return await getValidGithubToken(uid);
  } catch {
    return null;
  }
}
