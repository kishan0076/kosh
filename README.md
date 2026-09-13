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
  fetching, Open Graph scraping, optional Claude (Haiku) summaries, content-addressed object storage, skill
  lint + security scan + versioning, SSE, and the full REST surface. It uses a **ports-and-adapters** store:
  real **Mongoose** schemas for production, and an in-memory/JSON adapter (the default) so it boots with
  **no database, Docker, or credentials** required.
- **`packages/shared`** — pure, tested domain logic shared by both (types, URL normalize/classify, repo-kind
  detection, install extraction, skill lint, security scan, formatters). 25 unit tests.

Structured as the monorepo from [`docs/kosh-build-plan-v3.md`](docs/kosh-build-plan-v3.md).

```
kosh/
├─ apps/
│  ├─ web/            Vite + React 19 + TS + Tailwind v4 — the app
│  └─ api/            Express 5 + ports-and-adapters store (memory default · Mongoose for prod)
├─ packages/
│  └─ shared/         Pure, tested domain logic
├─ infra/             docker-compose (Mongo 7 + MinIO) + .env.example for a full deployment
├─ docs/              The build plan + the design system reference
└─ turbo.json · pnpm-workspace.yaml · tsconfig.base.json · CLAUDE.md
```

---

## Quick start

Requirements: **Node 22+** and **pnpm 10+**.

### Front-end only (zero setup)

```bash
pnpm install
pnpm web          # web app with the seeded client store  →  http://localhost:5173
```

### Full stack (web + live API)

The API needs no database or keys — it defaults to an in-memory/JSON store and does live npm/PyPI enrichment
out of the box (GitHub enrichment needs network access to `api.github.com`).

```bash
pnpm install
pnpm --filter @kosh/api seed     # optional: load a demo vault into .data/
pnpm --filter @kosh/api dev      # API on http://localhost:8787  (DEV_LOGIN is on in dev)

# in another terminal — point the web app at the API:
VITE_API_URL=http://localhost:8787/api pnpm web
```

The web app then authenticates (dev-login), hydrates from the API, and streams live enrichment over SSE.
To use real MongoDB and Cloudflare R2, set `MONGODB_URI` and the `R2_*` vars (see `.env.example`); the code
paths are the same.

Other scripts:

```bash
pnpm build        # build every package (turbo)
pnpm test         # run the shared-logic test suite (vitest, 25 tests)
pnpm typecheck    # typecheck the workspace
pnpm web:build    # production build of the web app
```

In front-end-only mode everything is seeded on first run — use the avatar menu → **Reset demo data** to
restore the sample vault.

---

## What you can do in the app

| Area | What works |
|---|---|
| **Home** | A decision-first dashboard: *Today's Pick* (Try / Snooze / Drop), *Needs Attention*, four KPI tiles with sentiment-aware deltas + sparklines, a *Saved-over-time* trend chart, a *Curation Health* gauge with the single next-best action, an adoption funnel, and "because you saved…" recommendations. |
| **Quick-Add** | One bar that morphs to intent: paste a link → it materializes as a card; paste a GitHub URL → "Add repo"; drop a folder → a tray opens, lints + security-scans a `SKILL.md`, and saves it. |
| **⌘K palette** | Universal search + capture on [`cmdk`]. Paste a bare `github.com/o/r`, save with `↵`, or `⌘↵` to save and keep capturing. |
| **Library** | Heterogeneous card grid (repos, packages, articles, skills, prompts, files) with a language edge / tool tab per kind, a segmented kind filter with counts, stage + tag filters, and a **Board** view grouped by stage. |
| **Skills** | Catalog filtered by tool + trust, each card showing tool badges, trust, lint/scan health and version. A slide-over detail with a file tree + viewer, **scan findings**, a **trust gate** before install, version switcher, and a "New skill" composer that lints + scans live. |
| **Prompts** | Prompt cards with `{{variable}}` parsing and a fill-and-copy dialog that bumps usage. |
| **Inbox** | Keyboard-first triage (`U`/`T`/`D`/`X`/`S`, `←`/`→`) to burn down new captures to inbox-zero. |
| **Collections · Trash · Settings** | Group items; soft-delete with undo + restore/purge; profile, appearance, storage/budget meters, ways-in snippets (CLI/MCP/bot/bookmarklet), API keys, tag maintenance, export. |

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
- **CLI (`packages/cli`):** `kosh login/list/add/push/status/import-local` with the install trust gate.
- **Shared:** dependency-free, unit-tested domain logic (`@kosh/shared`).

### CLI & MCP

```bash
# CLI
node packages/cli/dist/index.js login --api-url http://localhost:8787/api --key ksh_...
kosh list
kosh add pdf-tools --to claude       # refuses unreviewed skills unless --yes

# MCP (Claude Code) — Streamable HTTP, bearer API key, 7 tools
claude mcp add --transport http kosh http://localhost:8787/api/mcp -H "Authorization: Bearer ksh_..."
```

## Safety by design

Even in the front-end demo, the product's security posture is visible: markdown is rendered through
`rehype-sanitize` (never `dangerouslySetInnerHTML`), skills carry a static **scan** that flags
pipe-to-shell installs, prompt-injection phrasing, hidden Unicode and secret-path access, and an
**install trust gate** blocks an unreviewed, risky skill until you read the findings. The URL normalizer,
skill linter and scanner live in `packages/shared` with tests.

---

## License

Personal project scaffold. See the build plan for the full product roadmap.
