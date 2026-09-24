import type { ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/cn";
import { pageVariants } from "@/lib/motion";

/**
 * Route-level fade + rise around the shell's `<Outlet/>`. The key is the first three path segments
 * (`/github/:owner/:repo`), so tab sub-routes and query changes do NOT re-mount the page — only real
 * page swaps animate. Drive V2 is one shell with its own view switching (`/drive-v2/:view`), so the
 * whole module shares a single key. Transform + opacity only, no `layout`; under reduced motion the
 * global MotionConfig degrades it to a plain opacity fade.
 */
export function PageTransition({ children, className }: { children: ReactNode; className?: string }) {
  const { pathname } = useLocation();
  const key = pathname.startsWith("/drive-v2") ? "/drive-v2" : pathname.split("/").slice(0, 3).join("/");
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div key={key} variants={pageVariants} initial="hidden" animate="show" exit="exit" className={cn("min-h-full", className)}>
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
