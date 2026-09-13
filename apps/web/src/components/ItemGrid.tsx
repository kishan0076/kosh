import { AnimatePresence } from "motion/react";
import type { Item } from "@kosh/shared";
import { ItemCard } from "./cards/ItemCard";

/** Responsive card grid used across Library, Collections and Home. */
export function ItemGrid({ items }: { items: Item[] }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      <AnimatePresence mode="popLayout">
        {items.map((item, i) => (
          <ItemCard key={item.id} item={item} index={i} />
        ))}
      </AnimatePresence>
    </div>
  );
}
