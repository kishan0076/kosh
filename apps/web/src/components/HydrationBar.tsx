import { AnimatePresence, motion } from "motion/react";
import { DUR, EASE } from "@/lib/motion";

/**
 * A 2px indeterminate progress bar pinned under the notch (`--safe-top`) while the vault hydrates or
 * a Retry is in flight. The 40%-wide sweep is a transform-only keyframe (`.progress-indeterminate`,
 * index.css) that stays inside the track and becomes a static 40% bar under reduced motion — progress indication must survive that setting.
 * The label lives in a visually-hidden live region so screen readers hear it too.
 */
export function HydrationBar({ active, label = "Loading your vault…" }: { active: boolean; label?: string }) {
  return (
    <AnimatePresence>
      {active && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: DUR.fast, ease: EASE.exit } }}
          transition={{ duration: DUR.base, ease: EASE.standard }}
          className="pointer-events-none fixed inset-x-0 z-[80] h-0.5 overflow-hidden bg-primary/15"
          style={{ top: "var(--safe-top)" }}
          role="progressbar"
          aria-label={label}
        >
          <div className="progress-indeterminate h-full w-2/5 bg-primary" />
          <span className="sr-only" role="status" aria-live="polite">
            {label}
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
