import type { ReactNode } from "react";
import { create } from "zustand";
import { uid } from "@/lib/ids";

export interface Toast {
  id: string;
  message: string;
  description?: string;
  tone?: "default" | "ok" | "warn" | "danger";
  action?: { label: string; onClick: () => void };
  duration?: number;
}

export type PanelTarget = { kind: "item"; id: string } | null;

export interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "primary";
  /** When present the dialog shows a text field and passes its value to onConfirm. */
  input?: { label?: string; placeholder?: string; defaultValue?: string };
  onConfirm: (value: string) => void;
}

interface UiState {
  panel: PanelTarget;
  openItem: (id: string) => void;
  closePanel: () => void;

  paletteOpen: boolean;
  /** Text the palette opens pre-filled with (the Quick-Add bar hands free text / commands over). */
  paletteQuery: string;
  setPalette: (open: boolean, query?: string) => void;

  helpOpen: boolean;
  setHelp: (open: boolean) => void;

  verdictItemId: string | null;
  openVerdict: (id: string) => void;
  closeVerdict: () => void;

  confirm: ConfirmOptions | null;
  openConfirm: (opts: ConfirmOptions) => void;
  closeConfirm: () => void;

  trayOpen: boolean;
  setTray: (open: boolean) => void;

  toasts: Toast[];
  toast: (t: Omit<Toast, "id">) => string;
  dismissToast: (id: string) => void;
}

export const useUi = create<UiState>((set, get) => ({
  panel: null,
  openItem: (id) => set({ panel: { kind: "item", id } }),
  closePanel: () => set({ panel: null }),

  paletteOpen: false,
  paletteQuery: "",
  setPalette: (paletteOpen, query = "") => set({ paletteOpen, paletteQuery: query }),

  helpOpen: false,
  setHelp: (helpOpen) => set({ helpOpen }),

  verdictItemId: null,
  openVerdict: (id) => set({ verdictItemId: id }),
  closeVerdict: () => set({ verdictItemId: null }),

  confirm: null,
  openConfirm: (confirm) => set({ confirm }),
  closeConfirm: () => set({ confirm: null }),

  trayOpen: false,
  setTray: (trayOpen) => set({ trayOpen }),

  toasts: [],
  toast: (t) => {
    const id = uid("toast");
    const toast: Toast = { id, duration: 4200, ...t };
    // Cap the stack at three — a burst of failures otherwise covers half a phone screen.
    set((s) => ({ toasts: [...s.toasts, toast].slice(-3) }));
    if (toast.duration) {
      window.setTimeout(() => get().dismissToast(id), toast.duration);
    }
    return id;
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
