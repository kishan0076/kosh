import type { ApiKey, Collection, Item, Skill, User } from "@kosh/shared";

/** Server-side additions to the shared types. */
export interface ServerUser extends User {
  githubId?: string;
  githubToken?: string; // encrypted at rest in production
  aiSpendDate?: string;
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
  ping(): Promise<boolean>;
  close(): Promise<void>;
}
