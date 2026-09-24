# Kosh — Complete Setup Guide (English)

This guide walks you through running Kosh from scratch, getting every token, and
understanding **every environment variable** in detail. A Gujlish version of the
same content is in [`SETUP_GUJLISH.md`](./SETUP_GUJLISH.md).

- Deep-dives referenced below: [`MONGODB_ATLAS_SETUP.md`](./MONGODB_ATLAS_SETUP.md)
  (database) and [`SECURE_VAULT.md`](./SECURE_VAULT.md) (the admin-only encrypted vault).

---

## 0. Prerequisites

- **Node.js ≥ 22** and **npm 10** (the repo pins `npm@10.9.7`).
- It is an **npm workspaces + Turborepo** monorepo — no Docker, no pnpm needed.

```bash
node -v            # must be v22 or higher
npm install        # run from the repo root — installs every workspace
```

---

## 1. The two run modes (read this first)

Kosh runs in one of two modes, decided by a **single variable**, `VITE_API_URL`:

| Mode | Trigger | What you get |
| --- | --- | --- |
| **Demo** | `VITE_API_URL` is **unset** | Runs fully in the browser, data in `localStorage`. **No Secure Vault, no server persistence, no GitHub publish.** |
| **Backend** | `VITE_API_URL` is **set** | Talks to the API → real persistence, the **Secure Vault**, and the **GitHub Repository Manager** all work. |

> To use the features (Secure Vault, reliable persistence, GitHub Repository
> Manager), you **must** run in backend mode: the API running **and**
> `VITE_API_URL` set.

---

## 2. Where the `.env` file goes

Create **one `.env` file at the repository root**. Both `apps/web` and `apps/api`
read it from there. Start from the template:

```bash
cp .env.example .env
```

Then edit `.env` using the reference in Section 5.

---

## 3. How to run

```bash
npm run dev        # runs BOTH the web app and the API together (Turborepo)
```

- Web app → **http://localhost:5173**
- API → **http://localhost:8787**

Run them separately if you prefer:

```bash
npm run api        # API only
npm run web        # web only
```

In dev, the web app **auto-logs you in** as the login `darshan` (because
`DEV_LOGIN=1`). The **Secure Vault** then appears in the top-right account menu
(admin only), or open it directly at **`/vault`**.

---

## 4. Secrets you generate yourself (no website needed)

Two secrets are **generated**, not obtained from a service. Run these and paste
the output into `.env`:

```bash
# SESSION_SECRET — signs your login cookie
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# ENCRYPTION_KEY — encrypts your stored GitHub token at rest (keep it STABLE forever)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# EMAIL_INBOUND_SECRET / TELEGRAM_WEBHOOK_SECRET — only if you use those integrations
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```

(`openssl rand -hex 32` works too.)

> ⚠️ If you ever change `ENCRYPTION_KEY`, any GitHub token already saved in the
> app can no longer be decrypted — you would simply re-paste it in Settings.

---

## 5. Every environment variable, in detail

Each entry: **what it does · required or optional · default · how to get / set it.**

### 5.1 Core / web

#### `VITE_API_URL`
- **What:** the API base URL the web app talks to. Setting it switches the app
  from demo mode to **backend mode** (persistence + vault + publish).
- **Required:** yes, to use any server feature. Leave unset only for the pure demo.
- **Default:** unset (demo mode).
- **How to set:** include the `/api` path. Dev value:
  `VITE_API_URL=http://localhost:8787/api`. Prod: `https://your-api-domain/api`.

#### `PORT`
- **What:** the port the API listens on.
- **Required:** no.
- **Default:** `8787`.

#### `NODE_ENV`
- **What:** `development` or `production`. In `production` the API runs a
  **security fail-fast** check at startup (see Section 8).
- **Required:** no (but set `production` when deploying).
- **Default:** `development`.

#### `APP_URL` / `API_URL`
- **What:** public URLs of the web app and API. Used for the GitHub OAuth
  redirect and for building links.
- **Required:** only when using GitHub OAuth or deploying.
- **Default:** `http://localhost:5173` and `http://localhost:8787`.

### 5.2 Authentication

#### `SESSION_SECRET`
- **What:** signs the session cookie.
- **Required:** yes in production (the API refuses to boot with a weak/default value).
- **Default:** an insecure dev key.
- **How to get:** generate it (Section 4).

#### `ENCRYPTION_KEY`
- **What:** encrypts secrets stored at rest (e.g. your saved GitHub token).
- **Required:** yes in production; must be **≥ 16 characters**.
- **Default:** an insecure dev key.
- **How to get:** generate it (Section 4). Keep it stable.

#### `DEV_LOGIN`
- **What:** enables password-less login (`POST /auth/dev-login`). In dev the web
  app uses this to auto-log-in as `darshan`.
- **Required:** no. **Must be `0` in production** — the API refuses to start with
  it on in production.
- **Default:** `1` in non-production, off in production.

#### `COOKIE_SECURE`
- **What:** marks the session cookie `Secure` (HTTPS-only).
- **Required:** no. Use `0` for local http, `1` for production https.
- **Default:** `1` in production, `0` otherwise.

#### `ALLOWED_GITHUB_LOGINS`
- **What:** comma-separated allowlist of logins that may sign in. Empty = allow any.
- **Required:** no.
- **Default:** empty.
- **Note (dev):** the dev auto-login user is `darshan`, so if you set this in dev,
  include `darshan` or login is refused.

#### `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`
- **What:** enable "Connect with GitHub" (OAuth) instead of pasting a token.
- **Required:** no (dev login covers local use).
- **How to get:** see Section 6.2.

#### `KOSH_GITHUB_TOKEN`
- **What:** an optional **server-wide** GitHub token used for enrichment / as a
  publish fallback when a user has not connected their own.
- **Required:** no.
- **How to get:** a Personal Access Token — see Section 6.1.

### 5.3 Persistence (the "data disappears after refresh" fix)

#### `MONGODB_URI`
- **What:** connection string for MongoDB. **Unset → local JSON file**
  (`.data/db.json`, survives restarts). **Set → MongoDB Atlas** (durable,
  recommended for production).
- **Required:** no (but recommended for production).
- **Default:** unset (local JSON store).
- **How to get:** see Section 6.3 and [`MONGODB_ATLAS_SETUP.md`](./MONGODB_ATLAS_SETUP.md).

#### `DATA_DIR`
- **What:** directory for the local JSON store and locally-stored uploads.
- **Required:** no.
- **Default:** `.data`.

### 5.4 Object storage (files / screenshots)

#### `R2_ENDPOINT`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`
- **What:** Cloudflare R2 (or any S3-compatible) storage for uploaded files.
  When unset, files are stored on the local filesystem under `DATA_DIR`.
- **Required:** no.
- **Default:** local filesystem; `R2_BUCKET` defaults to `kosh`.
- **How to get:** see Section 6.4. Set `R2_ACCOUNT_ID` (production) or
  `R2_ENDPOINT` (custom/S3/B2) — providing `R2_ENDPOINT` switches the S3 client to
  path-style addressing.

### 5.5 Secure Vault (admin-only, end-to-end encrypted)

#### `KOSH_ADMIN_LOGIN`
- **What:** which login may open the Secure Vault. This is the **defense-in-depth**
  server gate (the data is also useless without your master password).
- **Required:** strongly recommended; **always set in production**.
- **Default:** falls back to the first `ALLOWED_GITHUB_LOGINS`; in non-production
  dev-login mode with neither set, any authenticated user is admin (fail-closed:
  this never applies in production).
- **How to set:** your login. In dev that is `darshan`; in production your GitHub
  username. (It is a name, not a token.)

#### `VAULT_DIR`
- **What:** a directory dedicated to vault **ciphertext**, kept **separate** from
  `DATA_DIR` and never in MongoDB.
- **Required:** no.
- **Default:** `.vault-data`.
- **Tip:** point it at an OS-encrypted volume for extra safety.

#### `VAULT_R2_BUCKET`
- **What:** optional — store vault ciphertext in its **own R2/S3 bucket** instead
  of the local dir (reuses the `R2_*` credentials, but a **different** bucket than
  `R2_BUCKET`).
- **Required:** no.
- **Default:** unset (uses `VAULT_DIR`).
- **How to get:** create a second R2 bucket — see Section 6.4 and
  [`SECURE_VAULT.md`](./SECURE_VAULT.md).

### 5.6 GitHub Repository Manager token resolution

The GitHub Repository Manager (create a repo + upload a folder) needs a token with
**`repo`** scope. It resolves in this order (first that exists wins):

1. A token you **paste in the app** → *Settings → GitHub* (stored encrypted). ← simplest
2. **OAuth** via `GITHUB_CLIENT_ID` + `GITHUB_CLIENT_SECRET`.
3. The server fallback `KOSH_GITHUB_TOKEN`.

### 5.7 Optional integrations

#### `AI_DEFAULT_PROVIDER` / provider keys / `AI_DAILY_CAP_USD`
- **What:** enable AI auto-tags/summaries, Drive file summaries, natural-language search and the
  cleanup wizard. Kosh supports **multiple providers** — `AI_DEFAULT_PROVIDER` (default `gemini`,
  a free tier with no credit card) picks which one new users start on; each user can switch and add
  their own key in **Settings → AI provider**. Provide the matching server key as a fallback:
  `GEMINI_API_KEY`, `GROQ_API_KEY`, `CEREBRAS_API_KEY`, `OPENROUTER_API_KEY`, `MISTRAL_API_KEY`,
  `DEEPSEEK_API_KEY`, `OPENAI_API_KEY`, or `ANTHROPIC_API_KEY` (+ optional `ANTHROPIC_MODEL`, default
  `claude-haiku-4-5`). Paid-provider spend is capped by `AI_DAILY_CAP_USD` (default `2`); free tiers
  and local Ollama never count. Full matrix and setup: **docs/AI_PROVIDERS.md**.
- **Required:** no.
- **How to get:** Gemini (default) — [aistudio.google.com/apikey](https://aistudio.google.com/apikey),
  no card. Anthropic — see Section 6.5.

#### `TELEGRAM_BOT_TOKEN` / `TELEGRAM_WEBHOOK_SECRET`
- **What:** save items via a Telegram bot.
- **Required:** no.
- **How to get:** see Section 6.6.

#### `EMAIL_INBOUND_SECRET` / `EMAIL_ALLOWED_SENDERS`
- **What:** save items by email (via the Cloudflare email worker in
  `infra/email-worker`). `EMAIL_ALLOWED_SENDERS` is a comma-separated allowlist
  (required in production).
- **Required:** no.

#### `ENABLE_JOBS`
- **What:** enables scheduled background jobs (nightly trash purge, weekly repo
  refresh).
- **Required:** no.
- **Default:** `0`.

---

## 6. How to get each token (step by step)

### 6.1 GitHub Personal Access Token — for the Repository Manager ⭐
Scope needed: **`repo`**.

1. Go to **https://github.com/settings/tokens** → **Generate new token → Tokens (classic)**.
2. **Note:** `kosh`. **Expiration:** your choice.
3. **Select scopes → check `repo`** (full — allows creating repos and pushing files).
4. **Generate token** → copy the `ghp_…` value (shown only once).
5. Easiest: start the app → **Settings → GitHub → paste the token** (validated and
   stored encrypted). Only put it in `.env` as `KOSH_GITHUB_TOKEN` if you want a
   server-wide fallback.

> Fine-grained token alternative: needs **Administration: Read & write** (to create
> repos) + **Contents: Read & write**. Classic `repo` is simpler.

### 6.2 GitHub OAuth App — `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`
1. **https://github.com/settings/developers** → **New OAuth App**.
2. **Homepage URL:** `http://localhost:5173` (dev) or your production URL.
3. **Authorization callback URL:** `http://localhost:8787/api/auth/github/callback`
   (must equal `API_URL` + `/api/auth/github/callback`).
4. **Register application** → copy the **Client ID**; **Generate a new client
   secret** → copy it.
5. Put both in `.env`. In dev you can skip OAuth entirely (`DEV_LOGIN=1`).

### 6.3 MongoDB Atlas — `MONGODB_URI`
Full walkthrough: [`MONGODB_ATLAS_SETUP.md`](./MONGODB_ATLAS_SETUP.md). Short version:

1. **https://cloud.mongodb.com** → sign up → **Create a free M0 cluster**.
2. **Database Access → Add New Database User** (username + password; save it).
3. **Network Access → Add IP Address** → `0.0.0.0/0` for testing (tighten later).
4. **Clusters → Connect → Drivers** → copy the URI:
   ```
   mongodb+srv://<user>:<password>@cluster0.xxxx.mongodb.net/kosh?retryWrites=true&w=majority
   ```
5. Replace `<user>`/`<password>`, keep the db name `kosh`, set it as `MONGODB_URI`.

### 6.4 Cloudflare R2 — `R2_*` and `VAULT_R2_BUCKET`
Full walkthrough: [`SECURE_VAULT.md`](./SECURE_VAULT.md) (Option B). Short version:

1. **https://dash.cloudflare.com → R2 → Create bucket** — e.g. `kosh` for app
   files, and a **separate** `kosh-vault` for the vault.
2. **R2 → Manage R2 API Tokens → Create API Token** → **Object Read & Write** →
   copy the **Access Key ID**, **Secret Access Key**, and your **Account ID**.
3. Fill `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
   `R2_BUCKET=kosh`, and (for the vault) `VAULT_R2_BUCKET=kosh-vault`.

### 6.5 Anthropic API key — `ANTHROPIC_API_KEY`
1. **https://console.anthropic.com → Settings → API Keys → Create Key** → copy `sk-ant-…`.
2. Put it in `.env`.

### 6.6 Telegram bot token — `TELEGRAM_BOT_TOKEN`
1. In Telegram, message **@BotFather** → `/newbot` → follow prompts → copy the
   `123456:ABC…` token.

---

## 7. Complete `.env` templates

### 7.1 DEV `.env` (fill the two generated secrets and go)

```dotenv
# ── backend mode (required for vault + persistence + publish) ──
VITE_API_URL=http://localhost:8787/api

# ── API ──
PORT=8787
NODE_ENV=development
DATA_DIR=.data
# MONGODB_URI=            # off → local .data/db.json; or paste your Atlas URI

# ── auth (dev) ──
SESSION_SECRET=<paste node randomBytes hex>
ENCRYPTION_KEY=<paste node randomBytes hex>
DEV_LOGIN=1
COOKIE_SECURE=0
ALLOWED_GITHUB_LOGINS=

# ── Secure Vault ──
KOSH_ADMIN_LOGIN=          # empty in dev → you (darshan) are admin
VAULT_DIR=.vault-data
# VAULT_R2_BUCKET=

# ── GitHub Repository Manager ──
# Easiest: leave these blank and paste your PAT in Settings → GitHub.
# GITHUB_CLIENT_ID=
# GITHUB_CLIENT_SECRET=
# KOSH_GITHUB_TOKEN=ghp_...

# ── optional ──
# ANTHROPIC_API_KEY=sk-ant-...
```

### 7.2 PRODUCTION `.env` (the API refuses to boot if these are unsafe)

```dotenv
VITE_API_URL=https://your-api-domain/api
APP_URL=https://your-app-domain
API_URL=https://your-api-domain

NODE_ENV=production
PORT=8787

SESSION_SECRET=<64-char random>          # not "change-me"
ENCRYPTION_KEY=<64-char random, stable>
DEV_LOGIN=0                              # prod won't start otherwise
COOKIE_SECURE=1
ALLOWED_GITHUB_LOGINS=your-github-login

GITHUB_CLIENT_ID=<oauth client id>
GITHUB_CLIENT_SECRET=<oauth client secret>

MONGODB_URI=mongodb+srv://user:pass@cluster0.xxxx.mongodb.net/kosh?retryWrites=true&w=majority

KOSH_ADMIN_LOGIN=your-github-login       # lock the vault to you
VAULT_DIR=/mnt/encrypted-volume/kosh-vault
# or: VAULT_R2_BUCKET=kosh-vault  (+ the R2_* keys below)

# R2_ACCOUNT_ID=...
# R2_ACCESS_KEY_ID=...
# R2_SECRET_ACCESS_KEY=...
# R2_BUCKET=kosh
```

---

## 8. Production checklist (startup fail-fast)

In `production`, the API **refuses to start** unless all of these are safe:

- `SESSION_SECRET` — set to a strong random value (not `change-me`, not the dev key).
- `ENCRYPTION_KEY` — set, **≥ 16 characters**, not the dev key.
- `DEV_LOGIN=0` — password-less login must be off.

Also recommended for production: `COOKIE_SECURE=1`, `KOSH_ADMIN_LOGIN` set,
`ALLOWED_GITHUB_LOGINS` set, real OAuth (`GITHUB_CLIENT_ID`/`SECRET`), and
`MONGODB_URI` for durable persistence.

---

## 9. Verify your setup

```bash
npm run typecheck    # TypeScript across all packages
npm test             # unit tests
npm run build        # production build of everything
```

---

## 10. The bare minimum to use everything, locally

1. Generate two secrets (Section 4) → paste into the dev `.env` (Section 7.1).
2. `npm install && npm run dev`.
3. Paste a GitHub **`repo`** PAT in **Settings → GitHub** (Section 6.1).
4. *(Optional)* add `MONGODB_URI` for a real database; otherwise data persists to
   `.data/db.json`.

Everything else (R2, Anthropic, Telegram, OAuth) is optional.

> ⚠️ **Secure Vault:** the master password has **no recovery**. If you lose it, the
> encrypted data is permanently unreadable — that is the price of real end-to-end
> encryption. Store the password safely offline.
