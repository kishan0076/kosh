import { useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import type { ScanFinding } from "@kosh/shared";
import { PHONE_QUERY, useMediaQuery } from "@/lib/useMediaQuery";
import { Toggle } from "./ui";

/**
 * Read-only code viewer with line numbers and inline scan-finding markers.
 * Deliberately no execution and no HTML injection — plain text lines only.
 *
 * Lines wrap by default on phones (a sideways drag inside a vertical scroller is miserable on touch)
 * and stay `pre` on wider screens; the "Wrap lines" switch overrides either default.
 */
export function CodeViewer({ code, findings = [], className }: { code: string; findings?: ScanFinding[]; className?: string }) {
  const phone = useMediaQuery(PHONE_QUERY);
  const [wrapPref, setWrapPref] = useState<boolean | null>(null);
  const wrap = wrapPref ?? phone;
  const lines = useMemo(() => code.replace(/\n$/, "").split("\n"), [code]);
  const byLine = useMemo(() => {
    const map = new Map<number, ScanFinding[]>();
    for (const f of findings) {
      const arr = map.get(f.line) ?? [];
      arr.push(f);
      map.set(f.line, arr);
    }
    return map;
  }, [findings]);

  return (
    <div className={cn("overflow-hidden rounded-[var(--radius-control)] border border-border bg-surface-2", className)}>
      <div className="flex items-center justify-end gap-2 border-b border-border px-3 py-1.5">
        <span className="text-[11px] text-muted">Wrap lines</span>
        <Toggle checked={wrap} onChange={setWrapPref} label="Wrap lines" className="scale-90" />
      </div>
      <div className="overflow-x-auto [-webkit-overflow-scrolling:touch] [scrollbar-width:thin]">
        <table className="w-full border-collapse font-mono text-[12.5px] leading-[1.7]">
          <tbody>
            {lines.map((line, i) => {
              const n = i + 1;
              const hits = byLine.get(n);
              return (
                <tr key={n} className={cn("group", hits && "bg-danger-soft/60")}>
                  <td className="w-10 select-none border-r border-border px-2 text-right align-top text-faint">{n}</td>
                  <td className={cn("px-3 align-top text-foreground", wrap ? "whitespace-pre-wrap [overflow-wrap:anywhere]" : "whitespace-pre")}>
                    {line || " "}
                    {hits && (
                      // Wrapped mode parks the pill on its own line under the code so it never widens the row.
                      <span
                        className={cn(
                          "items-center gap-1 rounded-full bg-danger-soft px-2 py-0.5 text-[11px] font-medium leading-tight text-danger",
                          wrap ? "mt-1 flex w-fit" : "ml-3 inline-flex align-middle",
                        )}
                      >
                        ⚠ {hits.map((h) => h.text).join(", ")}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
