import { useState } from "react";
import { AlertTriangle, Check, Download, FolderInput, Terminal } from "lucide-react";
import type { Skill } from "@kosh/shared";
import { useData } from "@/data/store";
import { useUi } from "@/data/ui";
import { Button } from "../ui";
import { Menu, MenuItem, MenuLabel, MenuSeparator, Modal } from "../overlays";

const TARGETS = [
  { key: "claude", label: "Claude (~/.claude/skills)", cmd: (n: string) => `kosh add ${n}` },
  { key: "project", label: "This project (./.claude/skills)", cmd: (n: string) => `kosh add ${n} --to project` },
  { key: "agents", label: "Agents (./.agents/skills)", cmd: (n: string) => `kosh add ${n} --to agents` },
];

export function InstallMenu({ skill }: { skill: Skill }) {
  const toast = useUi((s) => s.toast);
  const reviewSkill = useData((s) => s.reviewSkill);
  const [gate, setGate] = useState<string | null>(null);
  const version = skill.versions.at(-1);
  const gated = !!version?.scan.risky && skill.trust === "unreviewed";

  const doInstall = (cmd: string) => {
    navigator.clipboard?.writeText(cmd).catch(() => {});
    toast({ message: "Install command copied", description: cmd, tone: "ok" });
  };

  const attempt = (cmd: string) => {
    if (gated) setGate(cmd);
    else doInstall(cmd);
  };

  return (
    <>
      <Menu
        align="end"
        width={280}
        trigger={({ toggle, ref }) => (
          <Button ref={ref} variant="primary" size="sm" onClick={toggle}>
            <Terminal size={15} />
            Install
          </Button>
        )}
      >
        <MenuLabel>Install to</MenuLabel>
        {TARGETS.map((t) => (
          <MenuItem key={t.key} icon={FolderInput} onClick={() => attempt(t.cmd(skill.name))}>
            {t.label}
          </MenuItem>
        ))}
        <MenuSeparator />
        <MenuItem icon={Terminal} onClick={() => attempt(`npx kosh add ${skill.name}`)}>
          Copy npx command
        </MenuItem>
        <MenuItem icon={Download} onClick={() => toast({ message: "Downloading zip…", description: `${skill.name}.zip` })}>
          Download .zip
        </MenuItem>
      </Menu>

      {/* trust gate */}
      <Modal open={!!gate} onClose={() => setGate(null)} className="max-w-lg">
        <div className="flex shrink-0 items-start gap-3 border-b border-border px-5 py-4">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-warn-soft text-warn">
            <AlertTriangle size={18} />
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-semibold">Install an unreviewed skill?</h2>
            <p className="mt-0.5 text-[13px] text-muted">
              <span className="font-mono">{skill.name}</span> was copied from{" "}
              {skill.source?.owner ? `${skill.source.owner}/${skill.source.repo}` : "a repo"} and hasn't been reviewed. The static scan
              flagged:
            </p>
          </div>
        </div>
        <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-5 py-4 sm:max-h-60">
          {version?.scan.findings.map((f, i) => (
            <div key={i} className="flex items-start gap-2 rounded-lg border border-border bg-danger-soft/50 px-3 py-2 text-[13px]">
              <AlertTriangle size={14} className="mt-0.5 shrink-0 text-danger" />
              <div className="min-w-0 break-words [overflow-wrap:anywhere]">
                <span className="font-mono text-[12px] text-muted">
                  {f.path}:{f.line}
                </span>
                <span className="ml-2 text-foreground">{f.text}</span>
              </div>
            </div>
          ))}
        </div>
        {/* Stacked full-width on phones (primary on top), a right-aligned row from sm up. */}
        <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-border px-5 py-3.5 sm:flex-row sm:justify-end">
          <Button variant="ghost" className="w-full sm:w-auto" onClick={() => setGate(null)}>
            Cancel
          </Button>
          <Button
            variant="outline"
            className="w-full sm:w-auto"
            onClick={() => {
              if (gate) doInstall(gate);
              setGate(null);
            }}
          >
            Install anyway
          </Button>
          <Button
            variant="primary"
            className="w-full sm:w-auto"
            onClick={() => {
              reviewSkill(skill.id);
              if (gate) doInstall(gate);
              setGate(null);
              toast({ message: "Marked reviewed & installed", tone: "ok" });
            }}
          >
            <Check size={15} />
            Mark reviewed & install
          </Button>
        </div>
      </Modal>
    </>
  );
}
