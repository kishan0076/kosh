# Roadmap status

Tracks the strategic feature roadmap against what's actually implemented. Numbers match the roadmap tiers.

## Shipped

| # | Feature | Where |
|---|---------|-------|
| 1 | Link archiving / read-it-later snapshots | `packages/shared/readable.ts`, `modules/archive.ts`, detail drawer |
| 2 | Unified search + "Ask your treasury" (RAG, lexical) | `modules/ask.ts`, `/search` page |
| 3 | Smart Inbox triage (AI tag suggestions, dedupe, accept-all) | `pages/Inbox.tsx` |
| 4 | MCP Context Packs (+ pinning, agent-writable, sharing, diff, auto-pack) | `modules/packs.ts`, `modules/autopack.ts`, `mcp/server.ts`, `/packs` |
| 5 | Skill/Prompt Playground (run, fill variables, A/B) | `modules/complete.ts`, `components/detail/PromptPlayground.tsx` |
| 6 | Automations / Rules engine | `packages/shared/rules.ts`, `modules/rules.ts`, `routes/rules.ts`, `/automations` |
| 7 | Encrypted Drive folders (client-side E2EE, **behind a feature flag**) | `packages/shared/filecrypt.ts`, `apps/web/src/lib/driveEncryption.ts`, Drive V2 upload/download + Settings → Labs |
| 8 | Browser extension (MV3) | `apps/extension/` |
| 10 | Knowledge graph / backlinks ("Related" rail) | `data/selectors.ts` `related()`, detail drawer |
| 11 | Weekly AI digest + review | `modules/digest.ts`, `/digest` |
| 12 | Link-rot monitor + heal | `modules/linkcheck.ts`, detail drawer + Library bulk check |
| 13 | Public shareable pages (packs **and** collections) | `/p/:slug`, `/c/:slug` |
| ★ | Security posture dashboard (skill risk + secret scan + public links + key hygiene → one score) | `packages/shared/security.ts`, `pages/Security.tsx` (`/security`) |
| ★ | Agentic bulk ops (NL command → planned multi-step edit → preview diff → apply) | `packages/shared/bulk.ts`, `modules/bulk.ts`, `routes/bulk.ts`, `pages/Bulk.tsx` (`/bulk`) |
| ★ | On-device AI (browser → local model, zero-cost & private; drives the Playground + Bulk planner) | `packages/shared/localai.ts`, `apps/web/src/lib/localAi.ts`, Settings → On-device AI |
| ★ | Skill registry / marketplace (discover public skills, review scan + trust, install as unreviewed) | `packages/shared/registry.ts`, `modules/registry.ts`, `routes/registry.ts`, `pages/Registry.tsx` (`/registry`) |
| — | Import bookmarks (Chrome/Pocket/Raindrop) | `packages/shared/bookmarks.ts`, Add page importer |
| 9a | Google **multi-account** file federation | already supported (Drive space picker) |

## Feature-flagged

### 7. Encrypted Drive folders (client-side E2EE before upload)
Shipped **behind a flag** so the working Drive path is byte-identical when it's off. Enable it in **Settings → Labs** (persists in `localStorage`), or force it on at build time with `VITE_DRIVE_ENCRYPTION=1`.

- **Crypto core** lives in `@kosh/shared/filecrypt` (unit-tested, WebCrypto only): PBKDF2-SHA-256 (600k) → non-extractable AES-256-GCM, packed into a compact self-describing binary container (`KENC` magic · version · 12-byte IV · ciphertext+tag) so encrypted bytes upload as-is with no base64 inflation.
- **Session key** is derived in `apps/web/src/lib/driveEncryption.ts` and held in memory only — never persisted or sent. Only a random salt + a small verifier ciphertext are stored (neither reveals anything without the passphrase).
- **Mark a folder** "Encrypt uploads" (the header toggle) → an app-private `appProperties.koshEnc="1"` flag on the folder. Uploads into it are sealed before the resumable upload (the prepared ciphertext blob is reused verbatim across pause/resume), renamed `<name>.kenc`, and stamped `{koshEnc, koshEncName}`. An upload into an encrypted folder while locked is blocked (never falls back to plaintext) and prompts to unlock.
- **Download** decrypts client-side and restores the original name; the Quick-Look preview degrades to a "🔒 Encrypted" placeholder (Google only holds ciphertext), and file rows/cards show a lock + the original name.

Live caveat: the upload/download bytes cross straight to Google, so the end-to-end round-trip can only be fully exercised against real Drive (OAuth) — the crypto container itself is covered by `filecrypt.test.ts`, and the flag keeps the default path untouched.

## Deferred — need runtime/infra that can't be validated in this environment

These have concrete plans; they're intentionally **not** shipped as unvalidated code because each depends on a live integration or an architectural change that must be exercised against real infra (Google OAuth, browser store, realtime backend) before it's trustworthy.

### 9b. Other-cloud adapters (Dropbox / OneDrive / S3-R2)
Generalize the existing `DriveNode`/space abstraction behind a provider interface; add one adapter per cloud. Each needs its own registered OAuth app + credentials and per-provider quirks handling. Deferred: requires external OAuth app registration and live testing per provider.

### 14. Team / shared collections (multiplayer)
Roles on collections, presence, and conflict handling. Needs an auth/membership model and a realtime layer (the Drive comments/presence code is a starting point). Deferred: an architectural change best done after the single-player moat, and it needs realtime infra to validate.

### Moonshots
_All shipped._ The **security posture dashboard** (`/security`), **agentic bulk ops** (`/bulk`), **on-device AI** (Settings → On-device AI), and the **skill registry / marketplace** (`/registry`) are all in the Shipped table above.

Note on the skill registry: it's a discovery layer over the existing scan + trust model. Any skill a user marks **public** (the existing share toggle) is listed cross-user; installing one copies the latest version's files into your vault, re-runs the static scan, and lands it `trust: "unreviewed"` — the install is gated behind a review modal that shows the scan findings and the SKILL.md before you confirm (a danger-styled "Install anyway" when the scan flagged something). Re-installs are idempotent (a synthetic `source` marker), and installs bump the source skill's `installCount` for the "most installed" ranking. Cross-user discovery is exercisable in a single deployment; it's keyed by the skill's own id (unguessable) rather than the name-based `publicSlug` to avoid collisions.

Note on on-device AI: the server registry already carries an `ollama` provider for self-hosted API deployments, but a *hosted* API can't reach a user's `localhost` — so on-device runs **browser-direct** to the user's local model (Ollama/LM Studio/llama.cpp over the OpenAI `/v1` API). It's opt-in in Settings, and features that support it (Prompt Playground; the Bulk planner) prefer it when enabled, falling back to the cloud provider. The live localhost round-trip can only be exercised against a real local server; the request/response core is unit-tested (`localai.test.ts`).
