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
- **On-device / local AI** (WebGPU / Ollama): add a "local" provider to the existing multi-provider registry so summaries/tagging/embeddings run at zero marginal cost. Buildable incrementally once an embeddings surface exists.
- **Agentic bulk ops**: a command bar that plans multi-step actions and shows a preview diff before applying — composes cleanly on top of the Automations matcher (#6) and the Ask retriever (#2).
- **Skill registry / marketplace**: a discovery layer over the existing scan+trust model.

(Shipped from this list: the **security posture dashboard** — see the Shipped table above / `/security`.)
