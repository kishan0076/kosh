import { Router } from "express";
import { z } from "zod";
import { config } from "../config.js";
import { getStore } from "../db/index.js";
import { ah, forbidden, unauthorized } from "../errors.js";
import { getOrCreateUser, publicUser } from "./users.js";
import { requireUser } from "./middleware.js";
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
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", config.github.clientId);
  url.searchParams.set("redirect_uri", redirect);
  url.searchParams.set("scope", "read:user");
  res.redirect(url.toString());
});

authRouter.get(
  "/auth/github/callback",
  ah(async (req, res) => {
    if (!config.github.clientId || !config.github.clientSecret) throw forbidden("OAuth disabled.");
    const code = String(req.query.code ?? "");
    if (!code) throw unauthorized("Missing OAuth code.");
    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: config.github.clientId, client_secret: config.github.clientSecret, code }),
    });
    const tokenJson = (await tokenRes.json()) as { access_token?: string };
    const accessToken = tokenJson.access_token;
    if (!accessToken) throw unauthorized("OAuth exchange failed.");
    const meRes = await fetch("https://api.github.com/user", { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/vnd.github+json" } });
    const gh = (await meRes.json()) as { id: number; login: string; name?: string; avatar_url?: string };
    if (!allowed(gh.login)) throw forbidden(`${gh.login} is not on the allowlist.`);
    const user = await getOrCreateUser({ githubId: String(gh.id), login: gh.login, name: gh.name, avatarUrl: gh.avatar_url });
    await getStore().users.updateById(user.id, { githubToken: accessToken });
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
    const user = await getStore().users.findById(uid);
    if (!user) throw unauthorized();
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
