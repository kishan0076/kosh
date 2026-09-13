import { useState } from "react";
import {
  Blocks,
  Bookmark,
  Copy,
  Download,
  KeyRound,
  MessageCircle,
  Plus,
  RefreshCw,
  Settings as SettingsIcon,
  Tag as TagIcon,
  Terminal,
  Trash2,
} from "lucide-react";
import { formatBytes } from "@kosh/shared";
import { useData } from "@/data/store";
import { useUi } from "@/data/ui";
import { allTags } from "@/data/selectors";
import { uid } from "@/lib/ids";
import { PageHeader, SectionCard } from "@/components/common";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Avatar, Badge, Button } from "@/components/ui";

export function Settings() {
  const user = useData((s) => s.user);
  const items = useData((s) => s.items);
  const renameTag = useData((s) => s.renameTag);
  const deleteTag = useData((s) => s.deleteTag);
  const resetVault = useData((s) => s.resetVault);
  const toast = useUi((s) => s.toast);

  const tags = allTags(items);
  const [apiKeys, setApiKeys] = useState([
    { id: "k1", name: "Laptop CLI", prefix: "ksh_a1b2", scopes: ["read", "write"], created: "3 weeks ago" },
    { id: "k2", name: "Bookmarklet", prefix: "ksh_9f8e", scopes: ["write"], created: "1 week ago" },
  ]);

  const copy = (text: string, label = "Copied") => {
    navigator.clipboard?.writeText(text).catch(() => {});
    toast({ message: label, tone: "ok" });
  };

  const bookmarklet = `javascript:(()=>{fetch("https://api.kosh.app/api/items",{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer ksh_xxx"},body:JSON.stringify({url:location.href,note:String(getSelection())||undefined,source:"bookmarklet"})}).then(r=>alert(r.ok?"Saved to Kosh":"Kosh: failed "+r.status))})();`;

  return (
    <div>
      <PageHeader title="Settings" subtitle="Profile, appearance, integrations and data" icon={SettingsIcon} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* profile */}
        <SectionCard title="Profile">
          <div className="flex items-center gap-3">
            <Avatar name={user.name} src={user.avatarUrl} size={48} />
            <div>
              <div className="text-[15px] font-semibold">{user.name}</div>
              <div className="text-[13px] text-muted">@{user.login} · signed in with GitHub</div>
            </div>
          </div>
        </SectionCard>

        {/* appearance */}
        <SectionCard title="Appearance">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[14px] font-medium">Theme</div>
              <div className="text-[12.5px] text-muted">Light, dark, or follow your system</div>
            </div>
            <ThemeToggle />
          </div>
        </SectionCard>

        {/* storage + budget */}
        <SectionCard title="Storage & budget" className="lg:col-span-2">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Meter label="Storage" used={formatBytes(user.storageUsed)} total={formatBytes(user.storageQuota)} pct={(user.storageUsed / user.storageQuota) * 100} tone="var(--primary)" />
            <Meter label="GitHub budget" used={`${user.githubBudget.remaining.toLocaleString()} left`} total={`${user.githubBudget.total.toLocaleString()}/h`} pct={(user.githubBudget.remaining / user.githubBudget.total) * 100} tone="var(--ok)" />
            <Meter label="AI spend today" used={`$${user.aiSpendToday.toFixed(2)}`} total={`$${user.aiSpendCap.toFixed(2)} cap`} pct={(user.aiSpendToday / user.aiSpendCap) * 100} tone="var(--gold)" />
          </div>
        </SectionCard>

        {/* ways in */}
        <SectionCard title="Ways in" subtitle="Every entry point saves to the same vault" className="lg:col-span-2">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Snippet icon={Terminal} title="CLI" cmd="npx kosh add pdf-tools" onCopy={copy} />
            <Snippet icon={Blocks} title="MCP (Claude Code)" cmd='claude mcp add --transport http kosh https://api.kosh.app/mcp -H "Authorization: Bearer ksh_xxx"' onCopy={copy} />
            <Snippet icon={MessageCircle} title="Telegram bot" cmd="/start to link · send a link, .md/.zip, or text" onCopy={copy} plain />
            <Snippet icon={Bookmark} title="Bookmarklet" cmd={bookmarklet} onCopy={copy} truncate />
          </div>
        </SectionCard>

        {/* api keys */}
        <SectionCard
          title="API keys"
          subtitle="Bearer keys for the CLI, MCP, bookmarklet and Shortcuts"
          action={
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setApiKeys((k) => [...k, { id: uid("k"), name: "New key", prefix: `ksh_${Math.random().toString(36).slice(2, 6)}`, scopes: ["read", "write"], created: "just now" }]);
                toast({ message: "API key created", description: "Copy it now — it won't be shown again", tone: "ok" });
              }}
            >
              <Plus size={15} /> New key
            </Button>
          }
        >
          <div className="space-y-2">
            {apiKeys.map((k) => (
              <div key={k.id} className="flex items-center gap-3 rounded-[var(--radius-control)] border border-border bg-surface-2 px-3 py-2.5">
                <KeyRound size={16} className="shrink-0 text-muted" />
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-medium">{k.name}</div>
                  <div className="font-mono text-[12px] text-faint">{k.prefix}••••••••</div>
                </div>
                <div className="flex gap-1">
                  {k.scopes.map((s) => (
                    <Badge key={s} tone="neutral">
                      {s}
                    </Badge>
                  ))}
                </div>
                <Button variant="ghost" size="icon-sm" className="text-danger hover:bg-danger-soft" onClick={() => setApiKeys((keys) => keys.filter((x) => x.id !== k.id))} aria-label="Revoke">
                  <Trash2 size={15} />
                </Button>
              </div>
            ))}
          </div>
        </SectionCard>

        {/* tags */}
        <SectionCard title="Tag maintenance" subtitle={`${tags.length} tags`}>
          <div className="flex max-h-64 flex-wrap gap-2 overflow-y-auto">
            {tags.map((t) => (
              <div key={t.tag} className="group inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 py-1 pl-3 pr-1.5 text-[13px]">
                <TagIcon size={12} className="text-faint" />
                <span>{t.tag}</span>
                <span className="tabular text-[11px] text-faint">{t.value}</span>
                <button
                  onClick={() => {
                    const to = window.prompt(`Rename #${t.tag} to:`, t.tag);
                    if (to && to !== t.tag) {
                      renameTag(t.tag, to);
                      toast({ message: `Renamed to #${to}`, tone: "ok" });
                    }
                  }}
                  className="rounded-full p-0.5 text-faint opacity-0 transition-opacity hover:bg-surface-3 hover:text-foreground group-hover:opacity-100"
                  aria-label="Rename tag"
                >
                  <RefreshCw size={12} />
                </button>
                <button
                  onClick={() => { deleteTag(t.tag); toast({ message: `Removed #${t.tag}`, tone: "warn" }); }}
                  className="rounded-full p-0.5 text-faint opacity-0 transition-opacity hover:bg-danger-soft hover:text-danger group-hover:opacity-100"
                  aria-label="Delete tag"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        </SectionCard>

        {/* data */}
        <SectionCard title="Data & backups" className="lg:col-span-2">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => copy(JSON.stringify(items, null, 2), "Vault exported to clipboard")}>
              <Download size={15} /> Export JSON
            </Button>
            <Button variant="outline" onClick={() => toast({ message: "Building zip…", description: "All items + skill files" })}>
              <Download size={15} /> Export .zip
            </Button>
            <Button
              variant="ghost"
              className="text-danger hover:bg-danger-soft"
              onClick={() => {
                resetVault();
                toast({ message: "Vault reset to demo data", tone: "ok" });
              }}
            >
              <RefreshCw size={15} /> Reset demo data
            </Button>
          </div>
          <p className="mt-3 text-[12px] text-faint">
            In production: MongoDB Atlas backups, Cloudflare R2 object versioning, and a nightly export of your skills to a private GitHub repo.
          </p>
        </SectionCard>
      </div>
    </div>
  );
}

function Meter({ label, used, total, pct, tone }: { label: string; used: string; total: string; pct: number; tone: string }) {
  return (
    <div className="rounded-[var(--radius-control)] border border-border bg-surface-2 p-3.5">
      <div className="mb-2 flex items-center justify-between text-[12px]">
        <span className="font-medium text-muted">{label}</span>
        <span className="tabular text-faint">{total}</span>
      </div>
      <div className="mb-1.5 font-display text-lg font-semibold">{used}</div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
        <div className="h-full rounded-full" style={{ width: `${Math.min(100, pct)}%`, backgroundColor: tone }} />
      </div>
    </div>
  );
}

function Snippet({ icon: Icon, title, cmd, onCopy, plain, truncate }: { icon: typeof Terminal; title: string; cmd: string; onCopy: (t: string) => void; plain?: boolean; truncate?: boolean }) {
  return (
    <div className="rounded-[var(--radius-control)] border border-border bg-surface-2 p-3">
      <div className="mb-2 flex items-center gap-2 text-[13px] font-medium">
        <Icon size={15} className="text-muted" />
        {title}
      </div>
      <div className="flex items-center gap-2">
        <code className={`min-w-0 flex-1 font-mono text-[12px] text-muted ${truncate ? "truncate" : plain ? "" : "break-all"}`}>{cmd}</code>
        {!plain && (
          <button onClick={() => onCopy(cmd)} className="shrink-0 rounded-md p-1.5 text-faint hover:bg-surface-3 hover:text-foreground" aria-label="Copy">
            <Copy size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
