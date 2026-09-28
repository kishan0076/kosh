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
| 8 | Browser extension (MV3) | `apps/extension/` |
| 10 | Knowledge graph / backlinks ("Related" rail) | `data/selectors.ts` `related()`, detail drawer |
| 11 | Weekly AI digest + review | `modules/digest.ts`, `/digest` |
| 12 | Link-rot monitor + heal | `modules/linkcheck.ts`, detail drawer + Library bulk check |
| 13 | Public shareable pages (packs **and** collections) | `/p/:slug`, `/c/:slug` |
| — | Import bookmarks (Chrome/Pocket/Raindrop) | `packages/shared/bookmarks.ts`, Add page importer |
| 9a | Google **multi-account** file federation | already supported (Drive space picker) |

## Deferred — need runtime/infra that can't be validated in this environment

These have concrete plans; they're intentionally **not** shipped as unvalidated code because each depends on a live integration or an architectural change that must be exercised against real infra (Google OAuth, browser store, realtime backend) before it's trustworthy.

### 7. Encrypted Drive folders (client-side E2EE before upload)
The web already has the crypto (`lib` E2EE: PBKDF2 + AES-GCM, used by the Secure Vault). Plan:
1. Mark a Drive folder "encrypted" via an `appProperties` flag (already how tags ride on Drive files).
2. In the Drive V2 upload path, when the target folder is encrypted, run the file bytes through the vault's `encryptFile` (a fresh per-file key wrapped by the vault key) **before** the resumable upload — Google only ever stores ciphertext + a small header.
3. On download/Quick-Look, decrypt client-side; preview/thumbnail/text-search gracefully degrade to a "🔒 encrypted" placeholder for ciphertext.
Why deferred: it rewrites the critical, working resumable upload/download/preview flow, which must be tested against real Google Drive (OAuth) — shipping it blind risks the module that already works.

### 9b. Other-cloud adapters (Dropbox / OneDrive / S3-R2)
Generalize the existing `DriveNode`/space abstraction behind a provider interface; add one adapter per cloud. Each needs its own registered OAuth app + credentials and per-provider quirks handling. Deferred: requires external OAuth app registration and live testing per provider.

### 14. Team / shared collections (multiplayer)
Roles on collections, presence, and conflict handling. Needs an auth/membership model and a realtime layer (the Drive comments/presence code is a starting point). Deferred: an architectural change best done after the single-player moat, and it needs realtime infra to validate.

### Moonshots
- **On-device / local AI** (WebGPU / Ollama): add a "local" provider to the existing multi-provider registry so summaries/tagging/embeddings run at zero marginal cost. Buildable incrementally once an embeddings surface exists.
- **Agentic bulk ops**: a command bar that plans multi-step actions and shows a preview diff before applying — composes cleanly on top of the Automations matcher (#6) and the Ask retriever (#2).
- **Security posture dashboard**: roll up the existing repo secret-scan + skill risk-scan + over-shared-link checks into one score.
- **Skill registry / marketplace**: a discovery layer over the existing scan+trust model.
