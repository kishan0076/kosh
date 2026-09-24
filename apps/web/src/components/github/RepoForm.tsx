import { useState, type ReactNode } from "react";
import { AlertTriangle, Check, Globe, Lock, X } from "lucide-react";
import { isValidRepoName, sanitizeTopic } from "@kosh/shared";
import { cn } from "@/lib/cn";
import { Spinner } from "@/components/ui";

/**
 * Shared GitHub form primitives used by the New Repository, Folder Upload and Settings pages so the
 * name field, visibility picker and secret-findings gate stay identical everywhere (previously these
 * were hand-rolled in four separate modals). All render on semantic tokens.
 */

/* ── Repository name field (with owner prefix + availability state) ── */

export type NameStatus = "idle" | "checking" | "available" | "taken";

export function RepoNameField({
  value,
  onChange,
  ownerPrefix,
  status = "idle",
  autoFocus,
  disabled,
  id = "repo-name",
  label = "Repository name",
  onEnter,
}: {
  value: string;
  onChange: (v: string) => void;
  ownerPrefix?: string;
  status?: NameStatus;
  autoFocus?: boolean;
  disabled?: boolean;
  id?: string;
  label?: string;
  onEnter?: () => void;
}) {
  const trimmed = value.trim();
  const invalid = !!trimmed && !isValidRepoName(trimmed);
  const bad = invalid || status === "taken";
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[12px] font-medium text-muted">{label}</label>
      <div
        className={cn(
          "flex items-center overflow-hidden rounded-[var(--radius-control)] border bg-surface focus-within:ring-focus",
          bad ? "border-danger focus-within:border-danger" : "border-border focus-within:border-primary",
        )}
      >
        {/* a long org login must not size the field: cap the prefix and let the input take the rest */}
        {ownerPrefix && <span className="max-w-[45%] shrink-0 truncate border-r border-border bg-surface-2 px-2.5 py-2 font-mono text-[12px] text-faint">{ownerPrefix}/</span>}
        <input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") onEnter?.(); }}
          placeholder="my-project"
          autoFocus={autoFocus}
          disabled={disabled}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          className="h-9 w-full min-w-0 flex-1 bg-transparent px-3 font-mono text-base outline-none placeholder:text-faint disabled:opacity-60 sm:text-[14px]"
        />
        <span className="grid w-8 shrink-0 place-items-center">
          {status === "checking" ? <Spinner size={15} className="text-muted" /> : status === "available" && !invalid ? <Check size={15} className="text-ok" /> : null}
        </span>
      </div>
      {invalid ? (
        <p className="mt-1 text-[12.5px] text-danger">Only letters, numbers, '.', '_' and '-' are allowed.</p>
      ) : status === "taken" ? (
        <p className="mt-1 text-[12.5px] text-danger">That name already exists on this account.</p>
      ) : status === "available" ? (
        <p className="mt-1 text-[12.5px] text-ok">Name is available.</p>
      ) : null}
    </div>
  );
}

/* ── Visibility picker (private / public) ── */

export function VisibilityPicker({
  isPrivate,
  onChange,
  disabled,
  variant = "cards",
}: {
  isPrivate: boolean;
  onChange: (isPrivate: boolean) => void;
  disabled?: boolean;
  variant?: "cards" | "compact";
}) {
  if (variant === "compact") {
    return (
      <div className="grid grid-cols-2 gap-2">
        <VisButton icon={Lock} label="Private" selected={isPrivate} onClick={() => onChange(true)} disabled={disabled} />
        <VisButton icon={Globe} label="Public" selected={!isPrivate} onClick={() => onChange(false)} disabled={disabled} />
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <VisibilityCard icon={Lock} title="Private" desc="Only you can see this repository" selected={isPrivate} onClick={() => onChange(true)} disabled={disabled} />
      <VisibilityCard icon={Globe} title="Public" desc="Anyone on the internet can see this" selected={!isPrivate} onClick={() => onChange(false)} disabled={disabled} />
    </div>
  );
}

function VisButton({ icon: Icon, label, selected, onClick, disabled }: { icon: typeof Lock; label: string; selected: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      className={cn(
        "pressable flex items-center gap-2 rounded-[var(--radius-control)] border px-3 py-2 text-[13px] transition-colors disabled:opacity-60 [@media(pointer:coarse)]:min-h-10",
        selected ? "border-primary bg-primary-soft text-primary" : "border-border bg-surface-2 text-muted hover:border-border-strong",
      )}
    >
      <Icon size={14} /> {label}
    </button>
  );
}

function VisibilityCard({ icon: Icon, title, desc, selected, onClick, disabled }: { icon: typeof Lock; title: string; desc: string; selected: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      className={cn(
        "pressable flex w-full items-center gap-3 rounded-[var(--radius-control)] border px-3 py-2.5 text-left transition-colors disabled:opacity-60",
        selected ? "border-primary bg-primary-soft" : "border-border bg-surface-2 hover:border-border-strong",
      )}
    >
      <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-lg", selected ? "bg-primary text-primary-foreground" : "bg-surface-3 text-muted")}>
        <Icon size={15} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13.5px] font-medium">{title}</span>
        <span className="block text-[12px] leading-snug text-muted">{desc}</span>
      </span>
      <span className={cn("grid h-4 w-4 shrink-0 place-items-center rounded-full border", selected ? "border-primary bg-primary text-primary-foreground" : "border-border")}>
        {selected && <Check size={11} />}
      </span>
    </button>
  );
}

/* ── Secret-scan findings gate ── */

export interface SecretFinding {
  path: string;
  line: number;
  text: string;
}

export function SecretFindings({
  findings,
  confirmed,
  onConfirm,
  max = 40,
  className,
  confirmLabel = "I've reviewed these and want to continue anyway",
}: {
  findings: SecretFinding[];
  confirmed: boolean;
  onConfirm: (v: boolean) => void;
  max?: number;
  className?: string;
  confirmLabel?: ReactNode;
}) {
  if (findings.length === 0) return null;
  return (
    <section className={cn("rounded-[var(--radius-card)] border border-warn/40 bg-warn-soft px-4 py-3.5", className)}>
      <div className="flex items-start gap-2.5">
        <AlertTriangle size={18} className="mt-0.5 shrink-0 text-warn" />
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold">Possible secrets found</div>
          <p className="mt-0.5 text-[12.5px] text-muted">Review these first — anything you commit to git can be hard to fully erase later.</p>
          {/* paths and matched text can be one long token: wrap anywhere so the card never widens the page */}
          <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto font-mono text-[12px] [overflow-wrap:anywhere]">
            {findings.slice(0, max).map((f, i) => (
              <li key={`${f.path}:${f.line}:${i}`}>
                <span className="text-foreground">{f.path}</span>:<span className="text-muted">{f.line}</span> — {f.text}
              </li>
            ))}
          </ul>
          {findings.length > max && <p className="mt-1 text-[12px] text-faint">+{findings.length - max} more…</p>}
          <label className="mt-2.5 flex cursor-pointer items-center gap-2 text-[13px]">
            <input type="checkbox" checked={confirmed} onChange={(e) => onConfirm(e.target.checked)} className="h-4 w-4 accent-[var(--primary)]" />
            {confirmLabel}
          </label>
        </div>
      </div>
    </section>
  );
}

/* ── Topics chip input ── */

export function TopicsInput({ topics, onChange }: { topics: string[]; onChange: (t: string[]) => void }) {
  const [draft, setDraft] = useState("");
  const add = (raw: string) => {
    const t = sanitizeTopic(raw);
    if (t && !topics.includes(t) && topics.length < 20) onChange([...topics, t]);
    setDraft("");
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-[var(--radius-control)] border border-border bg-surface px-2 py-1.5 focus-within:border-primary focus-within:ring-focus [@media(pointer:coarse)]:min-h-10">
      {topics.map((t) => (
        <span key={t} className="inline-flex items-center gap-0.5 rounded-full bg-surface-2 py-0.5 pl-2 pr-0.5 text-[12px] text-muted">
          #{t}
          {/* the icon stays 11px; the box grows to a thumb-sized target */}
          <button onClick={() => onChange(topics.filter((x) => x !== t))} className="-my-1 grid h-7 w-7 place-items-center rounded-full hover:bg-surface-3 hover:text-danger [@media(pointer:coarse)]:-my-1.5 [@media(pointer:coarse)]:h-8 [@media(pointer:coarse)]:w-8" aria-label={`Remove ${t}`}><X size={11} /></button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") { e.preventDefault(); if (draft.trim()) add(draft); }
          else if (e.key === "Backspace" && !draft && topics.length) onChange(topics.slice(0, -1));
        }}
        onBlur={() => draft.trim() && add(draft)}
        placeholder={topics.length ? "" : "react, cli, typescript…"}
        className="min-w-[8ch] flex-1 self-stretch bg-transparent px-1 py-0.5 text-base outline-none placeholder:text-faint sm:text-[13px] [@media(pointer:coarse)]:min-h-8"
      />
    </div>
  );
}
