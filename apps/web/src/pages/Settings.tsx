import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Blocks,
  Bookmark,
  Check,
  Copy,
  Download,
  Github,
  GitMerge,
  KeyRound,
  Mail,
  MessageCircle,
  Plus,
  RefreshCw,
  Settings as SettingsIcon,
  Share2,
  ShieldCheck,
  Smartphone,
  Tag as TagIcon,
  Terminal,
  Trash2,
} from "lucide-react";
import { formatBytes } from "@kosh/shared";
import { cn } from "@/lib/cn";
import { useData } from "@/data/store";
import { useUi } from "@/data/ui";
import { allTags } from "@/data/selectors";
import { api, type ApiKeyPublic } from "@/data/api";
import { uid } from "@/lib/ids";
import { ago } from "@/lib/time";
import { PageHeader, SectionCard } from "@/components/common";
import { Modal } from "@/components/overlays";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Avatar, Badge, Button } from "@/components/ui";

/** Generate a proper random API key locally (mock mode) — same shape the server issues:
 *  "ksh_" + base64url of 24 random bytes. The full key is shown once; only its prefix is kept. */
function generateLocalKey(): { key: string; prefix: string } {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  const raw = btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const key = `ksh_${raw}`;
  return { key, prefix: key.slice(0, 8) };
}

export function Settings() {
  const user = useData((s) => s.user);
  const items = useData((s) => s.items);
  const backend = useData((s) => s.backend);
  const renameTag = useData((s) => s.renameTag);
  const deleteTag = useData((s) => s.deleteTag);
  const mergeTags = useData((s) => s.mergeTags);
  const resetVault = useData((s) => s.resetVault);
  const toast = useUi((s) => s.toast);
  const openConfirm = useUi((s) => s.openConfirm);
  const navigate = useNavigate();

  const tags = allTags(items);
  const [mergeMode, setMergeMode] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [mergeInto, setMergeInto] = useState("");

  const togglePicked = (tag: string) =>
    setPicked((p) => (p.includes(tag) ? p.filter((t) => t !== tag) : [...p, tag]));
  const exitMerge = () => {
    setMergeMode(false);
    setPicked([]);
    setMergeInto("");
  };
  const doMerge = () => {
    const to = mergeInto.trim().replace(/^#/, "");
    const from = picked.filter((t) => t !== to);
    if (!to || from.length === 0) return;
    mergeTags(from, to);
    toast({ message: `Merged ${from.length} tag${from.length === 1 ? "" : "s"} into #${to}`, tone: "ok" });
    exitMerge();
  };
  // Demo keys for mock mode; real keys are loaded from the API when a backend is wired.
  const demoNow = Date.now();
  const [apiKeys, setApiKeys] = useState<ApiKeyPublic[]>([
    { id: "k1", name: "Laptop CLI", prefix: "ksh_a1b2", scopes: ["read", "write"], createdAt: new Date(demoNow - 21 * 864e5).toISOString() },
    { id: "k2", name: "Bookmarklet", prefix: "ksh_9f8e", scopes: ["write"], createdAt: new Date(demoNow - 7 * 864e5).toISOString() },
  ]);
  // The freshly-created key's plaintext, shown once in a reveal dialog.
  const [newKey, setNewKey] = useState<{ name: string; key: string } | null>(null);

  // GitHub connection (for publishing project folders to new repos).
  const ghConnected = user.github?.connected ?? false;
  const [ghToken, setGhToken] = useState("");
  const [ghConnecting, setGhConnecting] = useState(false);

  // In backend mode the server is the source of truth — replace the demo rows with the real ones.
  useEffect(() => {
    if (!backend) return;
    let alive = true;
    api
      .listApiKeys()
      .then(({ apiKeys }) => alive && setApiKeys(apiKeys))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [backend]);

  const copy = (text: string, label = "Copied") => {
    navigator.clipboard?.writeText(text).catch(() => {});
    toast({ message: label, tone: "ok" });
  };

  // Generate a proper key — via the API when connected (hashed server-side, plaintext returned once),
  // or locally in mock mode. Either way the full key is revealed exactly once.
  const createKey = (rawName: string) => {
    const name = rawName.trim() || "New key";
    if (backend) {
      api
        .createApiKey({ name })
        .then(({ apiKey, key }) => {
          setApiKeys((k) => [apiKey, ...k]);
          setNewKey({ name, key });
        })
        .catch((err: unknown) => toast({ message: "Couldn't create key", description: err instanceof Error ? err.message : undefined, tone: "danger" }));
      return;
    }
    const { key, prefix } = generateLocalKey();
    const row: ApiKeyPublic = { id: uid("k"), name, prefix, scopes: ["read", "write"], createdAt: new Date().toISOString() };
    setApiKeys((k) => [row, ...k]);
    setNewKey({ name, key });
  };

  const promptNewKey = () =>
    openConfirm({
      title: "Create API key",
      message: "Give this key a name so you can recognize it later. The full key is shown only once.",
      confirmLabel: "Create key",
      tone: "primary",
      input: { label: "Key name", placeholder: "Laptop CLI", defaultValue: "" },
      onConfirm: createKey,
    });

  const revokeKey = (k: ApiKeyPublic) =>
    openConfirm({
      title: "Revoke this key?",
      message: `"${k.name}" (${k.prefix}…) will stop working immediately. Any client using it must be updated.`,
      confirmLabel: "Revoke key",
      onConfirm: () => {
        setApiKeys((keys) => keys.filter((x) => x.id !== k.id));
        if (backend) api.revokeApiKey(k.id).catch(() => {});
        toast({ message: "API key revoked", tone: "warn" });
      },
    });

  const connectGithub = async () => {
    if (ghToken.trim().length < 10) return;
    setGhConnecting(true);
    try {
      const res = await api.setGithubToken(ghToken.trim());
      const me = await api.me();
      useData.setState({ user: me.user });
      setGhToken("");
      toast({ message: `GitHub connected as @${res.login}`, tone: "ok" });
    } catch (err) {
      toast({ message: "Couldn't connect GitHub", description: err instanceof Error ? err.message : undefined, tone: "danger" });
    } finally {
      setGhConnecting(false);
    }
  };

  const disconnectGithub = () =>
    openConfirm({
      title: "Disconnect GitHub?",
      message: "Kosh will forget your GitHub token. You can reconnect any time to publish again.",
      confirmLabel: "Disconnect",
      onConfirm: async () => {
        try {
          await api.clearGithubToken();
          const me = await api.me();
          useData.setState({ user: me.user });
          toast({ message: "GitHub disconnected", tone: "warn" });
        } catch {
          /* ignore */
        }
      },
    });

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
            <Snippet icon={Smartphone} title="Android — share sheet" cmd="Install Kosh to your home screen, then Share → Kosh from any app" onCopy={copy} plain />
            <Snippet
              icon={Share2}
              title="iPhone Shortcut"
              cmd='Shortcuts → new → Receive URLs & Text from Share Sheet → Get Contents of URL: POST {API}/items, body {"url": Input}, header Authorization: Bearer ksh_…'
              onCopy={copy}
              plain
            />
            <Snippet icon={Mail} title="Email-in" cmd={`Forward newsletters to inbox+${user.emailToken ?? "<your-token>"}@yourdomain.com — links land in your Inbox`} onCopy={copy} plain />
          </div>
        </SectionCard>

        {/* api keys */}
        <SectionCard
          title="API keys"
          subtitle="Bearer keys for the CLI, MCP, bookmarklet and Shortcuts"
          action={
            <Button variant="outline" size="sm" onClick={promptNewKey}>
              <Plus size={15} /> New key
            </Button>
          }
        >
          <div className="space-y-2">
            {apiKeys.length === 0 && (
              <p className="rounded-[var(--radius-control)] border border-dashed border-border px-3 py-4 text-center text-[13px] text-muted">
                No API keys yet. Create one to use the CLI, MCP or bookmarklet.
              </p>
            )}
            {apiKeys.map((k) => (
              <div key={k.id} className="flex items-center gap-3 rounded-[var(--radius-control)] border border-border bg-surface-2 px-3 py-2.5">
                <KeyRound size={16} className="shrink-0 text-muted" />
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-medium">{k.name}</div>
                  <div className="font-mono text-[12px] text-faint">
                    {k.prefix}••••••••
                    <span className="ml-2 font-sans">· created {ago(k.createdAt)}</span>
                    {k.lastUsedAt && <span className="ml-1.5 font-sans">· used {ago(k.lastUsedAt)}</span>}
                  </div>
                </div>
                <div className="hidden gap-1 sm:flex">
                  {k.scopes.map((s) => (
                    <Badge key={s} tone="neutral">
                      {s}
                    </Badge>
                  ))}
                </div>
                <Button variant="ghost" size="icon-sm" className="text-danger hover:bg-danger-soft" onClick={() => revokeKey(k)} aria-label="Revoke">
                  <Trash2 size={15} />
                </Button>
              </div>
            ))}
          </div>
        </SectionCard>

        {/* github connection */}
        <SectionCard
          title="GitHub connection"
          subtitle="Publish project folders to new GitHub repos"
          className="lg:col-span-2"
          action={
            <Button variant="outline" size="sm" onClick={() => navigate("/publish")}>
              <Github size={15} /> Publish a project
            </Button>
          }
        >
          {!backend ? (
            <div className="flex items-center gap-2 rounded-[var(--radius-control)] border border-border bg-surface-2 px-3 py-2.5 text-[13px] text-muted">
              <Github size={16} className="shrink-0" />
              Demo mode — publishing is simulated. Connect the API to push to real GitHub.
            </div>
          ) : ghConnected ? (
            <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius-control)] border border-border bg-surface-2 px-3 py-2.5">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-ok-soft text-ok">
                <Check size={16} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] font-medium">Connected</div>
                <div className="text-[12px] text-faint">A token with repo access is stored (encrypted).</div>
              </div>
              <Button variant="ghost" size="sm" className="text-danger hover:bg-danger-soft" onClick={disconnectGithub}>
                Disconnect
              </Button>
            </div>
          ) : (
            <div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  type="password"
                  value={ghToken}
                  onChange={(e) => setGhToken(e.target.value)}
                  placeholder="ghp_… or github_pat_…"
                  className="min-w-0 flex-1 rounded-[var(--radius-control)] border border-border bg-surface px-3 py-2 font-mono text-[13px] outline-none focus:border-primary focus:ring-focus"
                />
                <Button variant="primary" onClick={connectGithub} disabled={ghConnecting || ghToken.trim().length < 10}>
                  {ghConnecting ? <RefreshCw size={15} className="animate-spin" /> : <Github size={15} />} Connect
                </Button>
              </div>
              <p className="mt-2 text-[12px] text-faint">
                Create a token at github.com/settings/tokens with the <span className="font-mono">repo</span> scope. Stored encrypted; never shown again.
              </p>
            </div>
          )}
        </SectionCard>

        {/* tags */}
        <SectionCard
          title="Tag maintenance"
          subtitle={mergeMode ? "Select tags to merge, then pick a target" : `${tags.length} tags`}
          action={
            tags.length > 1 ? (
              <Button variant={mergeMode ? "ghost" : "outline"} size="sm" onClick={() => (mergeMode ? exitMerge() : setMergeMode(true))}>
                {mergeMode ? "Cancel" : <><GitMerge size={15} /> Merge</>}
              </Button>
            ) : undefined
          }
        >
          <div className="flex max-h-64 flex-wrap gap-2 overflow-y-auto">
            {tags.map((t) => {
              const isPicked = picked.includes(t.tag);
              if (mergeMode) {
                return (
                  <button
                    key={t.tag}
                    onClick={() => togglePicked(t.tag)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border py-1 pl-3 pr-2.5 text-[13px] transition-colors",
                      isPicked ? "border-primary bg-primary-soft text-primary" : "border-border bg-surface-2 text-foreground hover:bg-surface-3",
                    )}
                    aria-pressed={isPicked}
                  >
                    {isPicked ? <Check size={12} /> : <TagIcon size={12} className="text-faint" />}
                    <span>{t.tag}</span>
                    <span className="tabular text-[11px] opacity-70">{t.value}</span>
                  </button>
                );
              }
              return (
                <div key={t.tag} className="group inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 py-1 pl-3 pr-1.5 text-[13px]">
                  <TagIcon size={12} className="text-faint" />
                  <span>{t.tag}</span>
                  <span className="tabular text-[11px] text-faint">{t.value}</span>
                  <button
                    onClick={() =>
                      openConfirm({
                        title: `Rename #${t.tag}`,
                        confirmLabel: "Rename",
                        tone: "primary",
                        input: { label: "New tag name", placeholder: t.tag, defaultValue: t.tag },
                        onConfirm: (value) => {
                          const to = value.trim().replace(/^#/, "");
                          if (to && to !== t.tag) {
                            renameTag(t.tag, to);
                            toast({ message: `Renamed to #${to}`, tone: "ok" });
                          }
                        },
                      })
                    }
                    className="rounded-full p-0.5 text-faint opacity-0 transition-opacity hover:bg-surface-3 hover:text-foreground group-hover:opacity-100"
                    aria-label="Rename tag"
                  >
                    <RefreshCw size={12} />
                  </button>
                  <button
                    onClick={() =>
                      openConfirm({
                        title: `Remove #${t.tag}?`,
                        message: `This removes the tag from ${t.value} item${t.value === 1 ? "" : "s"}. The items themselves are kept.`,
                        confirmLabel: "Remove tag",
                        onConfirm: () => { deleteTag(t.tag); toast({ message: `Removed #${t.tag}`, tone: "warn" }); },
                      })
                    }
                    className="rounded-full p-0.5 text-faint opacity-0 transition-opacity hover:bg-danger-soft hover:text-danger group-hover:opacity-100"
                    aria-label="Delete tag"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              );
            })}
          </div>

          {mergeMode && (
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
              <span className="text-[12px] text-muted">Merge {picked.length} into</span>
              <input
                list="kosh-merge-target"
                value={mergeInto}
                onChange={(e) => setMergeInto(e.target.value)}
                placeholder="target tag"
                className="w-36 rounded-[var(--radius-control)] border border-border bg-surface px-2.5 py-1.5 text-[13px] outline-none focus:border-primary focus:ring-focus"
              />
              <datalist id="kosh-merge-target">
                {picked.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
              <Button variant="primary" size="sm" onClick={doMerge} disabled={!mergeInto.trim() || picked.filter((t) => t !== mergeInto.trim().replace(/^#/, "")).length === 0}>
                <GitMerge size={15} /> Merge
              </Button>
            </div>
          )}
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
              onClick={() =>
                openConfirm({
                  title: "Reset demo data?",
                  message: "This replaces your current vault with the original demo content. Any changes you've made will be lost.",
                  confirmLabel: "Reset vault",
                  onConfirm: () => { resetVault(); toast({ message: "Vault reset to demo data", tone: "ok" }); },
                })
              }
            >
              <RefreshCw size={15} /> Reset demo data
            </Button>
          </div>
          <p className="mt-3 text-[12px] text-faint">
            In production: MongoDB Atlas backups, Cloudflare R2 object versioning, and a nightly export of your skills to a private GitHub repo.
          </p>
        </SectionCard>
      </div>

      <NewKeyModal newKey={newKey} onClose={() => setNewKey(null)} onCopy={copy} />
    </div>
  );
}

/** Reveal dialog shown once after creating a key — the plaintext is never retrievable again. */
function NewKeyModal({ newKey, onClose, onCopy }: { newKey: { name: string; key: string } | null; onClose: () => void; onCopy: (text: string, label?: string) => void }) {
  return (
    <Modal open={!!newKey} onClose={onClose} className="max-w-md" labelledBy="newkey-title">
      {newKey && (
        <>
          <div className="flex items-start gap-3 border-b border-border px-5 py-4">
            <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ok-soft text-ok">
              <ShieldCheck size={18} />
            </span>
            <div className="min-w-0">
              <h2 id="newkey-title" className="text-base font-semibold">API key created</h2>
              <p className="mt-0.5 text-[13px] leading-snug text-muted">
                Copy “{newKey.name}” now — for your security it won’t be shown again.
              </p>
            </div>
          </div>
          <div className="px-5 py-4">
            <div className="flex items-center gap-2 rounded-[var(--radius-control)] border border-border bg-surface-2 px-3 py-2.5">
              <code className="min-w-0 flex-1 break-all font-mono text-[12.5px] text-foreground">{newKey.key}</code>
              <button
                onClick={() => onCopy(newKey.key, "API key copied")}
                className="shrink-0 rounded-md p-1.5 text-faint hover:bg-surface-3 hover:text-foreground"
                aria-label="Copy key"
              >
                <Copy size={15} />
              </button>
            </div>
          </div>
          <div className="flex justify-end gap-2 border-t border-border px-5 py-3.5">
            <Button variant="outline" onClick={() => onCopy(newKey.key, "API key copied")}>
              <Copy size={15} /> Copy key
            </Button>
            <Button variant="primary" onClick={onClose}>
              Done
            </Button>
          </div>
        </>
      )}
    </Modal>
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
