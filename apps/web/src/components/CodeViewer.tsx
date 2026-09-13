import { useMemo } from "react";
import { cn } from "@/lib/cn";
import type { ScanFinding } from "@kosh/shared";

/**
 * Read-only code viewer with line numbers and inline scan-finding markers.
 * Deliberately no execution and no HTML injection — plain text lines only.
 */
export function CodeViewer({ code, findings = [], className }: { code: string; findings?: ScanFinding[]; className?: string }) {
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
    <div className={cn("overflow-x-auto rounded-[var(--radius-control)] border border-border bg-surface-2", className)}>
      <table className="w-full border-collapse font-mono text-[12.5px] leading-[1.7]">
        <tbody>
          {lines.map((line, i) => {
            const n = i + 1;
            const hits = byLine.get(n);
            return (
              <tr key={n} className={cn("group", hits && "bg-danger-soft/60")}>
                <td className="w-10 select-none border-r border-border px-2 text-right align-top text-faint">{n}</td>
                <td className="whitespace-pre px-3 align-top text-foreground">
                  {line || " "}
                  {hits && (
                    <span className="ml-3 inline-flex items-center gap-1 rounded-full bg-danger-soft px-2 py-0.5 align-middle text-[10px] font-medium text-danger">
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
  );
}
