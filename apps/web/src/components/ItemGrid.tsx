import { useEffect, useRef, useState } from "react";
import { AnimatePresence } from "motion/react";
import type { Item } from "@kosh/shared";
import { Button } from "./ui";
import { ItemCard } from "./cards/ItemCard";

const PAGE = 24;

/** Responsive card grid used across Library, Collections and Home. Mounts a page (24 cards) at a time
 *  and grows as the tail scrolls near — a vault of a few hundred links never renders all at once — with
 *  the "Show more" button as the no-IntersectionObserver fallback. Remount (key) to reset the paging. */
export function ItemGrid({ items }: { items: Item[] }) {
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
  }, [more, shown]);

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
