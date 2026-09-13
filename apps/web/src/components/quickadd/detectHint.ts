import { parseCapture, type Capture } from "@/lib/capture";

export type Hint = { kind: Capture["kind"]; label: string };

const LABELS: Record<Capture["kind"], string> = {
  empty: "Save",
  search: "Save",
  command: "Run",
  link: "Save link",
  repo: "Add repo",
};

/** Lightweight intent hint for the Quick-Add bar (drives the button label). */
export function detectHint(raw: string): Hint {
  const kind = parseCapture(raw).kind;
  return { kind, label: LABELS[kind] };
}
