import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme, type ThemeChoice } from "@/lib/theme";
import { cn } from "@/lib/cn";
import { Tooltip } from "./overlays";

const OPTIONS: { value: ThemeChoice; icon: typeof Sun; label: string }[] = [
  { value: "light", icon: Sun, label: "Light" },
  { value: "dark", icon: Moon, label: "Dark" },
  { value: "system", icon: Monitor, label: "System" },
];

/** Segmented light / dark / system toggle. */
export function ThemeToggle({ compact }: { compact?: boolean }) {
  const { theme, setTheme } = useTheme();

  if (compact) {
    // single-button cycle for tight spaces
    const next: Record<ThemeChoice, ThemeChoice> = { light: "dark", dark: "system", system: "light" };
    const current = OPTIONS.find((o) => o.value === theme)!;
    const Icon = current.icon;
    return (
      // `side="bottom"`: the topbar sits under the notch, a tip above it would be clipped. The label
      // carries the current mode too, so the state is exposed without the (hover-only) tooltip.
      <Tooltip label={`Theme: ${current.label}`} side="bottom">
        <button
          onClick={() => setTheme(next[theme])}
          className="grid h-9 w-9 place-items-center rounded-[var(--radius-control)] border border-border text-muted transition-colors hover:bg-surface-2 hover:text-foreground pressable [@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:w-10"
          aria-label={`Toggle theme (${current.label})`}
        >
          <Icon size={17} />
        </button>
      </Tooltip>
    );
  }

  return (
    <div className="inline-flex items-center gap-0.5 rounded-[var(--radius-control)] border border-border bg-surface p-0.5">
      {OPTIONS.map((o) => {
        const Icon = o.icon;
        const active = theme === o.value;
        return (
          <button
            key={o.value}
            onClick={() => setTheme(o.value)}
            className={cn(
              "grid h-7 w-8 place-items-center rounded-md transition-colors [@media(pointer:coarse)]:h-9 [@media(pointer:coarse)]:w-10",
              active ? "bg-primary-soft text-primary" : "text-faint hover:text-foreground",
            )}
            aria-label={o.label}
            aria-pressed={active}
          >
            <Icon size={15} />
          </button>
        );
      })}
    </div>
  );
}
