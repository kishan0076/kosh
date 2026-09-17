import { randomBytes } from "node:crypto";
import { config } from "../config.js";
import { getStore, type ServerUser } from "../db/index.js";

/** Is this user the vault admin? Configured login wins; in dev-login mode with none set, any
 *  authenticated user qualifies (single-user local dev). Production MUST set KOSH_ADMIN_LOGIN. */
export function isAdmin(user: ServerUser | null | undefined): boolean {
  if (!user) return false;
  if (config.vault.adminLogin) return user.login === config.vault.adminLogin;
  return config.devLogin;
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
    emailToken: u.emailToken,
    github: { connected: !!u.githubToken },
    isAdmin: isAdmin(u),
  };
}
