import { createHash } from "node:crypto";
import { refreshAccessToken } from "./googleDrive.js";

/**
 * In-memory access-token cache for Drive V2, shared by the request routes and the push hub.
 *
 * Without it, EVERY list/search/changes poll and every webhook ping did a full OAuth refresh round-trip
 * (and a DB write for lastUsedAt). Google access tokens are valid for ~1h, so we cache the minted token
 * per account until shortly before it expires and reuse it across all callers.
 *
 * The entry is keyed by account AND a fingerprint of the refresh token, so RECONNECTING an account
 * (which issues a new refresh token) is a natural cache miss — no stale-token loop after re-auth.
 * refreshAccessToken throws on invalid_grant/revocation and we never cache a failure, so the next call
 * retries. Single-process, like the push hub.
 */
const cache = new Map<string, { token: string; exp: number; fp: string }>();
const inflight = new Map<string, Promise<string>>(); // account → in-progress refresh (single-flight)
const SKEW_MS = 60_000; // refresh a minute early to avoid using a token that expires mid-request
const fingerprint = (refreshToken: string) => createHash("sha256").update(refreshToken).digest("hex");

export async function accessTokenFor(accountId: string, refreshToken: string): Promise<string> {
  const fp = fingerprint(refreshToken);
  const hit = cache.get(accountId);
  if (hit && hit.fp === fp && hit.exp > Date.now() + SKEW_MS) return hit.token;
  // Single-flight: when a token goes stale the client often fires several calls at once (and each may
  // retry after a 401) — coalesce their refreshes into one round-trip instead of a refresh storm.
  const pending = inflight.get(accountId);
  if (pending) return pending;
  const p = (async () => {
    const { accessToken, expiresIn } = await refreshAccessToken(refreshToken);
    cache.set(accountId, { token: accessToken, exp: Date.now() + expiresIn * 1000, fp });
    return accessToken;
  })();
  inflight.set(accountId, p);
  try {
    return await p;
  } finally {
    inflight.delete(accountId); // never cache a failure — the next call retries
  }
}

/** Drop a cached token (e.g. after a 401 from a Drive call) so the next request re-mints. */
export function invalidateAccessToken(accountId: string): void {
  cache.delete(accountId);
}
