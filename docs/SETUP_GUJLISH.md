# Kosh — Complete Setup Guide (Gujlish)

Aa guide ma tamne Kosh ne zero thi setup karvanu, badha token kai rite melvva, ane
**badha environment variables** detail ma samjaavu chhu. English version ahiya chhe:
[`SETUP.md`](./SETUP.md).

- Detail guides: [`MONGODB_ATLAS_SETUP.md`](./MONGODB_ATLAS_SETUP.md) (database) ane
  [`SECURE_VAULT.md`](./SECURE_VAULT.md) (admin-only encrypted vault).

---

## 0. Pehla su joiye (Prerequisites)

- **Node.js ≥ 22** ane **npm 10** (repo ma `npm@10.9.7` pin karel chhe).
- Aa ek **npm workspaces + Turborepo** monorepo chhe — Docker ni jarurat nathi, pnpm ni jarurat nathi.

```bash
node -v            # v22 ke tena thi upar hovu joiye
npm install        # repo na root ma thi chalavo — badha workspace install thai jashe
```

---

## 1. Be run mode (aa pehla vaancho)

Kosh be mode ma chale chhe, ek j variable `VITE_API_URL` thi nakki thay:

| Mode | Kyare | Su made |
| --- | --- | --- |
| **Demo** | `VITE_API_URL` **set nathi** | Badhu browser ma j chale, data `localStorage` ma. **Secure Vault nahi, server persistence nahi, GitHub publish nahi.** |
| **Backend** | `VITE_API_URL` **set chhe** | API sathe vaat kare → saachi persistence, **Secure Vault**, ane **GitHub Repository Manager** badhu kaam kare. |

> Je features banaavya (Secure Vault, reliable persistence, GitHub Repository
> Manager) e vaaparva mate tamare **backend mode** ma chalavu **pade**: API chalu
> hovu joiye **ane** `VITE_API_URL` set hovu joiye.

---

## 2. `.env` file kya rakhvi

Repo na **root ma ek j `.env` file** banaavo. `apps/web` ane `apps/api` banne tyaan
thi j vaanche chhe. Template thi start karo:

```bash
cp .env.example .env
```

Pachhi Section 5 na reference thi `.env` edit karo.

---

## 3. Kai rite chalavvu

```bash
npm run dev        # web app ANE API banne sathe chale (Turborepo)
```

- Web app → **http://localhost:5173**
- API → **http://localhost:8787**

Alag alag chalavvu hoy to:

```bash
npm run api        # fakt API
npm run web        # fakt web
```

Dev ma web app tamne **automatic login** kari de chhe `darshan` login thi (kem ke
`DEV_LOGIN=1`). Pachhi **Secure Vault** top-right account menu ma dekhaay (fakt
admin ne), athva sidhu **`/vault`** kholo.

---

## 4. Je secrets tame jaate banaavo (koi website ni jarurat nahi)

Be secrets **generate** karva na chhe, koi service thi levaana nathi. Aa command
chalavo ane output `.env` ma paste karo:

```bash
# SESSION_SECRET — tamaru login cookie sign kare
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# ENCRYPTION_KEY — tamaro GitHub token store thay tyare encrypt kare (aa HAMESHA same rakho)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# EMAIL_INBOUND_SECRET / TELEGRAM_WEBHOOK_SECRET — fakt e integration vaapro to j
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```

(`openssl rand -hex 32` pan chale.)

> ⚠️ Jo tame `ENCRYPTION_KEY` badlo, to pehla thi save thayel GitHub token decrypt
> nahi thai sake — tamare fakt Settings ma fari thi paste karvo pade.

---

## 5. Dareki environment variable, detail ma

Dareki entry: **su kaam kare · jaruri ke optional · default · kai rite melvvi / set karvi.**

### 5.1 Core / web

#### `VITE_API_URL`
- **Su:** web app je API base URL sathe vaat kare. Aa set karta j app demo mode
  thi **backend mode** ma jaay (persistence + vault + publish).
- **Jaruri:** ha, koi pan server feature vaaparva mate. Fakt demo mate j khaali rakho.
- **Default:** set nathi (demo mode).
- **Kai rite set:** `/api` path saathe. Dev value:
  `VITE_API_URL=http://localhost:8787/api`. Prod: `https://your-api-domain/api`.

#### `PORT`
- **Su:** API kaya port par sambhale.
- **Jaruri:** na.
- **Default:** `8787`.

#### `NODE_ENV`
- **Su:** `development` athva `production`. `production` ma API start vakhte
  **security fail-fast** check kare (juo Section 8).
- **Jaruri:** na (pan deploy karo tyare `production` rakho).
- **Default:** `development`.

#### `APP_URL` / `API_URL`
- **Su:** web app ane API na public URL. GitHub OAuth redirect ane link banaava mate.
- **Jaruri:** fakt GitHub OAuth vaapro athva deploy karo tyare.
- **Default:** `http://localhost:5173` ane `http://localhost:8787`.

### 5.2 Authentication

#### `SESSION_SECRET`
- **Su:** session cookie sign kare.
- **Jaruri:** production ma ha (weak/default value hoy to API start j nahi thay).
- **Default:** ek insecure dev key.
- **Kai rite melvvu:** generate karo (Section 4).

#### `ENCRYPTION_KEY`
- **Su:** store thayel secrets (jem ke tamaro GitHub token) encrypt kare.
- **Jaruri:** production ma ha; **≥ 16 characters** hovu joiye.
- **Default:** ek insecure dev key.
- **Kai rite melvvu:** generate karo (Section 4). Hamesha same rakho.

#### `DEV_LOGIN`
- **Su:** password vagar login chalu kare (`POST /auth/dev-login`). Dev ma web app
  aa thi `darshan` tarike auto-login kare.
- **Jaruri:** na. **Production ma `0` HOVU J JOIYE** — production ma aa chalu hoy to
  API start nahi thay.
- **Default:** non-production ma `1`, production ma off.

#### `COOKIE_SECURE`
- **Su:** session cookie ne `Secure` (fakt HTTPS) banaave.
- **Jaruri:** na. Local http mate `0`, production https mate `1`.
- **Default:** production ma `1`, baaki `0`.

#### `ALLOWED_GITHUB_LOGINS`
- **Su:** comma thi alag karel login allowlist je sign in kari sake. Khaali = badha ne allow.
- **Jaruri:** na.
- **Default:** khaali.
- **Note (dev):** dev auto-login user `darshan` chhe, etle jo dev ma aa set karo to
  `darshan` include karo, nahi to login refuse thashe.

#### `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`
- **Su:** token paste karva ne badle "Connect with GitHub" (OAuth) chalu kare.
- **Jaruri:** na (dev login local use mate puratu chhe).
- **Kai rite melvvu:** juo Section 6.2.

#### `KOSH_GITHUB_TOKEN`
- **Su:** optional **server-wide** GitHub token, enrichment mate / publish fallback
  tarike jyare user e potano token connect na karyo hoy.
- **Jaruri:** na.
- **Kai rite melvvu:** ek Personal Access Token — juo Section 6.1.

### 5.3 Persistence ("refresh pachi data gayab thai jaay" no fix)

#### `MONGODB_URI`
- **Su:** MongoDB nu connection string. **Set nathi → local JSON file**
  (`.data/db.json`, restart pachi pan rahe). **Set chhe → MongoDB Atlas** (durable,
  production mate recommended).
- **Jaruri:** na (pan production mate recommended).
- **Default:** set nathi (local JSON store).
- **Kai rite melvvu:** juo Section 6.3 ane [`MONGODB_ATLAS_SETUP.md`](./MONGODB_ATLAS_SETUP.md).

#### `DATA_DIR`
- **Su:** local JSON store ane locally save thayel uploads mate directory.
- **Jaruri:** na.
- **Default:** `.data`.

### 5.4 Object storage (files / screenshots)

#### `R2_ENDPOINT`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`
- **Su:** upload thayel files mate Cloudflare R2 (athva koi pan S3-compatible)
  storage. Set na hoy to files local filesystem ma `DATA_DIR` niche rahe.
- **Jaruri:** na.
- **Default:** local filesystem; `R2_BUCKET` default `kosh`.
- **Kai rite melvvu:** juo Section 6.4. `R2_ACCOUNT_ID` (production) athva
  `R2_ENDPOINT` (custom/S3/B2) set karo — `R2_ENDPOINT` aapo to S3 client path-style
  addressing par switch thay.

### 5.5 Secure Vault (fakt admin, end-to-end encrypted)

#### `KOSH_ADMIN_LOGIN`
- **Su:** kayo login Secure Vault khol sake. Aa **defense-in-depth** server gate
  chhe (data pan tamara master password vagar useless chhe).
- **Jaruri:** khub recommended; **production ma hamesha set karo**.
- **Default:** pehla `ALLOWED_GITHUB_LOGINS` par fallback; non-production dev-login
  mode ma banne set na hoy to koi pan authenticated user admin (fail-closed:
  production ma aa kyarey apply nahi thay).
- **Kai rite set:** tamaro login. Dev ma `darshan`; production ma tamaru GitHub
  username. (Aa naam chhe, token nathi.)

#### `VAULT_DIR`
- **Su:** vault **ciphertext** mate alag directory, `DATA_DIR` thi **alag** rakhel,
  ane kyarey MongoDB ma nahi.
- **Jaruri:** na.
- **Default:** `.vault-data`.
- **Tip:** vadhu safety mate OS-encrypted volume par point karo.

#### `VAULT_R2_BUCKET`
- **Su:** optional — vault ciphertext ne local dir na badle **potaana R2/S3 bucket**
  ma store karo (`R2_*` credentials j vaapre, pan `R2_BUCKET` karta **alag** bucket).
- **Jaruri:** na.
- **Default:** set nathi (`VAULT_DIR` vaapre).
- **Kai rite melvvu:** biju R2 bucket banaavo — juo Section 6.4 ane
  [`SECURE_VAULT.md`](./SECURE_VAULT.md).

### 5.6 GitHub Repository Manager token resolution

GitHub Repository Manager (repo banaavvu + folder upload) ne **`repo`** scope waalo
token joiye. Aa order ma resolve thay (pehlu je male e chale):

1. App ma **paste karel** token → *Settings → GitHub* (encrypted store thay). ← saune saralu
2. **OAuth** — `GITHUB_CLIENT_ID` + `GITHUB_CLIENT_SECRET`.
3. Server fallback `KOSH_GITHUB_TOKEN`.

### 5.7 Optional integrations

#### `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` / `AI_DAILY_CAP_USD`
- **Su:** AI auto-tags/summaries chalu kare. `ANTHROPIC_MODEL` default
  `claude-haiku-4-5`; kharcho `AI_DAILY_CAP_USD` (default `2`) thi cap thay.
- **Jaruri:** na.
- **Kai rite melvvu:** juo Section 6.5.

#### `TELEGRAM_BOT_TOKEN` / `TELEGRAM_WEBHOOK_SECRET`
- **Su:** Telegram bot thi items save karo.
- **Jaruri:** na.
- **Kai rite melvvu:** juo Section 6.6.

#### `EMAIL_INBOUND_SECRET` / `EMAIL_ALLOWED_SENDERS`
- **Su:** email thi items save karo (`infra/email-worker` na Cloudflare email worker
  thi). `EMAIL_ALLOWED_SENDERS` comma thi alag allowlist chhe (production ma jaruri).
- **Jaruri:** na.

#### `ENABLE_JOBS`
- **Su:** scheduled background jobs chalu kare (raatre trash purge, weekly repo refresh).
- **Jaruri:** na.
- **Default:** `0`.

---

## 6. Dareko token kai rite melvvo (step by step)

### 6.1 GitHub Personal Access Token — Repository Manager mate ⭐
Scope joiye: **`repo`**.

1. **https://github.com/settings/tokens** par jao → **Generate new token → Tokens (classic)**.
2. **Note:** `kosh`. **Expiration:** tamari marji.
3. **Select scopes → `repo` check karo** (full — repo banaavva ane files push karva de).
4. **Generate token** → `ghp_…` value copy karo (fakt ek j vaar dekhaay).
5. Saune saralu: app start karo → **Settings → GitHub → token paste karo** (validate
   thai ne encrypted store thay). `.env` ma `KOSH_GITHUB_TOKEN` tarike fakt tyare mukho
   jyare server-wide fallback joiye.

> Fine-grained token alternative: **Administration: Read & write** (repo banaavva) +
> **Contents: Read & write** joiye. Classic `repo` saralu chhe.

### 6.2 GitHub OAuth App — `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`
1. **https://github.com/settings/developers** → **New OAuth App**.
2. **Homepage URL:** `http://localhost:5173` (dev) athva tamaro production URL.
3. **Authorization callback URL:** `http://localhost:8787/api/auth/github/callback`
   (`API_URL` + `/api/auth/github/callback` sathe match thavu joiye).
4. **Register application** → **Client ID** copy karo; **Generate a new client
   secret** → e copy karo.
5. Banne `.env` ma mukho. Dev ma OAuth sampurna skip kari shako (`DEV_LOGIN=1`).

### 6.3 MongoDB Atlas — `MONGODB_URI`
Puro guide: [`MONGODB_ATLAS_SETUP.md`](./MONGODB_ATLAS_SETUP.md). Ttunku:

1. **https://cloud.mongodb.com** → sign up → **free M0 cluster banaavo**.
2. **Database Access → Add New Database User** (username + password; save karo).
3. **Network Access → Add IP Address** → testing mate `0.0.0.0/0` (pachi tight karo).
4. **Clusters → Connect → Drivers** → URI copy karo:
   ```
   mongodb+srv://<user>:<password>@cluster0.xxxx.mongodb.net/kosh?retryWrites=true&w=majority
   ```
5. `<user>`/`<password>` badlo, db naam `kosh` rakho, `MONGODB_URI` tarike set karo.

### 6.4 Cloudflare R2 — `R2_*` ane `VAULT_R2_BUCKET`
Puro guide: [`SECURE_VAULT.md`](./SECURE_VAULT.md) (Option B). Ttunku:

1. **https://dash.cloudflare.com → R2 → Create bucket** — jem ke app files mate
   `kosh`, ane vault mate **alag** `kosh-vault`.
2. **R2 → Manage R2 API Tokens → Create API Token** → **Object Read & Write** →
   **Access Key ID**, **Secret Access Key**, ane **Account ID** copy karo.
3. `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET=kosh`,
   ane (vault mate) `VAULT_R2_BUCKET=kosh-vault` bharo.

### 6.5 Anthropic API key — `ANTHROPIC_API_KEY`
1. **https://console.anthropic.com → Settings → API Keys → Create Key** → `sk-ant-…` copy karo.
2. `.env` ma mukho.

### 6.6 Telegram bot token — `TELEGRAM_BOT_TOKEN`
1. Telegram ma **@BotFather** ne message karo → `/newbot` → steps follow karo →
   `123456:ABC…` token copy karo.

---

## 7. Complete `.env` templates

### 7.1 DEV `.env` (be generated secrets bharo ane chalu)

```dotenv
# ── backend mode (vault + persistence + publish mate jaruri) ──
VITE_API_URL=http://localhost:8787/api

# ── API ──
PORT=8787
NODE_ENV=development
DATA_DIR=.data
# MONGODB_URI=            # off → local .data/db.json; athva tamaru Atlas URI paste karo

# ── auth (dev) ──
SESSION_SECRET=<node randomBytes hex paste karo>
ENCRYPTION_KEY=<node randomBytes hex paste karo>
DEV_LOGIN=1
COOKIE_SECURE=0
ALLOWED_GITHUB_LOGINS=

# ── Secure Vault ──
KOSH_ADMIN_LOGIN=          # dev ma khaali → tame (darshan) admin chho
VAULT_DIR=.vault-data
# VAULT_R2_BUCKET=

# ── GitHub Repository Manager ──
# Saralu: aa khaali rakho ane Settings → GitHub ma PAT paste karo.
# GITHUB_CLIENT_ID=
# GITHUB_CLIENT_SECRET=
# KOSH_GITHUB_TOKEN=ghp_...

# ── optional ──
# ANTHROPIC_API_KEY=sk-ant-...
```

### 7.2 PRODUCTION `.env` (aa safe na hoy to API start j nahi thay)

```dotenv
VITE_API_URL=https://your-api-domain/api
APP_URL=https://your-app-domain
API_URL=https://your-api-domain

NODE_ENV=production
PORT=8787

SESSION_SECRET=<64-char random>          # "change-me" nahi
ENCRYPTION_KEY=<64-char random, stable>
DEV_LOGIN=0                              # nahi to prod start nahi thay
COOKIE_SECURE=1
ALLOWED_GITHUB_LOGINS=your-github-login

GITHUB_CLIENT_ID=<oauth client id>
GITHUB_CLIENT_SECRET=<oauth client secret>

MONGODB_URI=mongodb+srv://user:pass@cluster0.xxxx.mongodb.net/kosh?retryWrites=true&w=majority

KOSH_ADMIN_LOGIN=your-github-login       # vault fakt tamara mate lock
VAULT_DIR=/mnt/encrypted-volume/kosh-vault
# athva: VAULT_R2_BUCKET=kosh-vault  (+ niche na R2_* keys)

# R2_ACCOUNT_ID=...
# R2_ACCESS_KEY_ID=...
# R2_SECRET_ACCESS_KEY=...
# R2_BUCKET=kosh
```

---

## 8. Production checklist (startup fail-fast)

`production` ma API **start j nahi thay** jya sudhi aa badhu safe na hoy:

- `SESSION_SECRET` — strong random value (na `change-me`, na dev key).
- `ENCRYPTION_KEY` — set, **≥ 16 characters**, dev key nahi.
- `DEV_LOGIN=0` — password vagar login band hovu joiye.

Production mate aa pan recommended: `COOKIE_SECURE=1`, `KOSH_ADMIN_LOGIN` set,
`ALLOWED_GITHUB_LOGINS` set, saachu OAuth (`GITHUB_CLIENT_ID`/`SECRET`), ane durable
persistence mate `MONGODB_URI`.

---

## 9. Setup verify karo

```bash
npm run typecheck    # badha packages par TypeScript
npm test             # unit tests
npm run build        # badhu production build
```

---

## 10. Locally badhu vaaparva mate saune ochhu (bare minimum)

1. Be secrets generate karo (Section 4) → dev `.env` (Section 7.1) ma paste karo.
2. `npm install && npm run dev`.
3. **Settings → GitHub** ma GitHub **`repo`** PAT paste karo (Section 6.1).
4. *(Optional)* saachu database mate `MONGODB_URI` add karo; nahi to data
   `.data/db.json` ma rahe.

Baaki badhu (R2, Anthropic, Telegram, OAuth) optional chhe.

> ⚠️ **Secure Vault:** master password nu **koi recovery nathi**. Jo bhuli gaya to
> encrypted data kayamu mate na vaanchi shakay — aa saachu end-to-end encryption ni
> kimmat chhe. Password ne safe rite offline rakho.
