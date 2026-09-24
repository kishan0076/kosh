import type { ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/cn";
import { pageVariants } from "@/lib/motion";

/**
 * Route-level fade + rise around the shell's `<Outlet/>`. The key is the first three path segments
 * (`/github/:owner/:repo`, `/drive-v2/:view`), so tab/view sub-routes and query changes do NOT
 * re-mount the page — only real page swaps animate. Transform + opacity only, no `layout`; under
 * reduced motion the global MotionConfig degrades it to a plain opacity fade.
 */
export function PageTransition({ children, className }: { children: ReactNode; className?: string }) {
  const { pathname } = useLocation();
  const key = pathname.split("/").slice(0, 3).join("/");
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div key={key} variants={pageVariants} initial="hidden" animate="show" exit="exit" className={cn("min-h-full", className)}>
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
