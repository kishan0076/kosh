import type { ApiKey, Collection, Item, Skill, User } from "@kosh/shared";

/** Server-side additions to the shared types. `aiKeys` is re-typed here: the client sees booleans
 *  (does a key exist?), the server stores the encrypted keys — so we omit it from User before extending. */
export interface ServerUser extends Omit<User, "aiKeys"> {
  githubId?: string;
  githubToken?: string; // encrypted at rest in production
  // Connected-GitHub metadata (safe to show; the token above is never exposed).
  githubLogin?: string;
  githubName?: string;
  githubAvatarUrl?: string;
  githubScopes?: string; // space-joined OAuth scopes the stored token carries
  githubTokenSource?: "oauth" | "pat"; // how the token was obtained (Connect button vs. pasted PAT)
  githubConnectedAt?: string;
  aiSpendDate?: string;
  aiProvider?: string; // selected AI provider id (default from config.ai.defaultProvider)
  aiModel?: string; // optional model override for the selected provider
  aiKeys?: Record<string, string>; // provider id -> encryptSecret(key); bring-your-own-key, never exposed
  telegramChatId?: number;
}
export interface ServerItem extends Item {
  userId: string;
  urlHash?: string;
}
export interface ServerSkill extends Skill {
  userId: string;
  searchText?: string;
}
export interface ServerCollection extends Collection {
  userId: string;
}
export interface ServerApiKey extends ApiKey {
  userId: string;
  keyHash: string;
}
export interface StorageObjectDoc {
  id: string;
  userId: string;
  sha256: string;
  key: string;
  size: number;
  mime: string;
  refCount: number;
  createdAt: string;
}
export interface UploadSessionDoc {
  id: string;
  userId: string;
  files: { path: string; size: number; mime: string; sha256: string; uploaded: boolean }[];
  expiresAt: string;
  createdAt: string;
}

/** A connected Google account for the Drive integration. The refresh token is encrypted at rest;
 *  the plaintext access token is never stored — it's minted on demand and lives only in the browser. */
export interface DriveAccountDoc {
  id: string;
  userId: string;
  googleSub: string; // stable Google user id (the OpenID `sub` claim)
  email: string;
  name?: string;
  picture?: string;
  refreshToken: string; // encrypted at rest
  scope: string;
  createdAt: string;
  lastUsedAt?: string;
}

/** One row of Drive upload history (metadata only — never the file bytes). */
export interface DriveUploadDoc {
  id: string;
  userId: string;
  accountId: string;
  fileName: string;
  mimeType: string;
  size: number;
  driveFileId?: string;
  folderId?: string;
  folderPath?: string;
  webViewLink?: string;
  status: "completed" | "failed";
  error?: string;
  createdAt: string;
}

export type Filter = Record<string, unknown>;
export interface FindOpts {
  sort?: Record<string, 1 | -1>;
  limit?: number;
  skip?: number;
}

/** The narrow persistence surface the app uses (Mongo-like, adapter-agnostic). */
export interface Coll<T extends { id: string }> {
  create(doc: Omit<T, "id"> & { id?: string }): Promise<T>;
  findById(id: string): Promise<T | null>;
  findOne(filter: Filter): Promise<T | null>;
  find(filter?: Filter, opts?: FindOpts): Promise<T[]>;
  updateById(id: string, patch: Partial<T>): Promise<T | null>;
  updateOne(filter: Filter, patch: Partial<T>): Promise<T | null>;
  deleteById(id: string): Promise<boolean>;
  count(filter?: Filter): Promise<number>;
}

export interface Store {
  users: Coll<ServerUser>;
  items: Coll<ServerItem>;
  skills: Coll<ServerSkill>;
  collections: Coll<ServerCollection>;
  apiKeys: Coll<ServerApiKey>;
  storageObjects: Coll<StorageObjectDoc>;
  uploadSessions: Coll<UploadSessionDoc>;
  driveAccounts: Coll<DriveAccountDoc>;
  driveUploads: Coll<DriveUploadDoc>;
  ping(): Promise<boolean>;
  close(): Promise<void>;
}
