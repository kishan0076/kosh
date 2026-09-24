import { randomBytes } from "node:crypto";
import { config } from "../config.js";
import { getStore, type ServerUser } from "../db/index.js";
import { aiAvailableForUser, providerCatalog } from "../integrations/aiProviders.js";

/** Is this user the vault admin? A configured admin login is the only thing that grants access in a
 *  real deployment. The "any dev-login user is admin" convenience is fail-CLOSED: it applies ONLY in
 *  non-production local dev, so forgetting KOSH_ADMIN_LOGIN (or NODE_ENV) never opens the vault to
 *  every authenticated user. */
export function isAdmin(user: ServerUser | null | undefined): boolean {
  if (!user) return false;
  if (config.vault.adminLogin) return user.login === config.vault.adminLogin;
  return !config.isProd && config.devLogin;
}

/** Unguessable per-user token for the inbound email address (inbox+<token>@…). */
export const newEmailToken = () => randomBytes(9).toString("base64url");

export interface GithubProfile {
  githubId?: string;
  login: string;
  name?: string;
  avatarUrl?: string;
}

/** Find or create a user by GitHub id (or login for dev-login). */
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
    settings: { theme: "system" },
    storageUsed: 0,
    storageQuota: 2 * 1024 * 1024 * 1024,
    githubBudget: { remaining: 5000, total: 5000, resetAt: now },
    aiSpendToday: 0,
    aiSpendCap: 2,
    aiProvider: config.ai.defaultProvider,
    emailToken: newEmailToken(),
    createdAt: now,
    updatedAt: now,
  } as Omit<ServerUser, "id">);
}

/** Client-safe user projection (never leak tokens). */
export function publicUser(u: ServerUser) {
  return {
    id: u.id,
    login: u.login,
    name: u.name,
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
