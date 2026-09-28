import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Cpu, FlaskConical, Play, Sparkles } from "lucide-react";
import { renderPrompt, type Item } from "@kosh/shared";
import { api } from "@/data/api";
import { useData } from "@/data/store";
import { useUi } from "@/data/ui";
import { cn } from "@/lib/cn";
import { Button, Input, Textarea, Spinner } from "@/components/ui";
import { Modal } from "@/components/overlays";
import { Markdown } from "@/components/markdown";
import { localAiEnabled, localComplete } from "@/lib/localAi";

/**
 * Prompt Playground — fill a prompt's {{variables}}, run it against the user's provider, and optionally
 * A/B a tweaked variant side-by-side. Turns the prompt library from storage into a workbench.
 */
export function PromptPlayground({ item, open, onClose }: { item: Item; open: boolean; onClose: () => void }) {
  const backend = useData((s) => s.backend);
  const toast = useUi((s) => s.toast);
  const vars = item.prompt?.variables ?? [];
  const bodyA = item.prompt?.body ?? "";

  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(vars.map((v) => [v.name, v.default ?? ""])));
  const [compare, setCompare] = useState(false);
  const [bodyB, setBodyB] = useState(bodyA);
  const [outA, setOutA] = useState<string | null>(null);
  const [outB, setOutB] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // On-device: run against the user's local model (zero cost, private). Needs no backend.
  const [onDevice, setOnDevice] = useState(() => localAiEnabled());
  const localAvailable = localAiEnabled();
  const canRun = onDevice || backend;

  const renderedA = useMemo(() => renderPrompt(bodyA, values), [bodyA, values]);
  const renderedB = useMemo(() => renderPrompt(bodyB, values), [bodyB, values]);

  const run = async () => {
    if (busy || !canRun) return;
    setBusy(true);
    setNote(null);
    setOutA(null);
    setOutB(null);
    try {
      if (onDevice) {
        const [a, b] = await Promise.all([localComplete({ prompt: renderedA }), ...(compare ? [localComplete({ prompt: renderedB })] : [])]);
        setOutA(a ?? "(no output)");
        if (compare) setOutB(b ?? "(no output)");
        return;
      }
      const results = await Promise.all([api.complete(renderedA), ...(compare ? [api.complete(renderedB)] : [])]);
      const a = results[0]!;
      if (!a.aiAvailable) { setNote("AI isn't configured — add a provider key in Settings, or enable On-device AI to run prompts."); return; }
      if (a.capReached) { setNote("Daily AI limit reached — try again later, or switch to On-device."); return; }
      setOutA(a.output ?? "(no output)");
      if (compare) setOutB(results[1]?.output ?? "(no output)");
    } catch (err) {
      toast({ message: onDevice ? "On-device run failed" : "Run failed", description: err instanceof Error ? err.message : undefined, tone: "danger" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} className="max-w-3xl" labelledBy="playground-title">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-5 py-4">
        <FlaskConical size={18} className="text-primary" />
        <h2 id="playground-title" className="min-w-0 flex-1 truncate text-base font-semibold">Playground · {item.title}</h2>
        {localAvailable && (
          <label className="flex cursor-pointer items-center gap-1.5 text-[12px] font-medium text-muted" title="Run on your local model — free & private">
            <input type="checkbox" checked={onDevice} onChange={(e) => setOnDevice(e.target.checked)} className="accent-[var(--gold)]" /> <Cpu size={13} className="text-gold" /> On-device
          </label>
        )}
        <label className="flex cursor-pointer items-center gap-1.5 text-[12px] font-medium text-muted">
          <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} className="accent-[var(--primary)]" /> A/B compare
        </label>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
        {/* variables */}
        {vars.length > 0 && (
          <div className="grid gap-2 sm:grid-cols-2">
            {vars.map((v) => (
              <label key={v.name} className="block">
                <span className="mb-1 block font-mono text-[11.5px] text-muted">{`{{${v.name}}}`}</span>
                <Input value={values[v.name] ?? ""} onChange={(e) => setValues((s) => ({ ...s, [v.name]: e.target.value }))} placeholder={v.default || v.name} aria-label={v.name} />
              </label>
            ))}
          </div>
        )}

        {/* bodies */}
        <div className={cn("grid gap-3", compare && "sm:grid-cols-2")}>
          <div>
            <div className="mb-1 text-[12px] font-medium text-muted">{compare ? "A · original" : "Prompt"}</div>
            <div className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-[var(--radius-control)] border border-border bg-surface-2 p-3 font-mono text-[12px] leading-snug [overflow-wrap:anywhere]">{renderedA}</div>
          </div>
          {compare && (
            <div>
              <div className="mb-1 text-[12px] font-medium text-muted">B · variant (editable)</div>
              <Textarea value={bodyB} onChange={(e) => setBodyB(e.target.value)} rows={6} className="resize-y font-mono sm:text-[12px]" aria-label="Variant body" />
            </div>
          )}
        </div>

        {note && (
          <div className="rounded-[var(--radius-control)] bg-surface-2 px-3 py-2 text-[12.5px] text-muted">
            {note} {note.includes("Settings") && <Link to="/settings" className="text-primary hover:underline">Open Settings</Link>}
          </div>
        )}

        {/* outputs */}
        {(busy || outA != null) && (
          <div className={cn("grid gap-3", compare && "sm:grid-cols-2")}>
            <OutputPane title={compare ? "A output" : "Output"} text={outA} busy={busy} />
            {compare && <OutputPane title="B output" text={outB} busy={busy} />}
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border px-5 py-3.5">
        {onDevice ? (
          <span className="inline-flex items-center gap-1.5 text-[12px] text-gold"><Cpu size={13} /> Runs on your device — free & private</span>
        ) : !backend ? (
          <span className="text-[12px] text-muted">Running needs the API backend{localAvailable ? " or On-device" : ""}.</span>
        ) : <span />}
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <Button variant="primary" onClick={() => void run()} disabled={!canRun} loading={busy}><Play size={15} /> Run{compare ? " both" : ""}</Button>
        </div>
      </div>
    </Modal>
  );
}

function OutputPane({ title, text, busy }: { title: string; text: string | null; busy: boolean }) {
  return (
    <div className="rounded-[var(--radius-control)] border border-primary/20 bg-primary-soft/20 p-3">
      <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-primary"><Sparkles size={12} /> {title}</div>
      {busy && text == null ? (
        <div className="grid place-items-center py-6 text-muted"><Spinner size={18} /></div>
      ) : (
        <Markdown className="text-[13px]">{text ?? ""}</Markdown>
      )}
    </div>
  );
}
