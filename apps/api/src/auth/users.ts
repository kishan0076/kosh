import { randomBytes } from "node:crypto";
import { config } from "../config.js";
import { getStore, type ServerUser } from "../db/index.js";
import { aiAvailableForUser, providerCatalog } from "../integrations/aiProviders.js";

/** Is this user an admin (can manage users)? The operator-configured admin login (KOSH_ADMIN_LOGIN /
 *  ADMIN_EMAIL) is always an admin — a break-glass identity that cannot be demoted from the app. Every
 *  other account is decided by its stored `role`. Legacy accounts with no role fall back to the old
 *  fail-CLOSED rule: admin only in non-production local dev. */
export function isAdmin(user: ServerUser | null | undefined): boolean {
  if (!user) return false;
  if (sameLogin(user.login, config.vault.adminLogin)) return true;
  if (user.role) return user.role === "admin";
  return !config.isProd && config.devLogin;
}

/** True when this account is the operator-configured admin (can't be demoted or removed from the UI). */
export function isConfigAdmin(user: ServerUser | null | undefined): boolean {
  return !!user && sameLogin(user.login, config.vault.adminLogin);
}

/** Case-insensitive login match — GitHub returns logins in canonical case and KOSH_ADMIN_LOGIN may be
 *  typed in any case, so the break-glass admin must be recognized regardless of casing. */
function sameLogin(a: string | null | undefined, b: string | null | undefined): boolean {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase();
}

/** Derive how an account signs in (single source of truth for the admin list and /me). */
export function resolveAuthProvider(u: ServerUser): "password" | "github" | "dev" {
  return u.authProvider ?? (u.githubId ? "github" : u.passwordHash ? "password" : "dev");
}

/** Serialize account create/mutate operations within this process so check-then-write sequences
 *  (email uniqueness, the last-admin guard) can't interleave. A best-effort complement to the DB's own
 *  unique index; it fully closes the race for the single-process in-memory store. */
let accountOpChain: Promise<unknown> = Promise.resolve();
export function withAccountLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = accountOpChain.then(fn, fn);
  accountOpChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** Row projection for the admin Users screen — identity and role only, never secrets. */
export function adminUserRow(u: ServerUser) {
  return {
    id: u.id,
    login: u.login,
    name: u.name,
    email: u.email,
    avatarUrl: u.avatarUrl,
    role: isAdmin(u) ? ("admin" as const) : ("user" as const),
    authProvider: resolveAuthProvider(u),
    disabled: !!u.disabled,
    configAdmin: isConfigAdmin(u),
    createdAt: u.createdAt,
  };
}

/** Unguessable per-user token for the inbound email address (inbox+<token>@…). */
export const newEmailToken = () => randomBytes(9).toString("base64url");

export interface GithubProfile {
  githubId?: string;
  login: string;
  name?: string;
  avatarUrl?: string;
  authProvider?: "password" | "github" | "dev";
}

/** Normalize an email for storage and lookup (case- and whitespace-insensitive). */
export const normalizeEmail = (email: string) => email.trim().toLowerCase();

/** The default per-user fields shared by every account, however it was created. */
function baseUserFields(now: string) {
  return {
    settings: { theme: "system" as const },
    storageUsed: 0,
    storageQuota: 2 * 1024 * 1024 * 1024,
    githubBudget: { remaining: 5000, total: 5000, resetAt: now },
    aiSpendToday: 0,
    aiSpendCap: config.ai.dailyCapUsd, // the operator-configured default (AI_DAILY_CAP_USD), not a hardcoded value
    aiProvider: config.ai.defaultProvider,
    emailToken: newEmailToken(),
    createdAt: now,
    updatedAt: now,
  };
}

/** Decide the role for a brand-new account: the operator's configured admin login is always admin, and
 *  the very first account on a fresh instance bootstraps as admin so there is always someone who can
 *  manage users; everyone after that defaults to a normal member. */
async function resolveInitialRole(login: string): Promise<"admin" | "user"> {
  if (config.vault.adminLogin && login.toLowerCase() === config.vault.adminLogin.toLowerCase()) return "admin";
  // Bootstrap only on a truly empty instance: the very first account becomes admin. On an instance that
  // already has accounts (including ones created before roles existed), a new sign-up is always a plain
  // member — so upgrading never silently hands admin to the next person who signs in.
  const anyUser = await getStore().users.findOne({});
  return anyUser ? "user" : "admin";
}

/** Find or create a user by GitHub id (or login for dev-login). New accounts get a role. */
export async function getOrCreateUser(p: GithubProfile): Promise<ServerUser> {
  const store = getStore();
  const existing = p.githubId
    ? await store.users.findOne({ githubId: p.githubId })
    : await store.users.findOne({ login: p.login });
  if (existing) return existing;
  const now = new Date().toISOString();
  return store.users.create({
    login: p.login,
    name: p.name ?? p.login,
    avatarUrl: p.avatarUrl,
    githubId: p.githubId,
    role: await resolveInitialRole(p.login),
    authProvider: p.authProvider ?? (p.githubId ? "github" : "dev"),
    ...baseUserFields(now),
  } as Omit<ServerUser, "id">);
}

/** Look up a password account by its (normalized) email. */
export function findUserByEmail(email: string) {
  return getStore().users.findOne({ email: normalizeEmail(email) });
}

/** Create an email/password account. The caller must have already checked the email is free. `role` is
 *  resolved (first account bootstraps as admin) unless one is passed (admin-created accounts). */
export async function createPasswordUser(input: {
  email: string;
  passwordHash: string;
  name?: string;
  role?: "admin" | "user";
  createdBy?: string;
}): Promise<ServerUser> {
  const store = getStore();
  const email = normalizeEmail(input.email);
  const now = new Date().toISOString();
  return store.users.create({
    login: email,
    name: input.name?.trim() || email.split("@")[0] || email,
    email,
    passwordHash: input.passwordHash,
    role: input.role ?? (await resolveInitialRole(email)),
    authProvider: "password",
    createdBy: input.createdBy,
    ...baseUserFields(now),
  } as Omit<ServerUser, "id">);
}

/** Client-safe user projection (never leak tokens). */
export function publicUser(u: ServerUser) {
  return {
    id: u.id,
    login: u.login,
    name: u.name,
    email: u.email,
    role: isAdmin(u) ? ("admin" as const) : ("user" as const),
    authProvider: resolveAuthProvider(u),
    disabled: !!u.disabled,
    avatarUrl: u.avatarUrl,
    settings: u.settings,
    storageUsed: u.storageUsed,
    storageQuota: u.storageQuota,
    githubBudget: u.githubBudget,
    aiSpendToday: u.aiSpendToday,
    aiSpendCap: u.aiSpendCap,
    aiProvider: u.aiProvider ?? config.ai.defaultProvider,
    aiModel: u.aiModel,
    aiAvailable: aiAvailableForUser(u),
    // Booleans only — the encrypted keys themselves never leave the server.
    aiKeys: Object.fromEntries(Object.entries(u.aiKeys ?? {}).map(([k]) => [k, true])),
    aiProviders: providerCatalog(),
    emailToken: u.emailToken,
    github: {
      connected: !!u.githubToken,
      login: u.githubToken ? u.githubLogin : undefined,
      name: u.githubToken ? u.githubName : undefined,
      avatarUrl: u.githubToken ? u.githubAvatarUrl : undefined,
      scopes: u.githubToken && u.githubScopes ? u.githubScopes.split(" ").filter(Boolean) : undefined,
      source: u.githubToken ? u.githubTokenSource ?? "pat" : undefined,
    },
    isAdmin: isAdmin(u),
  };
}
