import { randomBytes } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { config } from "../config.js";
import { getStore, type ServerUser } from "../db/index.js";
import { ah, badRequest, forbidden, unauthorized } from "../errors.js";
import { getOrCreateUser, newEmailToken, publicUser } from "./users.js";
import { requireUser, requireWrite } from "./middleware.js";
import { encryptSecret, verifyPassword } from "./crypto.js";
import { isProviderId } from "../integrations/aiProviders.js";
import { githubGrantPatch } from "../integrations/githubToken.js";
import { SESSION_COOKIE, signSession, signState, verifyState } from "./jwt.js";
import { generateApiKey } from "./apikey.js";

export const authRouter: Router = Router();

const cookieOpts = () =>
  ({
    httpOnly: true,
    sameSite: "lax" as const,
    secure: config.cookieSecure,
    path: "/",
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });

function allowed(login: string): boolean {
  return config.allowedLogins.length === 0 || config.allowedLogins.includes(login);
}

// CSRF for the login OAuth flow: a random nonce echoed in the URL and set as a short-lived cookie, then
// compared on the callback (double-submit). Without it a forged callback could log a victim into an
// attacker-controlled GitHub account.
const LOGIN_STATE_COOKIE = "kosh_login_state";
const loginStateCookieOpts = () => ({ httpOnly: true, sameSite: "lax" as const, secure: config.cookieSecure, path: "/", maxAge: 10 * 60 * 1000 });

/** Dev login — allowlisted, no OAuth app required (default in non-prod). */
authRouter.post(
  "/auth/dev-login",
  ah(async (req, res) => {
    if (!config.devLogin) throw forbidden("Dev login is disabled.");
    const { login, name, client } = z
      .object({ login: z.string().min(1).max(64), name: z.string().max(120).optional(), client: z.enum(["web", "mobile"]).optional() })
      .parse(req.body);
    if (!allowed(login)) throw forbidden(`${login} is not on the allowlist.`);
    const user = await getOrCreateUser({ login, name });
    const token = await signSession(user.id);
    res.cookie(SESSION_COOKIE, token, cookieOpts());
    // The native app can't rely on the cookie — hand it the session token to send as a Bearer header.
    res.json(client === "mobile" ? { user: publicUser(user), token } : { user: publicUser(user) });
  }),
);

/**
 * Admin email + password login (env-configured). Works on web (cookie) and the mobile app (Bearer
 * token), with no OAuth app or dev-login needed — ideal for the packaged APK. Only active when both
 * ADMIN_EMAIL and a secret (ADMIN_PASSWORD or ADMIN_PASSWORD_HASH) are set. Rate-limited by the shared
 * /auth bucket (30/min/IP). Failures are generic (never reveal which of email/password was wrong) and
 * the password check is constant-time.
 */
authRouter.post(
  "/auth/password",
  ah(async (req, res) => {
    const secret = config.admin.passwordHash || config.admin.password;
    if (!config.admin.email || !secret) throw forbidden("Password login isn't configured on this server.");
    const { email, password, client } = z
      .object({ email: z.string().min(1).max(320), password: z.string().min(1).max(200), client: z.enum(["web", "mobile"]).optional() })
      .parse(req.body);
    // Always run the password check (constant-time) even on an email mismatch, so response timing can't
    // be used to probe the admin email.
    const emailOk = email.trim().toLowerCase() === config.admin.email;
    const pwOk = verifyPassword(password, secret);
    if (!emailOk || !pwOk) throw unauthorized("Invalid email or password.");
    // The admin identity's login is the email (which config.vault.adminLogin defaults to), so this user is
    // the vault admin.
    const user = await getOrCreateUser({ login: config.admin.email, name: config.admin.name });
    const token = await signSession(user.id);
    res.cookie(SESSION_COOKIE, token, cookieOpts());
    res.json(client === "mobile" ? { user: publicUser(user), token } : { user: publicUser(user) });
  }),
);

/** GitHub OAuth (only active when a client id/secret are configured). */
authRouter.get("/auth/github", (req, res) => {
  if (!config.github.clientId || !config.github.clientSecret) {
    res.status(501).json({ error: { code: "OAUTH_DISABLED", message: "GitHub OAuth is not configured. Use dev login." } });
    return;
  }
  const redirect = `${config.apiUrl}/api/auth/github/callback`;
  // `?client=mobile` marks a login started from the native app (in the system browser); the callback then
  // returns to the app via its deep link instead of the web URL. The suffix rides inside the CSRF state.
  const client = req.query.client === "mobile" ? "mobile" : "web";
  const state = `${randomBytes(16).toString("hex")}.${client}`;
  res.cookie(LOGIN_STATE_COOKIE, state, loginStateCookieOpts());
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", config.github.clientId);
  url.searchParams.set("redirect_uri", redirect);
  // read:user for the profile; repo so users can create + push repos from Kosh (§publish).
  url.searchParams.set("scope", "read:user repo");
  url.searchParams.set("state", state);
  res.redirect(url.toString());
});

authRouter.get(
  "/auth/github/callback",
  ah(async (req, res) => {
    if (!config.github.clientId || !config.github.clientSecret) throw forbidden("OAuth disabled.");
    // Verify the CSRF state (double-submit): the URL value must match the cookie we set at /auth/github.
    const state = String(req.query.state ?? "");
    const cookieState = String((req.cookies as Record<string, string> | undefined)?.[LOGIN_STATE_COOKIE] ?? "");
    res.clearCookie(LOGIN_STATE_COOKIE, { path: "/" });
    if (!state || !cookieState || state !== cookieState) throw forbidden("Invalid or missing OAuth state.");
    const code = String(req.query.code ?? "");
    if (!code) throw unauthorized("Missing OAuth code.");
    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: config.github.clientId, client_secret: config.github.clientSecret, code }),
    });
    const tokenJson = (await tokenRes.json()) as { access_token?: string; scope?: string; refresh_token?: string; expires_in?: number; refresh_token_expires_in?: number };
    const accessToken = tokenJson.access_token;
    if (!accessToken) throw unauthorized("OAuth exchange failed.");
    const meRes = await fetch("https://api.github.com/user", { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/vnd.github+json" } });
    const gh = (await meRes.json()) as { id: number; login: string; name?: string; avatar_url?: string };
    if (!allowed(gh.login)) throw forbidden(`${gh.login} is not on the allowlist.`);
    const user = await getOrCreateUser({ githubId: String(gh.id), login: gh.login, name: gh.name, avatarUrl: gh.avatar_url });
    // Persist the refresh token + expiries too (when the app issues expiring tokens) so the login token
    // auto-renews just like the "Connect GitHub" one.
    await getStore().users.updateById(user.id, githubGrantPatch({
      accessToken,
      scopes: (tokenJson.scope ?? "").split(/[,\s]+/).map((s) => s.trim()).filter(Boolean),
      refreshToken: tokenJson.refresh_token,
      expiresIn: typeof tokenJson.expires_in === "number" ? tokenJson.expires_in : undefined,
      refreshTokenExpiresIn: typeof tokenJson.refresh_token_expires_in === "number" ? tokenJson.refresh_token_expires_in : undefined,
    }));
    const token = await signSession(user.id);
    res.cookie(SESSION_COOKIE, token, cookieOpts());
    if (state.endsWith(".mobile")) {
      // Native app: never put the 30-day session in a URL. Hand back a 2-minute, single-use exchange
      // code via the app's deep link; the app swaps it for the session token over POST.
      const code = await signState(user.id, MOBILE_EXCHANGE_PURPOSE, undefined, { client: "mobile", ttl: "2m" });
      res.redirect(`${config.mobileScheme}://auth?code=${encodeURIComponent(code)}`);
      return;
    }
    res.redirect(config.appUrl);
  }),
);

authRouter.post("/auth/logout", (_req, res) => {
  res.clearCookie(SESSION_COOKIE, { path: "/" });
  res.json({ ok: true });
});

/* ── Native (mobile) auth ───────────────────────────────────────
 * The OAuth login runs in the system browser and lands back in the app via kosh://auth?code=…; the app
 * exchanges that one-time code here for the Bearer session token it stores. Codes are stateless JWTs
 * (2-minute TTL) plus an in-memory single-use ledger so a leaked/replayed URL can't mint a second session. */
const MOBILE_EXCHANGE_PURPOSE = "mobile-exchange";
const usedExchangeCodes = new Map<string, number>(); // code -> expiry (ms)
function markExchangeUsed(code: string): boolean {
  const now = Date.now();
  for (const [k, exp] of usedExchangeCodes) if (exp < now) usedExchangeCodes.delete(k); // prune
  if (usedExchangeCodes.has(code)) return false;
  usedExchangeCodes.set(code, now + 3 * 60 * 1000);
  return true;
}

authRouter.post(
  "/auth/mobile/exchange",
  ah(async (req, res) => {
    const { code } = z.object({ code: z.string().min(10).max(2000) }).parse(req.body);
    const verified = await verifyState(code, MOBILE_EXCHANGE_PURPOSE);
    if (!verified || !markExchangeUsed(code)) throw unauthorized("This sign-in link has expired — try again.");
    const user = await getStore().users.findById(verified.uid);
    if (!user) throw unauthorized();
    res.json({ token: await signSession(user.id), user: publicUser(user) });
  }),
);

authRouter.get(
  "/me",
  ah(async (req, res) => {
    const uid = requireUser(req);
    let user = await getStore().users.findById(uid);
    if (!user) throw unauthorized();
    // Backfill the inbound-email token for users created before it existed.
    if (!user.emailToken) user = (await getStore().users.updateById(uid, { emailToken: newEmailToken() })) ?? user;
    res.json({ user: publicUser(user) });
  }),
);

/* ── API keys ─────────────────────────────────────────────── */
authRouter.get(
  "/settings/api-keys",
  ah(async (req, res) => {
    const uid = requireUser(req);
    const keys = await getStore().apiKeys.find({ userId: uid, revokedAt: null }, { sort: { createdAt: -1 } });
    res.json({ apiKeys: keys.map((k) => ({ id: k.id, name: k.name, prefix: k.prefix, scopes: k.scopes, lastUsedAt: k.lastUsedAt, createdAt: k.createdAt })) });
  }),
);

authRouter.post(
  "/settings/api-keys",
  ah(async (req, res) => {
    const uid = requireUser(req);
    const { name, scopes } = z
      .object({ name: z.string().min(1).max(80), scopes: z.array(z.enum(["read", "write"])).default(["read", "write"]) })
      .parse(req.body);
    const { key, prefix, hash } = generateApiKey();
    const record = await getStore().apiKeys.create({
      userId: uid,
      name,
      prefix,
      keyHash: hash,
      scopes,
      createdAt: new Date().toISOString(),
    });
    res.status(201).json({ apiKey: { id: record.id, name, prefix, scopes, createdAt: record.createdAt }, key });
  }),
);

authRouter.delete(
  "/settings/api-keys/:id",
  ah(async (req, res) => {
    const uid = requireUser(req);
    const record = await getStore().apiKeys.findById(String(req.params.id));
    if (!record || record.userId !== uid) throw unauthorized();
    await getStore().apiKeys.updateById(record.id, { revokedAt: new Date().toISOString() });
    res.json({ ok: true });
  }),
);

/* ── AI provider settings ─────────────────────────────────────────
 * Pick which model provider runs the AI features, optionally override the model, and tune the daily
 * spend cap. BYOK keys (below) are encrypted at rest and never returned — publicUser exposes only a
 * per-provider boolean. Server env keys act as a fallback when the user hasn't stored their own. */
authRouter.patch(
  "/settings/ai",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const { provider, model, spendCap } = z
      .object({
        provider: z.string().max(40).optional(),
        model: z.string().max(120).optional(), // "" clears the override → provider default
        spendCap: z.number().min(0).max(100).optional(),
      })
      .parse(req.body);
    const store = getStore();
    const user = await store.users.findById(uid);
    if (!user) throw unauthorized();

    const patch: Partial<ServerUser> = {};
    if (provider !== undefined) {
      if (!isProviderId(provider)) throw badRequest("BAD_PROVIDER", "Unknown AI provider.");
      patch.aiProvider = provider;
      // A model override belongs to the provider it was set for — drop it when the provider changes,
      // unless the same request also sets a new model.
      if (provider !== user.aiProvider && model === undefined) patch.aiModel = undefined;
    }
    if (model !== undefined) patch.aiModel = model.trim() || undefined;
    if (spendCap !== undefined) patch.aiSpendCap = Math.round(spendCap * 100) / 100;

    const updated = (await store.users.updateById(uid, patch)) ?? user;
    res.json({ user: publicUser(updated) });
  }),
);

/** Store a bring-your-own-key for a provider (encrypted at rest). Read-modify-write of the aiKeys map,
 *  since the persistence layer patches whole fields (no sub-key $set). */
authRouter.put(
  "/settings/ai/keys/:provider",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const provider = String(req.params.provider);
    if (!isProviderId(provider)) throw badRequest("BAD_PROVIDER", "Unknown AI provider.");
    // Reject control chars (CR/LF/NUL/DEL): the key becomes an `Authorization: Bearer …` header, and
    // this stops header-injection at the edge (undici would also throw, but fail fast with a clear error).
    const { key } = z.object({ key: z.string().trim().min(1).max(400).regex(/^[^\u0000-\u001F\u007F]+$/, "Key contains invalid characters.") }).parse(req.body);
    const store = getStore();
    const user = await store.users.findById(uid);
    if (!user) throw unauthorized();
    const aiKeys = { ...(user.aiKeys ?? {}), [provider]: encryptSecret(key) };
    const updated = (await store.users.updateById(uid, { aiKeys })) ?? user;
    res.json({ user: publicUser(updated) });
  }),
);

/** Remove a stored BYOK key (the server env key, if any, becomes the fallback again). */
authRouter.delete(
  "/settings/ai/keys/:provider",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    const provider = String(req.params.provider);
    if (!isProviderId(provider)) throw badRequest("BAD_PROVIDER", "Unknown AI provider.");
    const store = getStore();
    const user = await store.users.findById(uid);
    if (!user) throw unauthorized();
    const aiKeys = { ...(user.aiKeys ?? {}) };
    delete aiKeys[provider];
    const updated = (await store.users.updateById(uid, { aiKeys })) ?? user;
    res.json({ user: publicUser(updated) });
  }),
);
