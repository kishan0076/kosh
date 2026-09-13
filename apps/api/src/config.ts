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
  },

  anthropic: {
    apiKey: env.ANTHROPIC_API_KEY || null,
    model: env.ANTHROPIC_MODEL || "claude-haiku-4-5", // cheap bulk summaries/tags
    dailyCapUsd: Number(env.AI_DAILY_CAP_USD ?? 2),
  },

  telegram: {
    token: env.TELEGRAM_BOT_TOKEN || null,
    webhookSecret: env.TELEGRAM_WEBHOOK_SECRET || null,
  },

  jobs: bool(env.ENABLE_JOBS, false),

  limits: {
    maxFiles: 300,
    maxFileBytes: 25 * 1024 * 1024,
    maxTotalBytes: 50 * 1024 * 1024,
  },
} as const;

export const runId = randomUUID();

export function storageDriver(): "r2" | "local" {
  return config.r2.accessKeyId && config.r2.secretAccessKey ? "r2" : "local";
}

export function dbDriver(): "mongo" | "memory" {
  return config.mongoUri ? "mongo" : "memory";
}
