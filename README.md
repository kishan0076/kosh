# Kosh — your AI toolbox, curated

> **Kosh** (કોશ) means *treasury*. Links, GitHub repos, agent **skills**, prompts and files go in —
> one curated, searchable library comes out. It's a personal vault **and** a package manager for the
> tools your AI assistants use (Claude Code, Codex, Cursor, Gemini…).

Kosh isn't another bookmark graveyard. Every item carries **where you found it**, a **stage**
(to-try → trying → using → dropped), a **verdict**, and — for skills — a **trust level**, a **security
scan**, and **install commands** for every agent. The home screen is a *decision surface*, not a wall of
charts: it tells you what to try next and what needs attention.

<p align="center"><em>Modern, spacious, analytics-grade UI in a full light &amp; dark theme.</em></p>

---

## What's in this repository

A **working full stack**:

- **`apps/web`** — a real, runnable React app implementing the complete product experience. It runs
  standalone against a rich, seeded client-side store (persisted to `localStorage`) with **zero setup**, and
  transparently switches to the live API when `VITE_API_URL` is set.
- **`apps/api`** — a real **Express 5** server: GitHub OAuth / dev-login + JWT cookies + hashed API keys, the
  ingest pipeline (`p-queue` + `p-retry`), **live GitHub / npm / PyPI / crates enrichment**, SSRF-safe
  fetching, Open Graph scraping, optional Claude (Haiku) summaries, **content-addressed object storage with
  presigned/direct uploads**, skill lint + security scan + versioning, **ranked search**, **email-in**, an
  **MCP server**, a **Telegram bot**, SSE, and the full REST surface. It uses a **ports-and-adapters** store:
  real **Mongoose** schemas for production, and an in-memory/JSON adapter (the default) so it boots with
  **no database, Docker, or credentials** required.
- **`packages/shared`** — pure, tested domain logic shared by both (types, URL normalize/classify, repo-kind
  detection, install extraction, skill lint, security scan, the ranked search engine, formatters). 33 unit tests.

Structured as the monorepo from [`docs/kosh-build-plan-v3.md`](docs/kosh-build-plan-v3.md).

```
kosh/
├─ apps/
│  ├─ web/            Vite + React 19 + TS + Tailwind v4 — the app
│  └─ api/            Express 5 + ports-and-adapters store (memory default · Mongoose for prod)
├─ packages/
│  ├─ shared/         Pure, tested domain logic (incl. the ranked search engine)
│  └─ cli/            `npx kosh …` — install skills into any agent, with the trust gate
├─ infra/
│  └─ email-worker/        Cloudflare email worker → POST /api/email/inbound
├─ docs/              The build plan + the design system reference
├─ .github/workflows/ CI: typecheck · test · build on every PR and on main · Android APK build
└─ turbo.json · package.json (npm workspaces) · tsconfig.base.json · CLAUDE.md
```

---

## Quick start

Requirements: **Node 22+** and **npm 10+** (npm workspaces + Turborepo).

### Front-end only (zero setup)

```bash
npm install
npm run web       # web app with the seeded client store  →  http://localhost:5173
```

### Full stack (web + live API)

The API needs no database or keys — it defaults to an in-memory/JSON store and does live npm/PyPI enrichment
out of the box (GitHub enrichment needs network access to `api.github.com`).

```bash
npm install
npm run seed      # optional: load a demo vault into .data/
npm run api       # API on http://localhost:8787  (DEV_LOGIN is on in dev)

# in another terminal — the web app reads VITE_API_URL from the repo-root .env:
npm run web
```

The web app then authenticates (dev-login), hydrates from the API, and streams live enrichment over SSE.
To use real MongoDB and Cloudflare R2, set `MONGODB_URI` and the `R2_*` vars (see `.env.example`); the code
paths are the same. For a step-by-step MongoDB Atlas walkthrough (cluster, user, connection string) and an
explanation of how Kosh does CRUD against MongoDB, see [`docs/MONGODB_ATLAS_SETUP.md`](docs/MONGODB_ATLAS_SETUP.md).

There's also an admin-only, **end-to-end-encrypted Secure Vault** for personal secrets, notes and
files — encrypted in the browser, stored separately from the app data. See
[`docs/SECURE_VAULT.md`](docs/SECURE_VAULT.md).

Other scripts:

```bash
npm run build     # build every package (turbo)
npm test          # run the test suites (vitest — 33 shared + 9 API)
npm run typecheck # typecheck the workspace
npm run web:build # production build of the web app
```

A ready-to-run `.env` for local dev (in-memory store, local file storage, `DEV_LOGIN`, generated
secrets) lives at the repo root; copy [`.env.example`](.env.example) if you need the documented template.

In front-end-only mode everything is seeded on first run — use the avatar menu → **Reset demo data** to
restore the sample vault.

### Mobile app (Android / iOS)

The same web bundle ships as a native app via **Capacitor** — same API, same data, one codebase. The
Android APK builds in GitHub Actions (**Actions → Android APK**, set the `MOBILE_API_URL` variable first);
iOS builds from the committed Xcode project. Sign-in and Connect flows run in the system browser and return
by deep link; sessions use a Bearer token instead of the cookie. See [`docs/MOBILE.md`](docs/MOBILE.md) for
the responsiveness audit, the architecture, and step-by-step build/release instructions.

```bash
npm run build:mobile -w @kosh/web   # vite build + cap sync
npm run cap:android -w @kosh/web    # open in Android Studio     (or: npm run cap:ios)
```

---

## What you can do in the app

| Area | What works |
|---|---|
| **Home** | A decision-first dashboard: *Today's Pick* (Try / Snooze / Drop), *Needs Attention*, four KPI tiles with sentiment-aware deltas + sparklines, a *Saved-over-time* trend chart, a *Curation Health* gauge with the single next-best action, an adoption funnel, and "because you saved…" recommendations. |
| **Quick-Add** | One bar that morphs to intent: paste a link → it materializes as a card; paste a GitHub URL → "Add repo"; drop a folder → a tray opens, lints + security-scans a `SKILL.md`, and saves it. |
| **⌘K palette** | Ranked, filter-aware search + capture on [`cmdk`] — free text plus `kind:`/`tag:`/`stage:`/`is:pinned`/`is:repo` operators (one engine shared with the API's `GET /search` and MCP). Paste a bare `github.com/o/r`, save with `↵`, or `⌘↵` to save and keep capturing. |
| **Uploads** | Drop a folder or file and the bytes go **straight to storage** (presigned R2, or a local endpoint) — never through the JSON API — deduped by content hash and finalized by reference (`§6.2`). |
| **Library** | Heterogeneous card grid (repos, packages, articles, skills, prompts, files) with a language edge / tool tab per kind, a segmented kind filter with counts, stage + tag filters, and a **Board** view grouped by stage. |
| **Skills** | Catalog filtered by tool + trust, each card showing tool badges, trust, lint/scan health and version. A slide-over detail with a file tree + viewer, **scan findings**, a **trust gate** before install, version switcher, and a full **in-app editor** (live lint + scan + rendered preview) — **New skill** or **Edit** an existing one, which writes a new version and preserves its supporting files. |
| **Prompts** | Prompt cards with `{{variable}}` parsing and a fill-and-copy dialog that bumps usage. |
| **Inbox** | Keyboard-first triage (`U`/`T`/`D`/`X`/`S`, `←`/`→`) to burn down new captures to inbox-zero. |
| **Collections · Trash · Settings** | Group items; soft-delete with undo + restore/purge; profile, appearance, storage/budget meters, **every way-in** (CLI · MCP · Telegram bot · bookmarklet · Android PWA share · iOS Shortcut · email-in), API keys, tag maintenance (rename · delete · **merge**), export. |
| **Ways in** | Save from anywhere into the same vault: the web app, the **native Android / iOS app**, the ⌘K palette, a **PWA share target** (`/share`), a bookmarklet, the **Telegram bot**, **email-in** (forward a newsletter → its links land in the Inbox), the **CLI**, and **MCP**. |

The **link/skill is always saved first** — enrichment (stars, README, AI summary) never blocks a save,
exactly as the plan specifies.

---

## Design

The visual direction is **"a vault with a light inside"** — the clean, spacious, rounded-card polish of a
modern analytics dashboard, with a dual-accent identity:

- **Indigo** = interaction (buttons, focus, active nav, the lead chart series).
- **Gold** = treasure, used sparingly for earned moments (the capture "materialize" pulse, pins/favorites,
  the Curation Health hero).

It ships a complete **light and dark theme** built on semantic CSS-variable tokens wired through Tailwind v4's
`@theme inline`, with a no-flash init, live `prefers-color-scheme` sync, an explicit user override, and
`prefers-reduced-motion` support throughout. Charts are hand-rolled SVG so a theme switch re-colors them with
zero JS. Full details in [`docs/DESIGN.md`](docs/DESIGN.md).

---

## Tech

- **Front-end:** Vite 7 · React 19 · TypeScript (strict) · React Router 7 · Zustand · Tailwind CSS v4 ·
  `motion` · `cmdk` · `react-markdown` + `remark-gfm` + `rehype-sanitize` · `lucide-react`.
- **Backend (`apps/api`):** Node 22 · Express 5 · Mongoose 8 (+ in-memory adapter) · Cloudflare R2 / S3
  (+ local FS) · `octokit` · Anthropic SDK · grammY (Telegram) · MCP Streamable HTTP · `p-queue`/`p-retry` ·
  `node-cron`.
- **CLI (`packages/cli`):** `kosh login/list/add/push/status/sync/import-local` with the install trust gate;
  `kosh add owner/repo:path` copies an indexed skill from a saved repo, then installs it.
- **Shared:** dependency-free, unit-tested domain logic (`@kosh/shared`).

### CLI & MCP

```bash
# CLI
node packages/cli/dist/index.js login --api-url http://localhost:8787/api --key ksh_...
kosh list
kosh add pdf-tools --to claude          # refuses unreviewed skills unless --yes
kosh add anthropics/skills:skills/pdf   # copy an indexed skill from a saved repo, then install

# MCP (Claude Code) — Streamable HTTP, bearer API key, 7 tools
claude mcp add --transport http kosh http://localhost:8787/api/mcp -H "Authorization: Bearer ksh_..."
```

## Safety by design

Even in the front-end demo, the product's security posture is visible: markdown is rendered through
`rehype-sanitize` (never `dangerouslySetInnerHTML`), skills carry a static **scan** that flags
pipe-to-shell installs, prompt-injection phrasing, hidden Unicode and secret-path access, and an
**install trust gate** blocks an unreviewed, risky skill until you read the findings. The URL normalizer,
skill linter and scanner live in `packages/shared` with tests.

On the server: every fetch of a user-supplied URL goes through an **SSRF-guarded `safeFetch`**, user
secrets (GitHub tokens) are **encrypted at rest** (AES-256-GCM) and the API **refuses to boot in
production** with an unset/insecure `SESSION_SECRET`/`ENCRYPTION_KEY`; uploaded objects are **re-hashed**
to enforce content addressing; per-route **rate limits** cap the amplifying endpoints; and the web app
ships a **CSP** (`apps/web/public/_headers`). Email-in routes only by an unguessable per-user token and
requires a sender allowlist in production.

---

## License

Personal project scaffold. See the build plan for the full product roadmap.
