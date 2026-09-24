import { randomUUID } from "node:crypto";

function bool(v: string | undefined, def = false): boolean {
  if (v == null) return def;
  return /^(1|true|yes|on)$/i.test(v);
}

const env = process.env;

export const config = {
  port: Number(env.PORT ?? 8787),
  nodeEnv: env.NODE_ENV ?? "development",
  isProd: env.NODE_ENV === "production",

  appUrl: env.APP_URL ?? "http://localhost:5173",
  apiUrl: env.API_URL ?? `http://localhost:${env.PORT ?? 8787}`,

  // storage: mongo when a URI is set, else the in-memory/JSON adapter (runs anywhere)
  mongoUri: env.MONGODB_URI || null,
  dataDir: env.DATA_DIR ?? ".data",

  // object storage: R2/MinIO when creds present, else a local filesystem store
  r2: {
    endpoint: env.R2_ENDPOINT || null,
    accountId: env.R2_ACCOUNT_ID || null,
    accessKeyId: env.R2_ACCESS_KEY_ID || null,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY || null,
    bucket: env.R2_BUCKET || "kosh",
  },

  // auth
  jwtSecret: env.SESSION_SECRET || "dev-insecure-secret-change-me",
  encryptionKey: env.ENCRYPTION_KEY || "dev-insecure-encryption-key-change-me",
  allowedLogins: (env.ALLOWED_GITHUB_LOGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  devLogin: bool(env.DEV_LOGIN, !env.NODE_ENV || env.NODE_ENV !== "production"),
  cookieSecure: bool(env.COOKIE_SECURE, env.NODE_ENV === "production"),

  github: {
    clientId: env.GITHUB_CLIENT_ID || null,
    clientSecret: env.GITHUB_CLIENT_SECRET || null,
    // A server token used for enrichment when a user hasn't connected OAuth.
    // (In this sandbox the proxy blocks api.github.com, so enrichment degrades gracefully.)
    token: env.KOSH_GITHUB_TOKEN || null,
    // The OAuth callback for the "Connect GitHub" flow. Register this URL on the OAuth App (OAuth Apps
    // accept up to 10 callback URLs, so it can coexist with the /api/auth/github/callback login URL).
    connectRedirectUri: env.GITHUB_CONNECT_REDIRECT_URI || `${env.API_URL ?? `http://localhost:${env.PORT ?? 8787}`}/api/github/auth/callback`,
  },

  // Google Drive integration (OAuth 2.0). Unset creds → the feature runs in demo mode and the
  // web app shows a "connect Google" gate that explains the setup. Least-privilege by default:
  // `drive.file` only touches files this app creates (no Google verification needed). Set
  // GOOGLE_DRIVE_FULL_ACCESS=1 to request the RESTRICTED `drive` scope (browse ALL existing
  // folders) — that requires Google app verification before real users can consent.
  google: {
    clientId: env.GOOGLE_CLIENT_ID || null,
    clientSecret: env.GOOGLE_CLIENT_SECRET || null,
    // The OAuth redirect must exactly match one registered in the Google Cloud console.
    redirectUri: env.GOOGLE_REDIRECT_URI || `${env.API_URL ?? `http://localhost:${env.PORT ?? 8787}`}/api/drive/auth/callback`,
    fullAccess: bool(env.GOOGLE_DRIVE_FULL_ACCESS, false),
    // Drive V2 `changes.watch` PUSH webhooks (near-instant sync). Must be a PUBLIC https URL Google
    // can POST to — e.g. https://<public-api-host>/api/drive-v2/webhook/changes — and that domain
    // verified for the OAuth app. Unset → clients fall back to the built-in polling sync.
    webhookUrl: env.DRIVE_WEBHOOK_URL || null,
  },

  // Multi-provider AI. The default provider + per-user selection live in Settings; users can bring their
  // own key (encrypted) for any provider, and the server can supply fallback keys via these env vars.
  // Most providers are OpenAI-compatible (one adapter); Anthropic uses its native SDK. See aiProviders.ts.
  ai: {
    dailyCapUsd: Number(env.AI_DAILY_CAP_USD ?? 2),
    defaultProvider: env.AI_DEFAULT_PROVIDER || "gemini", // free tier, no card — cheapest to start with
    anthropicModel: env.ANTHROPIC_MODEL || null, // optional override of the anthropic default model
    ollamaBaseUrl: env.OLLAMA_BASE_URL || "http://localhost:11434/v1", // local, keyless
    keys: {
      anthropic: env.ANTHROPIC_API_KEY || null,
      gemini: env.GEMINI_API_KEY || null,
      groq: env.GROQ_API_KEY || null,
      cerebras: env.CEREBRAS_API_KEY || null,
      openrouter: env.OPENROUTER_API_KEY || null,
      mistral: env.MISTRAL_API_KEY || null,
      deepseek: env.DEEPSEEK_API_KEY || null,
      openai: env.OPENAI_API_KEY || null,
    } as Record<string, string | null>,
  },

  telegram: {
    token: env.TELEGRAM_BOT_TOKEN || null,
    webhookSecret: env.TELEGRAM_WEBHOOK_SECRET || null,
  },

  email: {
    inboundSecret: env.EMAIL_INBOUND_SECRET || null,
    // Optional allowlist of sender addresses or domains (comma-separated). Empty = accept any (dev).
    allowedSenders: (env.EMAIL_ALLOWED_SENDERS ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  },

  // Secure Vault: admin-only, end-to-end-encrypted. Stored SEPARATELY from the main app data
  // (its own directory, or its own R2 bucket) and never in MongoDB.
  vault: {
    // Which login may access the vault. Falls back to the first allowlisted login; in dev-login
    // mode with neither set, any authenticated user is treated as admin (document this!).
    adminLogin: env.KOSH_ADMIN_LOGIN || (env.ALLOWED_GITHUB_LOGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean)[0] || null,
    // A directory dedicated to the vault, separate from DATA_DIR — only ever holds ciphertext.
    dir: env.VAULT_DIR ?? ".vault-data",
    // Optional: route vault ciphertext to its own R2/S3 bucket instead of the local dir.
    r2Bucket: env.VAULT_R2_BUCKET || null,
    maxFileBytes: 25 * 1024 * 1024,
    maxManifestBytes: 8 * 1024 * 1024,
  },

  jobs: bool(env.ENABLE_JOBS, false),

  limits: {
    maxFiles: 300,
    maxFileBytes: 25 * 1024 * 1024,
    maxTotalBytes: 50 * 1024 * 1024,
  },
} as const;

// Fail fast rather than silently encrypting user secrets under a public dev key.
if (config.isProd) {
  const insecure: string[] = [];
  if (!env.SESSION_SECRET || env.SESSION_SECRET === "change-me" || config.jwtSecret.startsWith("dev-insecure")) insecure.push("SESSION_SECRET");
  if (!env.ENCRYPTION_KEY || env.ENCRYPTION_KEY.length < 16 || config.encryptionKey.startsWith("dev-insecure")) insecure.push("ENCRYPTION_KEY (>=16 chars)");
  // DEV_LOGIN lets anyone mint a session without credentials — never allow it in production.
  if (config.devLogin) insecure.push("DEV_LOGIN=0 (must be off in production)");
  if (insecure.length) {
    throw new Error(`Refusing to start in production without secure ${insecure.join(", ")}. Set these environment variables to strong random values.`);
  }
}

export const runId = randomUUID();

export function storageDriver(): "r2" | "local" {
  return config.r2.accessKeyId && config.r2.secretAccessKey ? "r2" : "local";
}

export function dbDriver(): "mongo" | "memory" {
  return config.mongoUri ? "mongo" : "memory";
}
