import { useSyncExternalStore } from "react";

/**
 * Subscribe to a CSS media query, e.g. `useMediaQuery("(max-width: 639px)")`. Backed by
 * useSyncExternalStore so it's tear-free and SSR-safe (false when `window` is missing), and it
 * re-renders on change (rotation, window resize, OS setting flips).
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window === "undefined") return () => {};
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    () => (typeof window === "undefined" ? false : window.matchMedia(query).matches),
    () => false,
  );
}

/** Phone-width breakpoint — mirrors Tailwind's `sm:` (640px) so JS and CSS agree on "phone". */
export const PHONE_QUERY = "(max-width: 639px)";
