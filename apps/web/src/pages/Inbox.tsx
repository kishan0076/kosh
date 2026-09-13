import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ArrowLeft, ArrowRight, Check, Inbox as InboxIcon, PlayCircle, Trash2, X } from "lucide-react";
import type { Stage } from "@kosh/shared";
import { useData } from "@/data/store";
import { useUi } from "@/data/ui";
import { inbox } from "@/data/selectors";
import { itemIcon, GitHubMark } from "@/lib/icons";
import { ago } from "@/lib/time";
import { PageHeader } from "@/components/common";
import { Button, Kbd, Progress } from "@/components/ui";

export function Inbox() {
  const items = useData((s) => s.items);
  const setStage = useData((s) => s.setStage);
  const softDelete = useData((s) => s.softDelete);
  const restore = useData((s) => s.restore);
  const openItem = useUi((s) => s.openItem);
  const openVerdict = useUi((s) => s.openVerdict);
  const toast = useUi((s) => s.toast);

  const queue = inbox(items);
  const [idx, setIdx] = useState(0);
  const total = queue.length;
  const current = queue[Math.min(idx, total - 1)];

  const advance = () => setIdx((i) => Math.min(i + 1, total));
  const decide = (stage: Stage) => {
    if (!current) return;
    // Dropping asks for a one-line verdict; the dialog sets the stage.
    if (stage === "dropped") {
      openVerdict(current.id);
      return;
    }
    setStage(current.id, stage);
    toast({ message: `Moved to ${stage}`, description: current.title, tone: "ok" });
    // item leaves the queue automatically; keep idx pointing at the next
  };
  const del = () => {
    if (!current) return;
    softDelete(current.id);
    toast({ message: "Deleted", description: current.title, action: { label: "Undo", onClick: () => restore(current.id) } });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (!current) return;
      switch (e.key.toLowerCase()) {
        case "u":
          decide("using");
          break;
        case "t":
          decide("trying");
          break;
        case "d":
          decide("dropped");
          break;
        case "x":
          del();
          break;
        case "s":
        case "arrowright":
        case "j":
          advance();
          break;
        case "arrowleft":
        case "k":
          setIdx((i) => Math.max(0, i - 1));
          break;
        case "enter":
          openItem(current.id);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, total]);

  const done = total === 0 || idx >= total;

  return (
    <div>
      <PageHeader title="Inbox" subtitle="Triage new captures — keyboard-first" icon={InboxIcon} />

      {done ? (
        <div className="flex flex-col items-center justify-center rounded-[var(--radius-card)] border border-border bg-surface px-6 py-20 text-center">
          <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 400, damping: 20 }} className="mb-4 grid h-16 w-16 place-items-center rounded-full bg-ok-soft text-ok">
            <Check size={32} />
          </motion.div>
          <h2 className="font-display text-xl font-semibold">Inbox zero</h2>
          <p className="mt-1 max-w-sm text-sm text-muted">Everything's triaged. New captures from the web, bot, share sheet and email land here.</p>
        </div>
      ) : (
        <div className="mx-auto max-w-2xl">
          <div className="mb-4 flex items-center gap-3">
            <Progress value={(idx / total) * 100} className="flex-1" />
            <span className="tabular text-[13px] text-muted">
              {idx + 1} / {total}
            </span>
          </div>

          <AnimatePresence mode="wait">
            {current && (
              <motion.div
                key={current.id}
                initial={{ opacity: 0, y: 16, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -16, scale: 0.98 }}
                transition={{ duration: 0.2 }}
                className="rounded-[var(--radius-panel)] border border-border bg-surface p-6"
              >
                <div className="flex items-start gap-3">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary">
                    {current.linkType === "repo" ? <GitHubMark size={20} /> : (() => { const I = itemIcon(current); return <I size={20} />; })()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <button onClick={() => openItem(current.id)} className="text-left">
                      <h2 className="text-lg font-semibold">{current.title}</h2>
                    </button>
                    <p className="mt-0.5 text-[12px] text-faint">
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
                    {current.tags.map((t) => (
                      <span key={t} className="rounded-md bg-surface-2 px-2 py-0.5 text-[12px] text-muted">#{t}</span>
                    ))}
                  </div>
                )}

                <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <TriageBtn onClick={() => decide("using")} icon={Check} label="Use" k="U" tone="ok" />
                  <TriageBtn onClick={() => decide("trying")} icon={PlayCircle} label="Try" k="T" tone="info" />
                  <TriageBtn onClick={() => decide("dropped")} icon={X} label="Drop" k="D" tone="warn" />
                  <TriageBtn onClick={del} icon={Trash2} label="Delete" k="X" tone="danger" />
                </div>

                <div className="mt-4 flex items-center justify-between border-t border-border pt-4">
                  <Button variant="ghost" size="sm" onClick={() => setIdx((i) => Math.max(0, i - 1))} disabled={idx === 0}>
                    <ArrowLeft size={15} /> Prev <Kbd>K</Kbd>
                  </Button>
                  <Button variant="ghost" size="sm" onClick={advance}>
                    Skip <Kbd>S</Kbd> <ArrowRight size={15} />
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
      onClick={onClick}
      className={`flex flex-col items-center gap-1.5 rounded-[var(--radius-control)] border border-border bg-surface px-3 py-3 text-[13px] font-medium text-muted transition-colors ${tones[tone]}`}
    >
      <Icon size={18} />
      <span className="flex items-center gap-1.5">
        {label} <Kbd>{k}</Kbd>
      </span>
    </button>
  );
}
