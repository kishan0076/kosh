# CLAUDE.md — conventions for coding agents

Kosh is an npm workspaces + Turborepo monorepo. Read this before making changes.

## Layout

- `apps/web` — Vite + React 19 + TypeScript + Tailwind v4. The runnable app.
- `packages/shared` (`@kosh/shared`) — pure, dependency-free, unit-tested domain logic
  (types, URL normalize/classify, skill lint, security scan, formatters). No React, no Node APIs.
- `infra/` — docker-compose + env template for the future backend.
- `docs/` — the build plan (`kosh-build-plan-v3.md`) and the design system (`DESIGN.md`).

## Golden rules

- **Validate with shared logic.** Domain rules (URL handling, skill lint, security scan) live in
  `@kosh/shared` and are covered by tests — reuse them; add tests when you change them (`npm test`).
- **Never render unsanitized markdown.** Use the `<Markdown>` component (`react-markdown` + `rehype-sanitize`).
  No `dangerouslySetInnerHTML` anywhere.
- **The link/skill is saved first.** Enrichment must never block a save; model it as a follow-up patch.
- **Nothing from a stranger's repo is trusted.** Copied skills default to `trust: "unreviewed"`; a risky scan
  keeps them unreviewed and gates install behind a confirm that shows the findings.
- **Semantic tokens only** in the UI (`bg-surface`, `text-foreground`, `border-border`, `bg-primary`,
  `text-muted`, …). Never raw hex; never `--c*` outside charts. This keeps light/dark a pure value swap.
- **Respect `prefers-reduced-motion`** on every animation.

## Style

- TypeScript strict; `noUnusedLocals`/`noUnusedParameters` are on. Prefix intentionally-unused params with `_`.
- Path alias `@/*` → `apps/web/src/*`; import shared code from `@kosh/shared`.
- Prefer small, composable components. UI primitives live in `components/ui.tsx`, overlays in
  `components/overlays.tsx`, shared display bits in `components/common.tsx`.
- State: `useData` (persisted vault store) and `useUi` (ephemeral panel/palette/toasts). Derived data lives in
  `data/selectors.ts` as pure functions.

## Checks before you commit

```bash
npm run typecheck   # tsc across the workspace
npm test            # vitest for @kosh/shared
npm run build       # turbo build (includes the web production build)
```

## When wiring the real backend

Keep the client's typed contracts (`@kosh/shared` types + the `useData` action surface) stable and swap the
`data/store.ts` implementation for API calls. Every server-side fetch of a user-supplied URL must go through
`safeFetch` (SSRF guard) as described in the build plan (§5.3); files never pass through the API on the web
upload path (presigned R2).
