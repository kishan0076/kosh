# Kosh — design system

**Direction: "a vault with a light inside."** Calm, spacious, analytics-grade surfaces with the polish of a
modern dashboard, plus one identity move generic dashboards don't have: a **dual-accent** system.

- **Indigo (`--primary`) = interaction.** Every actionable/active/selected state, links, focus rings, primary
  buttons, and the lead chart series.
- **Gold (`--gold`) = treasure/reward,** used sparingly and only for earned moments: the capture "materialize"
  pulse, pinned/favorite, star ratings, and the Curation Health hero.

Discipline that keeps it reading as a real system:

- **Saturated color is for data + status only.** Chrome stays neutral (surface / line / text tokens).
- **One elevation per screen region.** In light, raise with a soft cool shadow on white; in dark, raise with a
  *lighter surface + a hairline rim* (`--edge-highlight`), not a bigger shadow.
- **Decision-first, stats-second.** The home screen is a place to *act* on your vault.
- **Numbers:** hero/KPI figures render proportional; only deltas, tables, tooltips and live counters use
  `tabular-nums` (the `.tabular` utility).

## Tokens

Defined in [`apps/web/src/index.css`](../apps/web/src/index.css) as semantic CSS variables on `:root`
(light, the base) with a `.dark` override, wired to Tailwind utilities through `@theme inline` (so a class
swap re-themes the whole app — plain `@theme` would freeze values at build time).

| Group | Tokens |
|---|---|
| Surfaces | `--bg · --surface · --surface-2 · --surface-3 · --elevated` |
| Lines | `--line · --line-strong` |
| Text | `--text · --muted · --faint` |
| Brand | `--primary · --primary-hover · --primary-foreground · --primary-soft · --primary-ring` |
| Identity | `--gold · --gold-soft` |
| Status | `--ok · --warn · --danger · --info` (each with a `-soft` pair) |
| Chart | `--c1 … --c6` (theme-aware, CVD-checked ordering) |
| Tool | `--tool-claude · --tool-codex · --tool-cursor · --tool-gemini · --tool-generic` |
| Elevation | `--shadow-sm · --shadow · --shadow-lg · --edge-highlight` |
| Radii | `--radius-chip · --radius-control · --radius-card · --radius-panel` |

**Rule:** components consume *semantic role tokens only* (`bg-surface`, `text-foreground`, `border-border`,
`bg-primary`, `text-muted`). Never a raw hex; never `--c*` outside a chart. That is what makes light ⇄ dark a
pure value swap.

## Theming mechanics

- **No flash:** a tiny blocking script in `index.html` stamps `.dark` before first paint from stored pref or OS.
- **Live OS sync:** a `matchMedia('(prefers-color-scheme: dark)')` listener re-applies **only while the
  preference is `system`**, so the OS drives the page live but an explicit choice pins it. See
  [`apps/web/src/lib/theme.ts`](../apps/web/src/lib/theme.ts).
- **Reduced motion:** every animation is gated behind `prefers-reduced-motion`.

## Type

- **Display / headings:** Bricolage Grotesque, `-0.02em`.
- **Body / UI:** Inter (with `cv11`/`ss01`).
- **Mono:** JetBrains Mono (URLs, paths, install commands, code).

## Motion

`--ease-out: cubic-bezier(0.2, 0.8, 0.2, 1)`; hover lift `translateY(-2px)` ~160ms; panels/drawers ~300ms; the
capture materialize is a spring (`stiffness 380–500`, `damping 32–38`) with a one-shot gold pulse. Built with
`motion` (motion/react).

## Charts

All small forms — sparkline, area trend with a snapping crosshair tooltip, mini bars, semicircle gauge, stage
funnel bars, segment bar — are **hand-rolled SVG** drawing against `var(--c*)` / `var(--line)` / `var(--muted)`,
so the theme toggle re-colors them for free with no chart library. See
[`apps/web/src/components/charts.tsx`](../apps/web/src/components/charts.tsx).

## Card system

One `<ItemCard>` renders every kind. A fixed **identity row** (kind icon / GitHub mark + title) plus a variable
**signal row** that swaps by kind:

| Kind | Left edge | Signal row |
|---|---|---|
| repo | GitHub language color | repoKind · ★stars · forks · language · license · "N skills · M copied · K new" |
| package | primary | registry chip + version |
| article / video / other | faint | site name |
| skill | primary tool color | tool badges · trust · lint/scan health · license |
| prompt | muted | variable count · used×; body preview |
| file | faint | extension + size |

Cross-cutting: stage chip, found-via, relative time, hover quick-actions, and an `enriching` shimmer/pulse.
