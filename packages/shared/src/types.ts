/**
 * Kosh domain types — the universal library model.
 * Mirrors the data model in the build plan (§4), adapted for the client.
 */

export type ItemKind = "link" | "skill" | "prompt" | "file";

export type LinkType =
  | "repo"
  | "gist"
  | "profile"
  | "release"
  | "issue"
  | "package"
  | "tool"
  | "article"
  | "video"
  | "other";

export type RepoKind =
  | "skills"
  | "mcp-server"
  | "automation"
  | "cli"
  | "agent-framework"
  | "library"
  | "awesome-list"
  | "template"
  | "app"
  | "other";

export type Stage = "to-try" | "trying" | "using" | "dropped";

export type Trust = "mine" | "reviewed" | "unreviewed";

export type ItemStatus = "enriching" | "ready" | "dead" | "archived";

export type Tool = "claude" | "codex" | "cursor" | "gemini" | "generic";

export type Registry = "npm" | "pypi" | "crates" | "docker";

export type ItemSource =
  | "web"
  | "bot"
  | "share"
  | "bookmarklet"
  | "email"
  | "mcp"
  | "cli"
  | "import"
  | "snapshot";

export type FoundViaKind =
  | "telegram"
  | "email"
  | "list"
  | "person"
  | "site"
  | "other";

export interface FoundVia {
  kind: FoundViaKind;
  label: string;
  itemId?: string;
}

export interface SkillIndexEntry {
  path: string;
  name: string;
  description?: string;
  tool?: Tool;
  snapshotted?: boolean;
}

export interface InstallInfo {
  command?: string;
  source: "readme" | "package.json" | "pyproject" | "none";
}

export interface WatchInfo {
  enabled: boolean;
  lastCheckedAt?: string;
  newSince?: number;
  lastLinkHashes?: string[];
  lastSkillPaths?: string[];
}

export interface GithubMeta {
  owner: string;
  repo: string;
  stars?: number;
  forks?: number;
  language?: string;
  topics?: string[];
  license?: string;
  pushedAt?: string;
  defaultBranch?: string;
  archived?: boolean;
  etag?: string;
  treeSha?: string;
  repoKind?: RepoKind;
  repoKindSignals?: string[];
  skillDirs?: string[];
  configFiles?: string[];
  skillIndex?: SkillIndexEntry[];
  install?: InstallInfo;
  snapshotPolicy?: "auto" | "manual" | "all";
  watch?: WatchInfo;
  copiedCount?: number;
  /** README markdown captured at enrichment time (shown in the detail view). */
  readme?: string;
}

export interface PackageMeta {
  registry: Registry;
  name: string;
  version?: string;
  repoUrl?: string;
}

export interface LinkMeta {
  siteName?: string;
  image?: string;
  favicon?: string;
}

export interface PromptVariable {
  name: string;
  default?: string;
}

export interface PromptMeta {
  body: string;
  variables: PromptVariable[];
  usedCount: number;
}

export interface FileObject {
  path: string;
  objectId?: string;
  size: number;
  mime: string;
}

export interface AiMeta {
  summary?: string;
  suggestedTags?: string[];
  category?: string;
}

export interface Item {
  id: string;
  kind: ItemKind;

  // link
  url?: string;
  originalUrl?: string;
  linkType?: LinkType;
  github?: GithubMeta;
  package?: PackageMeta;
  parentItemId?: string;
  subPath?: string;
  meta?: LinkMeta;

  // skill / prompt / file
  skillId?: string;
  prompt?: PromptMeta;
  fileObject?: FileObject;

  // curation (all kinds)
  title?: string;
  description?: string;
  note?: string;
  tags: string[];
  collections: string[];
  stage: Stage;
  rating?: number;
  verdict?: string;
  verdictAt?: string;
  foundVia?: FoundVia;
  source: ItemSource;
  status: ItemStatus;
  pinned?: boolean;
  favorite?: boolean;
  ai?: AiMeta;
  lastCheckedAt?: string;
  snoozedUntil?: string;
  deletedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface LintResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  infos?: string[];
}

export interface ScanFinding {
  path: string;
  line: number;
  rule: string;
  text: string;
}

export interface ScanResult {
  risky: boolean;
  findings: ScanFinding[];
}

export interface SkillFile {
  path: string;
  objectId?: string;
  size: number;
  mime: string;
  sha256?: string;
  verified?: boolean;
  /** Optional inline preview content (text files) for the demo/client. */
  content?: string;
}

export interface SkillVersion {
  n: number;
  createdAt: string;
  note?: string;
  entry: string;
  files: SkillFile[];
  frontmatter?: Record<string, unknown>;
  totalSize: number;
  lint: LintResult;
  scan: ScanResult;
}

export interface Skill {
  id: string;
  itemId: string;
  name: string;
  displayName: string;
  description?: string;
  tools: Tool[];
  origin: "upload" | "authored" | "bot" | "repo" | "local";
  source?: {
    itemId?: string;
    owner?: string;
    repo?: string;
    path?: string;
    dirSha?: string;
  };
  trust: Trust;
  reviewedAt?: string;
  license?: string;
  latest: number;
  versions: SkillVersion[];
  usageCount: number;
  lastUsedAt?: string;
  public?: boolean;
  publicSlug?: string;
  /** Index-only skills live in a saved repo but haven't been copied into storage. */
  indexOnly?: boolean;
  deletedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Collection {
  id: string;
  name: string;
  slug: string;
  icon?: string;
  color?: string;
  order: number;
  isSmart?: boolean;
  filter?: Record<string, unknown>;
}

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  scopes: ("read" | "write")[];
  lastUsedAt?: string;
  revokedAt?: string;
  createdAt: string;
}

export interface UserSettings {
  theme: "light" | "dark" | "system";
  reducedMotion?: boolean;
}

/** One selectable AI provider, as surfaced to the Settings picker. The server derives this from its
 *  provider registry (`providerCatalog()`); sharing the type keeps the two from drifting. */
export interface AiProviderInfo {
  id: string;
  label: string;
  free: boolean;
  defaultModel: string;
  needsKey: boolean;
  hasServerKey: boolean;
  hint: string;
}

export interface User {
  id: string;
  login: string;
  name: string;
  avatarUrl?: string;
  settings: UserSettings;
  storageUsed: number;
  storageQuota: number;
  githubBudget: { remaining: number; total: number; resetAt: string };
  aiSpendToday: number;
  aiSpendCap: number;
  /** Selected AI provider + optional model override (multi-provider AI; picked in Settings). */
  aiProvider?: string;
  aiModel?: string;
  /** Whether the user can run AI right now (their provider has a usable key: BYOK, server, or local). */
  aiAvailable?: boolean;
  /** Per-provider: does the user have their own key stored? (booleans only — never the key.) */
  aiKeys?: Record<string, boolean>;
  /** Catalog of selectable AI providers for the Settings picker. */
  aiProviders?: AiProviderInfo[];
  /** Opaque, unguessable token for the user's inbound email address (inbox+<token>@…). */
  emailToken?: string;
  /** GitHub connection status (a write-capable token is stored) — never the token itself. */
  github?: {
    connected?: boolean;
    login?: string;
    name?: string;
    avatarUrl?: string;
    scopes?: string[];
    source?: "oauth" | "pat";
  };
  /** Whether this user may access the admin-only Secure Vault. */
  isAdmin?: boolean;
}
