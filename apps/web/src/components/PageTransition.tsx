import { useLocation, useOutlet } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/cn";
import { pageVariants } from "@/lib/motion";

/**
 * Route-level fade + rise around the shell's routed content. The key is the first two path segments, so
 * query changes don't re-mount the page — only real page swaps animate. Drive V2 AND GitHub are each a
 * single self-routing wildcard module (`/drive-v2/*`, `/github/*`) that owns its own sub-page switching,
 * so each shares ONE key across its sub-routes — otherwise navigating within the module would unmount and
 * remount the whole thing (resetting its state, effects and fetches). Transform + opacity only, no
 * `layout`; under reduced motion the global MotionConfig degrades it to a plain opacity fade.
 *
 * We snapshot the routed element with `useOutlet()` and render that captured element (NOT a live
 * `<Outlet/>`): during an exit fade AnimatePresence keeps the previous wrapper mounted, and a live
 * `<Outlet/>` would re-resolve from router context and show the NEW page inside the OLD, fading wrapper
 * (a double-render flash). The snapshot keeps the outgoing page on screen until its exit completes.
 */
export function PageTransition({ className }: { className?: string }) {
  const { pathname } = useLocation();
  const outlet = useOutlet();
  const key = pathname.startsWith("/drive-v2")
    ? "/drive-v2"
    : pathname.startsWith("/github")
      ? "/github"
      : pathname.split("/").slice(0, 3).join("/");
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div key={key} variants={pageVariants} initial="hidden" animate="show" exit="exit" className={cn("min-h-full", className)}>
        {outlet}
      </motion.div>
    </AnimatePresence>
  );
}
