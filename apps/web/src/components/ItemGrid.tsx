import { useEffect, useRef, useState } from "react";
import { AnimatePresence } from "motion/react";
import type { Item } from "@kosh/shared";
import { PHONE_QUERY, useMediaQuery } from "@/lib/useMediaQuery";
import { Button } from "./ui";
import { ItemCard } from "./cards/ItemCard";

/** Responsive card grid used across Library, Collections and Home. Mounts a page at a time (12 cards on
 *  phones, 24 on wider screens — a page of 24 costs a 150–200ms long task on a mid-range phone) and
 *  grows as the tail scrolls near — a vault of a few hundred links never renders all at once — with the
 *  "Show more" button as the no-IntersectionObserver fallback. Remount (key) to reset the paging. */
export function ItemGrid({ items }: { items: Item[] }) {
  const phone = useMediaQuery(PHONE_QUERY);
  const PAGE = phone ? 12 : 24;
  const [shown, setShown] = useState(PAGE);
  const tail = useRef<HTMLDivElement>(null);
  const more = items.length > shown;

  useEffect(() => {
    const el = tail.current;
    if (!el || !more || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setShown((n) => n + PAGE);
      },
      { rootMargin: "400px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [more, shown, PAGE]);

  return (
    <div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <AnimatePresence mode="popLayout">
          {items.slice(0, shown).map((item, i) => (
            <ItemCard key={item.id} item={item} index={i} />
          ))}
        </AnimatePresence>
      </div>
      {more && (
        <div ref={tail} className="flex justify-center pt-6">
          <Button variant="outline" onClick={() => setShown((n) => n + PAGE)}>
            Show more ({items.length - shown})
          </Button>
        </div>
      )}
    </div>
  );
}
