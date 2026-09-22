import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";
import { DUR, EASE, fade, slideUp, staggerChild, staggerParent } from "@/lib/motion";

/**
 * Small, reusable motion primitives built on `motion` (framer). Every one honors reduced-motion via the
 * global `<MotionConfig reducedMotion="user">`. Never wrap a virtualized (@tanstack/react-virtual) row
 * in these with `layout`/AnimatePresence — animate the collection's skeleton→content boundary instead.
 */

/** Fade + rise a block in on mount. */
export function Reveal({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div variants={slideUp} initial="hidden" animate="show" className={className}>
      {children}
    </motion.div>
  );
}

/** Stagger a list of `<StaggerItem>` children in. Use for short lists (nav, panels) — not virtual rows. */
export function Stagger({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div variants={staggerParent} initial="hidden" animate="show" className={className}>
      {children}
    </motion.div>
  );
}
export function StaggerItem({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div variants={staggerChild} className={className}>
      {children}
    </motion.div>
  );
}

/** Height + fade collapse for expandable sections (accordions, inline detail). */
export function Collapse({ open, children, className }: { open: boolean; children: ReactNode; className?: string }) {
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: DUR.base, ease: EASE.standard }}
          style={{ overflow: "hidden" }}
          className={className}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Crossfade the content whenever `k` changes (e.g. swapping the active view/tab). */
export function FadeSwap({ k, children, className }: { k: string; children: ReactNode; className?: string }) {
  return (
    <AnimatePresence mode="wait">
      <motion.div key={k} variants={fade} initial="hidden" animate="show" exit="exit" className={className}>
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

/** A drawer/panel that slides in from a side. `side` defaults to right. */
export function SlidePanel({ open, side = "right", children, className }: { open: boolean; side?: "right" | "left"; children: ReactNode; className?: string }) {
  const off = side === "right" ? "100%" : "-100%";
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ x: off, opacity: 0.6 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: off, opacity: 0.6 }}
          transition={{ duration: DUR.slow, ease: EASE.emphasized }}
          className={className}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
