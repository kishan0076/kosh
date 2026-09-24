import { randomBytes } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { config } from "../config.js";
import { getStore, type ServerUser } from "../db/index.js";
import { ah, badRequest, forbidden, unauthorized } from "../errors.js";
import { getOrCreateUser, newEmailToken, publicUser } from "./users.js";
import { requireUser, requireWrite } from "./middleware.js";
import { encryptSecret } from "./crypto.js";
import { isProviderId } from "../integrations/aiProviders.js";
import { githubGrantPatch } from "../integrations/githubToken.js";
import { SESSION_COOKIE, signSession } from "./jwt.js";
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
    const { login, name } = z.object({ login: z.string().min(1).max(64), name: z.string().max(120).optional() }).parse(req.body);
    if (!allowed(login)) throw forbidden(`${login} is not on the allowlist.`);
    const user = await getOrCreateUser({ login, name });
    const token = await signSession(user.id);
    res.cookie(SESSION_COOKIE, token, cookieOpts());
    res.json({ user: publicUser(user) });
  }),
);

/** GitHub OAuth (only active when a client id/secret are configured). */
authRouter.get("/auth/github", (_req, res) => {
  if (!config.github.clientId || !config.github.clientSecret) {
    res.status(501).json({ error: { code: "OAUTH_DISABLED", message: "GitHub OAuth is not configured. Use dev login." } });
    return;
  }
  const redirect = `${config.apiUrl}/api/auth/github/callback`;
  const state = randomBytes(16).toString("hex");
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
    res.redirect(config.appUrl);
  }),
);

authRouter.post("/auth/logout", (_req, res) => {
  res.clearCookie(SESSION_COOKIE, { path: "/" });
  res.json({ ok: true });
});

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
