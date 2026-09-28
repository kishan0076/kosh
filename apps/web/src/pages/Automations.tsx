import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Trash2, Workflow, X } from "lucide-react";
import { RULE_STAGES, type AutomationRule, type RuleAction, type RuleActionType, type RuleCondition, type RuleField } from "@kosh/shared";
import { api } from "@/data/api";
import { useData } from "@/data/store";
import { useUi } from "@/data/ui";
import { cn } from "@/lib/cn";
// (cn used for the match-count banner)
import { EmptyState, PageHeader } from "@/components/common";
import { Button, Input, Toggle } from "@/components/ui";
import { Modal, SelectMenu } from "@/components/overlays";

const FIELD_OPTS: { value: RuleField; label: string }[] = [
  { value: "kind", label: "Kind" },
  { value: "linkType", label: "Link type" },
  { value: "repoKind", label: "Repo kind" },
  { value: "source", label: "Source" },
  { value: "url", label: "URL contains" },
  { value: "title", label: "Title contains" },
  { value: "tag", label: "Has tag" },
  { value: "stage", label: "Stage" },
];
const FIELD_PLACEHOLDER: Record<RuleField, string> = {
  kind: "link / skill / prompt / file", linkType: "repo / article / video …", repoKind: "mcp-server / skills / cli …",
  source: "web / bot / email / import …", url: "github.com", title: "invoice", tag: "ai", stage: "to-try / trying / using / dropped",
};
const ACTION_OPTS: { value: RuleActionType; label: string }[] = [
  { value: "addTags", label: "Add tags" },
  { value: "setStage", label: "Set stage" },
  { value: "addToCollection", label: "Add to collection" },
  { value: "pin", label: "Pin" },
  { value: "archive", label: "Archive (links)" },
];
const needsValue = (t: RuleActionType) => t === "addTags" || t === "setStage" || t === "addToCollection";

function summarize(rule: AutomationRule): string {
  const conds = rule.conditions.length ? rule.conditions.map((c) => `${c.field} ${c.field === "url" || c.field === "title" ? "⊇" : "="} ${c.value}`).join(rule.match === "any" ? " OR " : " AND ") : "any item";
  const acts = rule.actions.map((a) => (needsValue(a.type) ? `${a.type}: ${a.value}` : a.type)).join(", ");
  return `When ${conds} → ${acts}`;
}

export function Automations() {
  const backend = useData((s) => s.backend);
  const toast = useUi((s) => s.toast);
  const [rules, setRules] = useState<AutomationRule[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<AutomationRule | "new" | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setRules((await api.listRules()).rules);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load your automations.");
      setRules([]);
    }
  }, []);
  useEffect(() => { if (backend) void load(); else setRules([]); }, [backend, load]);

  const toggle = async (r: AutomationRule) => {
    setRules((prev) => prev?.map((x) => (x.id === r.id ? { ...x, enabled: !x.enabled } : x)) ?? null);
    try { await api.updateRule(r.id, { enabled: !r.enabled }); }
    catch (err) { toast({ message: "Couldn't update", description: err instanceof Error ? err.message : undefined, tone: "danger" }); void load(); }
  };
  const remove = async (r: AutomationRule) => {
    setRules((prev) => prev?.filter((x) => x.id !== r.id) ?? null);
    try { await api.deleteRule(r.id); toast({ message: "Rule deleted", tone: "ok" }); }
    catch (err) { toast({ message: "Couldn't delete", description: err instanceof Error ? err.message : undefined, tone: "danger" }); void load(); }
  };

  return (
    <div>
      <PageHeader
        title="Automations"
        subtitle="Rules that tag, file, pin or archive items automatically as they're captured."
        icon={Workflow}
        actions={backend ? <Button variant="primary" onClick={() => setEditing("new")}><Plus size={16} /> New rule</Button> : undefined}
      />

      {!backend ? (
        <EmptyState icon={Workflow} title="Automations need the API backend" description="Connect the Kosh API to run rules on your captures." />
      ) : error ? (
        <EmptyState icon={Workflow} title="Couldn't load automations" description={error} action={<Button variant="primary" onClick={() => void load()}>Try again</Button>} />
      ) : rules === null ? (
        <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-20 rounded-[var(--radius-card)] border border-border bg-surface shimmer" />)}</div>
      ) : rules.length === 0 ? (
        <EmptyState
          icon={Workflow}
          title="No automations yet"
          description="Create a rule like “new repo → tag dev + add to Read later”, or “PDF from stripe.com → tag invoice + archive”."
          action={<Button variant="primary" onClick={() => setEditing("new")}><Plus size={16} /> New rule</Button>}
        />
      ) : (
        <div className="space-y-2">
          {rules.map((r) => (
            <div key={r.id} className="flex items-center gap-3 rounded-[var(--radius-card)] border border-border bg-surface px-4 py-3">
              <Toggle checked={r.enabled} onChange={() => void toggle(r)} label={`Enable ${r.name}`} />
              <button type="button" onClick={() => setEditing(r)} className="min-w-0 flex-1 text-left pressable">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[14px] font-semibold">{r.name}</span>
                  {!r.enabled && <span className="shrink-0 rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-faint">off</span>}
                </div>
                <div className="mt-0.5 line-clamp-1 text-[12px] text-muted">{summarize(r)}</div>
              </button>
              {!!r.runCount && <span className="hidden shrink-0 text-[11px] text-faint sm:inline">ran {r.runCount}×</span>}
              <Button variant="ghost" size="icon-sm" aria-label="Delete rule" className="text-faint hover:bg-danger-soft hover:text-danger" onClick={() => void remove(r)}><Trash2 size={15} /></Button>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <RuleBuilder
          open
          rule={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(r) => {
            setRules((prev) => {
              const list = prev ?? [];
              return list.some((x) => x.id === r.id) ? list.map((x) => (x.id === r.id ? r : x)) : [r, ...list];
            });
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function RuleBuilder({ open, rule, onClose, onSaved }: { open: boolean; rule: AutomationRule | null; onClose: () => void; onSaved: (r: AutomationRule) => void }) {
  const toast = useUi((s) => s.toast);
  const [name, setName] = useState(rule?.name ?? "");
  const [match, setMatch] = useState<"all" | "any">(rule?.match ?? "all");
  const [conditions, setConditions] = useState<RuleCondition[]>(rule?.conditions ?? [{ field: "linkType", value: "" }]);
  const [actions, setActions] = useState<RuleAction[]>(rule?.actions ?? [{ type: "addTags", value: "" }]);
  const [busy, setBusy] = useState(false);
  const [match_, setMatchCount] = useState<{ matches: number; total: number } | null>(null);

  // Live "would match N of M" preview (only for filled conditions).
  const filledConds = useMemo(() => conditions.filter((c) => c.value.trim()), [conditions]);
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      api.testRule(match, filledConds).then((r) => { if (alive) setMatchCount(r); }).catch(() => {});
    }, 300);
    return () => { alive = false; clearTimeout(t); };
  }, [match, filledConds]);

  const valid = name.trim() && actions.length > 0 && actions.every((a) => !needsValue(a.type) || (a.value ?? "").trim());

  const save = async () => {
    if (!valid || busy) return;
    setBusy(true);
    const payload = { name: name.trim(), match, conditions: filledConds, actions };
    try {
      const { rule: saved } = rule ? await api.updateRule(rule.id, payload) : await api.createRule(payload);
      toast({ message: rule ? "Rule updated" : "Rule created", tone: "ok" });
      onSaved(saved);
    } catch (err) {
      toast({ message: "Couldn't save rule", description: err instanceof Error ? err.message : undefined, tone: "danger" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} className="max-w-xl" labelledBy="rule-title">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-5 py-4">
        <Workflow size={18} className="text-primary" />
        <h2 id="rule-title" className="text-base font-semibold">{rule ? "Edit rule" : "New rule"}</h2>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Rule name" aria-label="Rule name" autoFocus />

        {/* WHEN */}
        <div>
          <div className="mb-1.5 flex items-center gap-2 text-[12px] font-semibold text-muted">
            When
            <SelectMenu value={match} size="sm" width={110} options={[{ value: "all", label: "all match" }, { value: "any", label: "any match" }]} onChange={(v) => setMatch(v as "all" | "any")} ariaLabel="Match mode" />
          </div>
          <div className="space-y-2">
            {conditions.map((c, i) => (
              <div key={i} className="flex items-center gap-2">
                <SelectMenu value={c.field} width={150} options={FIELD_OPTS} onChange={(v) => setConditions((s) => s.map((x, j) => (j === i ? { ...x, field: v as RuleField } : x)))} ariaLabel="Field" />
                <Input value={c.value} onChange={(e) => setConditions((s) => s.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} placeholder={FIELD_PLACEHOLDER[c.field]} aria-label="Value" className="flex-1" />
                <Button variant="ghost" size="icon-sm" aria-label="Remove condition" onClick={() => setConditions((s) => s.filter((_, j) => j !== i))}><X size={15} /></Button>
              </div>
            ))}
          </div>
          <button type="button" onClick={() => setConditions((s) => [...s, { field: "tag", value: "" }])} className="mt-2 text-[12px] font-medium text-primary hover:underline">+ Add condition</button>
        </div>

        {/* THEN */}
        <div>
          <div className="mb-1.5 text-[12px] font-semibold text-muted">Then</div>
          <div className="space-y-2">
            {actions.map((a, i) => (
              <div key={i} className="flex items-center gap-2">
                {/* Seed setStage with a valid default so the shown 'trying' isn't a mirage that keeps Save disabled. */}
                <SelectMenu value={a.type} width={170} options={ACTION_OPTS} onChange={(v) => setActions((s) => s.map((x, j) => (j === i ? { type: v as RuleActionType, value: v === "setStage" ? "trying" : "" } : x)))} ariaLabel="Action" />
                {a.type === "setStage" ? (
                  <SelectMenu value={a.value || "trying"} width={140} options={RULE_STAGES.map((s) => ({ value: s, label: s }))} onChange={(v) => setActions((s) => s.map((x, j) => (j === i ? { ...x, value: v } : x)))} ariaLabel="Stage" />
                ) : needsValue(a.type) ? (
                  <Input value={a.value ?? ""} onChange={(e) => setActions((s) => s.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} placeholder={a.type === "addTags" ? "tag1, tag2" : "Collection name"} aria-label="Action value" className="flex-1" />
                ) : (
                  <span className="flex-1 text-[12px] text-faint">{a.type === "pin" ? "Pin the item" : "Save a readable archive copy"}</span>
                )}
                <Button variant="ghost" size="icon-sm" aria-label="Remove action" onClick={() => setActions((s) => s.filter((_, j) => j !== i))} disabled={actions.length === 1}><X size={15} /></Button>
              </div>
            ))}
          </div>
          <button type="button" onClick={() => setActions((s) => [...s, { type: "addTags", value: "" }])} className="mt-2 text-[12px] font-medium text-primary hover:underline">+ Add action</button>
        </div>

        {match_ && (
          <p className={cn("rounded-[var(--radius-control)] px-3 py-2 text-[12px]", match_.matches ? "bg-primary-soft/40 text-primary" : "bg-surface-2 text-muted")}>
            {filledConds.length === 0 ? "Matches every item" : `Matches ${match_.matches} of ${match_.total} current items`} — new captures are evaluated automatically.
          </p>
        )}
      </div>
      <div className="flex shrink-0 justify-end gap-2 border-t border-border px-5 py-3.5">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={() => void save()} disabled={!valid} loading={busy}>{rule ? "Save" : "Create rule"}</Button>
      </div>
    </Modal>
  );
}
