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
