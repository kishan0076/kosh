import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ArrowLeft, ArrowRight, Check, CopyCheck, Inbox as InboxIcon, PlayCircle, ShieldAlert, Sparkles, Trash2, X } from "lucide-react";
import { normalizeUrl, type Item, type Stage } from "@kosh/shared";
import { useData } from "@/data/store";
import { useUi } from "@/data/ui";
import { inbox, live } from "@/data/selectors";
import { itemIcon, GitHubMark } from "@/lib/icons";
import { ago } from "@/lib/time";
import { DUR, EASE, SPRING } from "@/lib/motion";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { PageHeader } from "@/components/common";
import { Button, Kbd, Progress } from "@/components/ui";

// Keyboard hints are noise under a thumb: hidden on touch screens, kept for keyboard users.
const KBD = "[@media(pointer:coarse)]:hidden";

/** AI-suggested tags for an item that aren't already applied. */
const suggestedFor = (it: Item): string[] => (it.ai?.suggestedTags ?? []).filter((t) => !it.tags.includes(t));

export function Inbox() {
  const items = useData((s) => s.items);
  const skills = useData((s) => s.skills);
  const setStage = useData((s) => s.setStage);
  const patchItem = useData((s) => s.patchItem);
  const softDelete = useData((s) => s.softDelete);
  const restore = useData((s) => s.restore);
  const openItem = useUi((s) => s.openItem);
  const openVerdict = useUi((s) => s.openVerdict);
  const toast = useUi((s) => s.toast);
  const dismissToast = useUi((s) => s.dismissToast);
  const touch = useMediaQuery("(pointer: coarse)");

  const queue = inbox(items);
  const [idx, setIdx] = useState(0);
  const total = queue.length;
  const current = queue[Math.min(idx, total - 1)];

  // Duplicate detection: normalized URLs that appear on more than one live item.
  const dupUrls = useMemo(() => {
    const counts = new Map<string, number>();
    for (const i of live(items)) if (i.url) { const u = normalizeUrl(i.url); counts.set(u, (counts.get(u) ?? 0) + 1); }
    return new Set([...counts.entries()].filter(([, n]) => n > 1).map(([u]) => u));
  }, [items]);

  const isDup = !!current?.url && dupUrls.has(normalizeUrl(current.url));
  const skill = current?.skillId ? skills.find((s) => s.id === current.skillId) : undefined;
  const risky = skill?.versions.at(-1)?.scan.risky ?? false;
  const suggested = current ? suggestedFor(current) : [];

  const advance = () => setIdx((i) => Math.min(i + 1, total));
  const applyTags = (it: Item, tags: string[]) => {
    if (!tags.length) return;
    patchItem(it.id, { tags: [...new Set([...it.tags, ...tags])] });
  };
  const decide = (stage: Stage) => {
    if (!current) return;
    if (stage === "dropped") {
      openVerdict(current.id); // dropping asks for a one-line verdict; the dialog sets the stage
      return;
    }
    setStage(current.id, stage);
    toast({ message: `Moved to ${stage}`, description: current.title, tone: "ok" });
  };
  const accept = () => {
    if (!current) return;
    applyTags(current, suggestedFor(current));
    setStage(current.id, "trying");
    toast({ message: "Accepted", description: current.title, tone: "ok" });
  };
  const acceptAll = () => {
    const q = inbox(items); // snapshot
    for (const it of q) {
      applyTags(it, suggestedFor(it));
      patchItem(it.id, { stage: "trying" });
    }
    toast({ message: `Accepted ${q.length} item${q.length === 1 ? "" : "s"}`, description: "Applied suggested tags and moved to Trying", tone: "ok" });
    setIdx(0);
  };
  const del = () => {
    if (!current) return;
    const id = toast({ message: "Deleted", description: current.title, action: { label: "Undo", onClick: () => restore(current.id) } });
    softDelete(current.id, { onError: () => dismissToast(id) });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (!current) return;
      switch (e.key.toLowerCase()) {
        case "a": accept(); break;
        case "u": decide("using"); break;
        case "t": decide("trying"); break;
        case "d": decide("dropped"); break;
        case "x": del(); break;
        case "s":
        case "arrowright":
        case "j": advance(); break;
        case "arrowleft":
        case "k": setIdx((i) => Math.max(0, i - 1)); break;
        case "enter": openItem(current.id); break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, total, items]);

  const done = total === 0 || idx >= total;

  return (
    <div>
      <PageHeader
        title="Inbox"
        subtitle={touch ? "Triage new captures" : "Triage new captures — keyboard-first"}
        icon={InboxIcon}
        actions={total > 0 ? <Button variant="outline" size="sm" onClick={acceptAll}><CopyCheck size={15} /> Accept all {total}</Button> : undefined}
      />

      {done ? (
        <div className="flex flex-col items-center justify-center rounded-[var(--radius-card)] border border-border bg-surface px-6 py-20 text-center">
          <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={SPRING.snappy} className="mb-4 grid h-16 w-16 place-items-center rounded-full bg-ok-soft text-ok">
            <Check size={32} />
          </motion.div>
          <h2 className="font-display text-xl font-semibold">Inbox zero</h2>
          <p className="mt-1 max-w-sm text-sm text-muted">Everything's triaged. New captures from the web, bot, share sheet and email land here.</p>
        </div>
      ) : (
        <div className="w-full">
          <div className="mb-4 flex items-center gap-3">
            <Progress value={(idx / total) * 100} className="flex-1" />
            <span className="tabular text-[13px] text-muted">{idx + 1} / {total}</span>
          </div>

          <AnimatePresence mode="wait">
            {current && (
              <motion.div
                key={current.id}
                initial={{ opacity: 0, y: 16, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -16, scale: 0.98 }}
                transition={{ duration: DUR.base, ease: EASE.standard }}
                className="rounded-[var(--radius-panel)] border border-border bg-surface p-5 sm:p-6"
              >
                {/* smart signals */}
                {(isDup || risky) && (
                  <div className="mb-4 flex flex-wrap gap-2">
                    {isDup && <span className="inline-flex items-center gap-1.5 rounded-full bg-warn-soft px-2.5 py-1 text-[12px] font-medium text-warn"><CopyCheck size={13} /> Possible duplicate</span>}
                    {risky && <button type="button" onClick={() => openItem(current.id)} className="inline-flex items-center gap-1.5 rounded-full bg-danger-soft px-2.5 py-1 text-[12px] font-medium text-danger"><ShieldAlert size={13} /> Skill flagged risky — review</button>}
                  </div>
                )}

                <div className="flex items-start gap-3">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary">
                    {current.linkType === "repo" ? <GitHubMark size={20} /> : (() => { const I = itemIcon(current); return <I size={20} />; })()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <button type="button" onClick={() => openItem(current.id)} className="-my-2 max-w-full rounded-md py-2 text-left pressable">
                      <h2 className="break-words text-lg font-semibold leading-snug [overflow-wrap:anywhere]">{current.title}</h2>
                    </button>
                    <p className="mt-0.5 break-words text-[12px] text-faint [overflow-wrap:anywhere]">
                      {current.meta?.siteName ?? current.url} · saved {ago(current.createdAt)}
                      {current.foundVia ? ` · via ${current.foundVia.label}` : ""}
                    </p>
                  </div>
                </div>

                {(current.ai?.summary ?? current.description) && (
                  <p className="mt-4 text-[14px] leading-relaxed text-muted">{current.ai?.summary ?? current.description}</p>
                )}

                {current.tags.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-1.5">
                    {current.tags.map((t) => <span key={t} className="rounded-md bg-surface-2 px-2 py-0.5 text-[12px] text-muted">#{t}</span>)}
                  </div>
                )}

                {/* AI-suggested tags */}
                {suggested.length > 0 && (
                  <div className="mt-4">
                    <div className="mb-1.5 flex items-center gap-1.5 text-[12px] font-medium text-primary"><Sparkles size={13} /> Suggested tags</div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {suggested.map((t) => (
                        <button
                          key={t}
                          onClick={() => applyTags(current, [t])}
                          className="pressable inline-flex min-h-7 items-center gap-1 rounded-md border border-dashed border-border-strong px-2 text-[12px] text-muted hover:border-primary hover:text-primary [@media(pointer:coarse)]:min-h-9"
                        >
                          + #{t}
                        </button>
                      ))}
                      <button onClick={() => applyTags(current, suggested)} className="pressable inline-flex min-h-7 items-center gap-1 rounded-md px-2 text-[12px] font-medium text-primary hover:bg-primary-soft [@media(pointer:coarse)]:min-h-9">
                        Apply all
                      </button>
                    </div>
                  </div>
                )}

                {/* accept — apply suggestions + keep */}
                <button
                  type="button"
                  onClick={accept}
                  className="mt-5 flex w-full items-center justify-center gap-2 rounded-[var(--radius-control)] bg-primary px-4 py-2.5 text-[14px] font-semibold text-primary-foreground pressable hover:bg-primary-hover motion-safe:active:scale-[0.98]"
                >
                  <Sparkles size={16} /> Accept {suggested.length > 0 ? "— apply tags & keep" : "& keep"} <Kbd className={`${KBD} border-primary-foreground/30 bg-primary-foreground/10 text-primary-foreground`}>A</Kbd>
                </button>

                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <TriageBtn onClick={() => decide("using")} icon={Check} label="Use" k="U" tone="ok" />
                  <TriageBtn onClick={() => decide("trying")} icon={PlayCircle} label="Try" k="T" tone="info" />
                  <TriageBtn onClick={() => decide("dropped")} icon={X} label="Drop" k="D" tone="warn" />
                  <TriageBtn onClick={del} icon={Trash2} label="Delete" k="X" tone="danger" />
                </div>

                <div className="mt-4 flex items-center justify-between border-t border-border pt-4">
                  <Button variant="ghost" size="sm" onClick={() => setIdx((i) => Math.max(0, i - 1))} disabled={idx === 0}>
                    <ArrowLeft size={15} /> Prev <Kbd className={KBD}>K</Kbd>
                  </Button>
                  <Button variant="ghost" size="sm" onClick={advance}>
                    Skip <Kbd className={KBD}>S</Kbd> <ArrowRight size={15} />
                  </Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

function TriageBtn({ onClick, icon: Icon, label, k, tone }: { onClick: () => void; icon: typeof Check; label: string; k: string; tone: "ok" | "info" | "warn" | "danger" }) {
  const tones = {
    ok: "hover:border-ok hover:bg-ok-soft hover:text-ok",
    info: "hover:border-info hover:bg-info-soft hover:text-info",
    warn: "hover:border-warn hover:bg-warn-soft hover:text-warn",
    danger: "hover:border-danger hover:bg-danger-soft hover:text-danger",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col items-center gap-1.5 rounded-[var(--radius-control)] border border-border bg-surface px-3 py-3 text-[13px] font-medium text-muted transition-colors pressable motion-safe:active:scale-[0.97] ${tones[tone]}`}
    >
      <Icon size={18} />
      <span className="flex items-center gap-1.5">{label} <Kbd className={KBD}>{k}</Kbd></span>
    </button>
  );
}
