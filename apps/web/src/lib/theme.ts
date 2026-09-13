import { useSyncExternalStore } from "react";

export type ThemeChoice = "light" | "dark" | "system";
const KEY = "kosh.theme";
const listeners = new Set<() => void>();

function read(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    /* ignore */
  }
  return "system";
}

function systemPrefersDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function resolvedTheme(choice: ThemeChoice): "light" | "dark" {
  return choice === "system" ? (systemPrefersDark() ? "dark" : "light") : choice;
}

function apply(choice: ThemeChoice) {
  const dark = resolvedTheme(choice) === "dark";
  document.documentElement.classList.toggle("dark", dark);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", dark ? "#0b1120" : "#f5f6f9");
}

export function setTheme(choice: ThemeChoice) {
  try {
    localStorage.setItem(KEY, choice);
  } catch {
    /* ignore */
  }
  apply(choice);
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const onSystem = () => {
    if (read() === "system") apply("system");
    cb();
  };
  mq.addEventListener("change", onSystem);
  return () => {
    listeners.delete(cb);
    mq.removeEventListener("change", onSystem);
  };
}

/** Reactive theme hook. Returns the chosen mode, the resolved mode, and a setter. */
export function useTheme() {
  const choice = useSyncExternalStore(subscribe, read, () => "system" as ThemeChoice);
  return { theme: choice, resolved: resolvedTheme(choice), setTheme };
}

/** Ensure the class matches storage (idempotent; safe to call on mount). */
export function initTheme() {
  apply(read());
}
