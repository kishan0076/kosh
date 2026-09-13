import { useId, useState } from "react";
import { cn } from "@/lib/cn";
import { useMeasure } from "@/lib/useMeasure";

/* Smooth an array of [x,y] into a bezier path (Catmull-Rom → cubic). */
function smoothPath(points: [number, number][]): string {
  if (points.length < 2) return points.length ? `M ${points[0]![0]} ${points[0]![1]}` : "";
  const d = [`M ${points[0]![0]} ${points[0]![1]}`];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i === 0 ? 0 : i - 1]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = points[i + 2 < points.length ? i + 2 : i + 1]!;
    const cp1x = p1[0] + (p2[0] - p0[0]) / 6;
    const cp1y = p1[1] + (p2[1] - p0[1]) / 6;
    const cp2x = p2[0] - (p3[0] - p1[0]) / 6;
    const cp2y = p2[1] - (p3[1] - p1[1]) / 6;
    d.push(`C ${cp1x} ${cp1y} ${cp2x} ${cp2y} ${p2[0]} ${p2[1]}`);
  }
  return d.join(" ");
}

/* ── Area trend chart with hover tooltip ────────────────────── */
export function AreaTrend({
  data,
  height = 180,
  color = "var(--primary)",
  formatValue = (v: number) => String(v),
}: {
  data: { label: string; value: number; date?: string }[];
  height?: number;
  color?: string;
  formatValue?: (v: number) => string;
}) {
  const [ref, width] = useMeasure<HTMLDivElement>();
  const gid = useId().replace(/:/g, "");
  const [hover, setHover] = useState<number | null>(null);

  const padX = 8;
  const padTop = 14;
  const padBottom = 22;
  const w = Math.max(width, 40);
  const h = height;
  const max = Math.max(1, ...data.map((d) => d.value));
  const innerW = w - padX * 2;
  const innerH = h - padTop - padBottom;

  const pts: [number, number][] = data.map((d, i) => {
    const x = data.length <= 1 ? padX + innerW / 2 : padX + (i / (data.length - 1)) * innerW;
    const y = padTop + innerH - (d.value / max) * innerH;
    return [x, y];
  });

  const line = smoothPath(pts);
  const area = pts.length ? `${line} L ${pts.at(-1)![0]} ${padTop + innerH} L ${pts[0]![0]} ${padTop + innerH} Z` : "";

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    let nearest = 0;
    let best = Infinity;
    pts.forEach((p, i) => {
      const dist = Math.abs(p[0] - x);
      if (dist < best) {
        best = dist;
        nearest = i;
      }
    });
    setHover(nearest);
  };

  const hp = hover != null ? pts[hover] : null;
  const hd = hover != null ? data[hover] : null;

  return (
    <div ref={ref} className="relative w-full" style={{ height }}>
      {width > 0 && (
        <svg width={w} height={h} onMouseMove={onMove} onMouseLeave={() => setHover(null)} className="overflow-visible">
          <defs>
            <linearGradient id={`area-${gid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.28" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          {/* baseline */}
          <line x1={padX} y1={padTop + innerH} x2={w - padX} y2={padTop + innerH} stroke="var(--line)" strokeWidth="1" />
          <path d={area} fill={`url(#area-${gid})`} />
          <path d={line} fill="none" stroke={color} strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" />
          {/* end dot */}
          {pts.length > 0 && <circle cx={pts.at(-1)![0]} cy={pts.at(-1)![1]} r="3.5" fill={color} />}
          {/* hover */}
          {hp && hd && (
            <g>
              <line x1={hp[0]} y1={padTop - 6} x2={hp[0]} y2={padTop + innerH} stroke="var(--border-strong)" strokeWidth="1" strokeDasharray="3 3" />
              <circle cx={hp[0]} cy={hp[1]} r="4.5" fill="var(--surface)" stroke={color} strokeWidth="2.5" />
            </g>
          )}
          {/* sparse x labels */}
          {data.map((d, i) => {
            const every = Math.ceil(data.length / 6);
            if (i % every !== 0 && i !== data.length - 1) return null;
            return (
              <text key={i} x={pts[i]![0]} y={h - 6} textAnchor="middle" className="fill-faint" style={{ fontSize: 10 }}>
                {d.label}
              </text>
            );
          })}
        </svg>
      )}
      {hp && hd && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 rounded-lg border border-border bg-elevated px-2.5 py-1.5 text-center shadow-[var(--shadow-pop)]"
          style={{ left: Math.min(Math.max(hp[0], 44), w - 44), top: Math.max(hp[1] - 52, 0) }}
        >
          <div className="text-[11px] text-muted">{hd.label}</div>
          <div className="font-display text-sm font-semibold tabular">{formatValue(hd.value)}</div>
        </div>
      )}
    </div>
  );
}

/* ── Sparkline ──────────────────────────────────────────────── */
export function Sparkline({ data, color = "var(--primary)", width = 96, height = 30 }: { data: number[]; color?: string; width?: number; height?: number }) {
  const gid = useId().replace(/:/g, "");
  const max = Math.max(1, ...data);
  const pts: [number, number][] = data.map((v, i) => [
    data.length <= 1 ? width / 2 : (i / (data.length - 1)) * width,
    height - 3 - (v / max) * (height - 6),
  ]);
  const line = smoothPath(pts);
  const area = pts.length ? `${line} L ${width} ${height} L 0 ${height} Z` : "";
  return (
    <svg width={width} height={height} className="overflow-visible">
      <defs>
        <linearGradient id={`spark-${gid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#spark-${gid})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ── Mini bar chart (weekday activity) ──────────────────────── */
export function MiniBars({ data, height = 150 }: { data: { label: string; value: number }[]; height?: number }) {
  const [ref, width] = useMeasure<HTMLDivElement>();
  const max = Math.max(1, ...data.map((d) => d.value));
  const peak = data.reduce((m, d, i) => (d.value > data[m]!.value ? i : m), 0);
  const gap = 10;
  const w = Math.max(width, 40);
  const barW = (w - gap * (data.length - 1)) / data.length;
  const chartH = height - 22;

  return (
    <div ref={ref} className="w-full" style={{ height }}>
      {width > 0 && (
        <svg width={w} height={height}>
          {data.map((d, i) => {
            const bh = Math.max(4, (d.value / max) * (chartH - 8));
            const x = i * (barW + gap);
            const isPeak = i === peak && d.value > 0;
            return (
              <g key={i}>
                <rect x={x} y={chartH - bh} width={barW} height={bh} rx="6" fill={isPeak ? "var(--primary)" : "var(--surface-3)"} />
                {isPeak && (
                  <text x={x + barW / 2} y={chartH - bh - 6} textAnchor="middle" className="fill-primary" style={{ fontSize: 11, fontWeight: 600 }}>
                    {d.value}
                  </text>
                )}
                <text x={x + barW / 2} y={height - 5} textAnchor="middle" className={cn(isPeak ? "fill-foreground" : "fill-faint")} style={{ fontSize: 11, fontWeight: isPeak ? 600 : 400 }}>
                  {d.label}
                </text>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}

/* ── Semicircle gauge ───────────────────────────────────────── */
export function Gauge({ value, size = 168, label, sublabel, color = "var(--ok)" }: { value: number; size?: number; label?: string; sublabel?: string; color?: string }) {
  const stroke = 12;
  const r = (size - stroke) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circ = Math.PI * r; // half circle
  const pct = Math.min(100, Math.max(0, value));
  const dash = (pct / 100) * circ;

  return (
    <div className="flex flex-col items-center" style={{ width: size }}>
      <svg width={size} height={size / 2 + 14} viewBox={`0 0 ${size} ${size / 2 + 14}`}>
        <path d={`M ${stroke / 2} ${cy} A ${r} ${r} 0 0 1 ${size - stroke / 2} ${cy}`} fill="none" stroke="var(--surface-3)" strokeWidth={stroke} strokeLinecap="round" />
        <path
          d={`M ${stroke / 2} ${cy} A ${r} ${r} 0 0 1 ${size - stroke / 2} ${cy}`}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circ}`}
          style={{ transition: "stroke-dasharray 0.7s cubic-bezier(0.2,0.8,0.2,1)" }}
        />
        <text x={cx} y={cy - 6} textAnchor="middle" className="fill-foreground font-display" style={{ fontSize: 30, fontWeight: 700 }}>
          {label ?? `${pct}%`}
        </text>
      </svg>
      {sublabel && <div className="-mt-1 text-center text-xs text-muted">{sublabel}</div>}
    </div>
  );
}

/* ── Stacked segment bar (customers-style) ──────────────────── */
export function SegmentBar({ segments }: { segments: { label: string; value: number; color: string }[] }) {
  const total = Math.max(1, segments.reduce((a, s) => a + s.value, 0));
  return (
    <div className="space-y-3">
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-surface-3">
        {segments.map((s, i) => (
          <div key={i} style={{ width: `${(s.value / total) * 100}%`, backgroundColor: s.color }} className="h-full first:rounded-l-full last:rounded-r-full" />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-3">
        {segments.map((s, i) => (
          <div key={i} className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
              <span className="truncate text-xs text-muted">{s.label}</span>
            </div>
            <div className="mt-0.5 font-display text-lg font-semibold tabular">{s.value.toLocaleString()}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
