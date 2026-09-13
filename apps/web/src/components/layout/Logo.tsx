import { cn } from "@/lib/cn";

export function LogoMark({ size = 30, className }: { size?: number; className?: string }) {
  return (
    <span
      className={cn("grid shrink-0 place-items-center rounded-[10px] bg-primary text-primary-foreground", className)}
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 32 32" width={size * 0.66} height={size * 0.66} fill="none" aria-hidden>
        <path d="M11 7v18M11 16l9-9M11 16l9 9" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

export function Logo({ collapsed }: { collapsed?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <LogoMark />
      {!collapsed && (
        <div className="leading-none">
          <div className="font-display text-[17px] font-bold tracking-tight">Kosh</div>
          <div className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-faint">Treasury</div>
        </div>
      )}
    </div>
  );
}
