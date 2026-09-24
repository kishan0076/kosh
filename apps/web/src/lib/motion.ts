import type { CSSProperties } from "react";
import { useReducedMotion, type Transition, type Variants } from "motion/react";

/**
 * Shared motion tokens for the app. Durations/easings mirror the CSS custom properties in index.css
 * so CSS-only animations and framer (`motion`) animations stay visually consistent.
 *
 * All motion is gated by `<MotionConfig reducedMotion="user">` (main.tsx): when the OS/browser asks to
 * reduce motion, `motion.*` components animate opacity only and skip transforms — so these variants are
 * safe to use everywhere without per-call checks. Prefer opacity + small transforms; keep it subtle.
 */

export const DUR = { fast: 0.12, base: 0.2, slow: 0.32 } as const;

type Bezier = [number, number, number, number];
// cubic-bezier control points (Material-3-ish standard / emphasized / exit).
export const EASE: Record<"standard" | "emphasized" | "exit", Bezier> = {
  standard: [0.2, 0, 0, 1],
  emphasized: [0.05, 0.7, 0.1, 1],
  exit: [0.3, 0, 1, 1],
};

export const SPRING: Record<"soft" | "snappy", Transition> = {
  soft: { type: "spring", stiffness: 380, damping: 32, mass: 0.8 },
  snappy: { type: "spring", stiffness: 520, damping: 30 },
};

export const fade: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: DUR.base, ease: EASE.standard } },
  exit: { opacity: 0, transition: { duration: DUR.fast, ease: EASE.exit } },
};

export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.97 },
  show: { opacity: 1, scale: 1, transition: SPRING.soft },
  exit: { opacity: 0, scale: 0.98, transition: { duration: DUR.fast, ease: EASE.exit } },
};

export const slideUp: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: DUR.base, ease: EASE.standard } },
  exit: { opacity: 0, y: 6, transition: { duration: DUR.fast, ease: EASE.exit } },
};

/** Route-level page swap (see components/PageTransition.tsx): a 4px rise in, a 2px drop out. Transform +
 *  opacity only, so the whole page moves as one composited layer; MotionConfig drops the `y` under
 *  reduced motion and leaves the opacity fade. */
export const pageVariants: Variants = {
  hidden: { opacity: 0, y: 4 },
  show: { opacity: 1, y: 0, transition: { duration: DUR.base, ease: EASE.standard } },
  exit: { opacity: 0, y: -2, transition: { duration: DUR.fast, ease: EASE.exit } },
};

/** Parent that staggers its direct children (each should use `slideUp`/`staggerChild`). */
export const staggerParent: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.035, delayChildren: 0.02 } },
};
export const staggerChild: Variants = slideUp;

/** True when the user prefers reduced motion — for the rare case a component must branch itself. */
export function useReduced(): boolean {
  return useReducedMotion() ?? false;
}

/* ── List reveal (CSS-only) ─────────────────────────────────────
   Stagger the first REVEAL_CAP rows of a freshly keyed collection with the `.reveal-in` keyframe
   (index.css) — no framer wrapper, no `layout`, so it's safe on long/virtualized lists. Key the list
   container by its filter/sort so re-filtering re-reveals; never re-trigger on data patches. */
export const REVEAL_CAP = 12;
export function revealClass(i: number): string {
  return i < REVEAL_CAP ? "reveal-in" : "";
}
export function revealStyle(i: number): CSSProperties | undefined {
  return i < REVEAL_CAP ? { animationDelay: `${i * 30}ms` } : undefined;
}
