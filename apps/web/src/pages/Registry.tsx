import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Blocks, Check, Download, FileText, Search, ShieldAlert, ShieldCheck, Store, User as UserIcon } from "lucide-react";
import { rankRegistry, TOOL_LABEL, TRUST_LABEL, type RegistryEntry, type RegistrySort, type Tool, type Trust } from "@kosh/shared";
import { api, type RegistryDetail } from "@/data/api";
import { useData } from "@/data/store";
import { useUi } from "@/data/ui";
import { cn } from "@/lib/cn";
import { EmptyState, PageHeader, SectionCard } from "@/components/common";
import { Button, Input, Spinner } from "@/components/ui";
import { Modal, SelectMenu } from "@/components/overlays";
import { Markdown } from "@/components/markdown";

const TRUST_TONE: Record<Trust, string> = {
  mine: "bg-primary-soft text-primary",
  reviewed: "bg-ok-soft text-ok",
  unreviewed: "bg-warn-soft text-warn",
};

export function Registry() {
  const backend = useData((s) => s.backend);
  const [all, setAll] = useState<RegistryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [tool, setTool] = useState<"" | Tool>("");
  const [risk, setRisk] = useState<"" | "safe" | "risky">("");
  const [sort, setSort] = useState<RegistrySort>("popular");
  const [selected, setSelected] = useState<RegistryEntry | null>(null);

  const load = async () => {
    setError(null);
    try {
      const { skills } = await api.listRegistry();
      setAll(skills);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load the registry.");
      setAll([]);
    }
  };
  useEffect(() => { if (backend) void load(); else setAll([]); }, [backend]);

  const shown = useMemo(
    () => (all ? rankRegistry(all, { q, tool: tool || undefined, risk: risk || undefined }, sort) : []),
    [all, q, tool, risk, sort],
  );

  if (!backend) {
    return (
      <div>
        <PageHeader title="Skill registry" subtitle="Discover and install skills others have shared." icon={Store} />
        <SectionCard><EmptyState icon={Store} title="Connect the API" description="The registry lists skills shared across users — connect the Kosh API to browse it." /></SectionCard>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Skill registry"
        subtitle="Discover skills others have published. Every install is scanned and lands unreviewed until you vet it."
        icon={Store}
      />

      {/* controls */}
      <SectionCard bodyClassName="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-56">
          <Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search skills, authors, repos…" className="pl-8" />
        </div>
        <SelectMenu
          value={tool} onChange={(v) => setTool(v as "" | Tool)} ariaLabel="Filter by tool"
          options={[{ value: "", label: "All tools" }, ...Object.entries(TOOL_LABEL).map(([v, label]) => ({ value: v, label }))]}
        />
        <SelectMenu
          value={risk} onChange={(v) => setRisk(v as "" | "safe" | "risky")} ariaLabel="Filter by risk"
          options={[{ value: "", label: "Any risk" }, { value: "safe", label: "Clean scan" }, { value: "risky", label: "Flagged" }]}
        />
        <SelectMenu
          value={sort} onChange={(v) => setSort(v as RegistrySort)} ariaLabel="Sort"
          options={[{ value: "popular", label: "Most installed" }, { value: "recent", label: "Recently updated" }, { value: "name", label: "Name" }]}
        />
      </SectionCard>

      {error && <div className="mt-4 rounded-[var(--radius-control)] border border-danger/30 bg-danger-soft px-3 py-2.5 text-[12.5px] text-danger">{error}</div>}

      <div className="mt-4">
        {all === null ? (
          <div className="grid place-items-center py-16"><Spinner size={20} className="text-muted" /></div>
        ) : shown.length === 0 ? (
          <SectionCard>
            <EmptyState
              icon={Blocks}
              title={all.length === 0 ? "No public skills yet" : "No matches"}
              description={all.length === 0 ? "Publish one from your Skills — open a skill and choose “Make public” to share it here." : "Try a different search or filter."}
            />
          </SectionCard>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {shown.map((e) => <RegistryCard key={e.id} entry={e} onReview={() => setSelected(e)} />)}
          </div>
        )}
      </div>

      {selected && <ReviewModal entry={selected} onClose={() => setSelected(null)} onInstalled={load} />}
    </div>
  );
}

function RegistryCard({ entry, onReview }: { entry: RegistryEntry; onReview: () => void }) {
  return (
    <div className="flex flex-col rounded-[var(--radius-card)] border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[14px] font-semibold">{entry.displayName}</div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-muted">
            <UserIcon size={11} /> {entry.author?.login ?? entry.author?.name ?? "someone"}
            {entry.source && <span className="truncate">· {entry.source}</span>}
          </div>
        </div>
        <RiskBadge risky={entry.risky} count={entry.findingCount} />
      </div>

      {entry.description && <p className="mt-2 line-clamp-2 text-[12.5px] text-muted">{entry.description}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {entry.tools.map((t) => (
          <span key={t} className="rounded-[var(--radius-chip)] bg-surface-2 px-1.5 py-0.5 text-[11px] text-muted">{TOOL_LABEL[t]}</span>
        ))}
        <span className={cn("rounded-[var(--radius-chip)] px-1.5 py-0.5 text-[11px] font-medium", TRUST_TONE[entry.trust])}>{TRUST_LABEL[entry.trust]}</span>
      </div>

      <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3">
        <span className="inline-flex items-center gap-1 text-[11.5px] text-faint"><Download size={12} /> {entry.installs} install{entry.installs === 1 ? "" : "s"}</span>
        <Button variant="secondary" size="sm" onClick={onReview}><FileText size={14} /> Review &amp; install</Button>
      </div>
    </div>
  );
}

function RiskBadge({ risky, count }: { risky: boolean; count: number }) {
  if (risky) {
    return <span className="inline-flex shrink-0 items-center gap-1 rounded-[var(--radius-chip)] bg-warn-soft px-1.5 py-0.5 text-[11px] font-medium text-warn"><ShieldAlert size={12} /> {count} finding{count === 1 ? "" : "s"}</span>;
  }
  return <span className="inline-flex shrink-0 items-center gap-1 rounded-[var(--radius-chip)] bg-ok-soft px-1.5 py-0.5 text-[11px] font-medium text-ok"><ShieldCheck size={12} /> Clean</span>;
}

/** Review-before-install: shows the scan findings + SKILL.md + file list, and gates install behind a confirm
 *  (a danger button when the scan flagged something). Installed copies always land unreviewed. */
function ReviewModal({ entry, onClose, onInstalled }: { entry: RegistryEntry; onClose: () => void; onInstalled: () => void }) {
  const upsertSkill = useData((s) => s.upsertSkill);
  const toast = useUi((s) => s.toast);
  const [detail, setDetail] = useState<RegistryDetail | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    let alive = true;
    api.getRegistrySkill(entry.id).then((d) => { if (alive) setDetail(d); }).catch((e) => { if (alive) setLoadErr(e instanceof Error ? e.message : "Couldn't load this skill."); });
    return () => { alive = false; };
  }, [entry.id]);

  const skillMd = detail?.files.find((f) => /(^|\/)SKILL\.md$/i.test(f.path))?.content;

  const install = async () => {
    setInstalling(true);
    try {
      const r = await api.installFromRegistry(entry.id);
      upsertSkill(r.skill);
      toast({ message: r.duplicate ? "Already in your vault" : "Installed — review it before running", tone: "ok" });
      onInstalled();
      onClose();
    } catch (err) {
      toast({ message: "Install failed", description: err instanceof Error ? err.message : undefined, tone: "danger" });
    } finally {
      setInstalling(false);
    }
  };

  return (
    <Modal open onClose={onClose} className="max-w-2xl" labelledBy="reg-title">
      <div className="flex shrink-0 items-center gap-3 border-b border-border px-5 py-4">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary"><Blocks size={20} /></span>
        <div className="min-w-0 flex-1">
          <h2 id="reg-title" className="truncate text-[15px] font-semibold">{entry.displayName}</h2>
          <p className="truncate text-[12px] text-muted">by {entry.author?.login ?? "someone"}{entry.source ? ` · ${entry.source}` : ""}</p>
        </div>
        <RiskBadge risky={entry.risky} count={entry.findingCount} />
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
        {loadErr ? (
          <div className="text-[13px] text-danger">{loadErr}</div>
        ) : !detail ? (
          <div className="grid place-items-center py-10"><Spinner size={18} className="text-muted" /></div>
        ) : (
          <>
            {/* scan findings — the security gate */}
            {detail.scan.risky ? (
              <div className="rounded-[var(--radius-control)] border border-warn/30 bg-warn-soft/40 p-3">
                <div className="mb-1.5 flex items-center gap-1.5 text-[12.5px] font-semibold text-warn"><AlertTriangle size={14} /> The scan flagged {detail.scan.findings.length} thing{detail.scan.findings.length === 1 ? "" : "s"}</div>
                <ul className="space-y-1">
                  {detail.scan.findings.slice(0, 12).map((f, i) => (
                    <li key={i} className="flex gap-2 text-[12px] text-foreground">
                      <span className="font-mono text-faint">{f.path}:{f.line}</span>
                      <span className="text-muted">{f.text}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-[11.5px] text-muted">Read the code below before you install. The copy lands <span className="font-medium">unreviewed</span> and won't run until you vet it.</p>
              </div>
            ) : (
              <div className="inline-flex items-center gap-1.5 rounded-[var(--radius-control)] bg-ok-soft px-3 py-1.5 text-[12.5px] text-ok"><ShieldCheck size={14} /> The static scan found nothing risky.</div>
            )}

            {/* files */}
            <div>
              <div className="mb-1.5 text-[12px] font-medium text-muted">{detail.files.length} file{detail.files.length === 1 ? "" : "s"}</div>
              <div className="flex flex-wrap gap-1.5">
                {detail.files.map((f) => (
                  <span key={f.path} className="rounded-[var(--radius-chip)] bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-muted">{f.path}</span>
                ))}
              </div>
            </div>

            {/* SKILL.md preview */}
            {skillMd && (
              <div>
                <div className="mb-1.5 text-[12px] font-medium text-muted">SKILL.md</div>
                <div className="max-h-72 overflow-y-auto rounded-[var(--radius-control)] border border-border bg-surface-2 p-3">
                  <Markdown className="text-[13px]">{skillMd}</Markdown>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border px-5 py-3.5">
        <span className="text-[11.5px] text-faint">Installs a copy into your vault — always unreviewed.</span>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant={detail?.scan.risky ? "danger" : "primary"} onClick={install} loading={installing} disabled={!detail}>
            {detail?.scan.risky ? <AlertTriangle size={15} /> : <Check size={15} />} Install{detail?.scan.risky ? " anyway" : ""}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
