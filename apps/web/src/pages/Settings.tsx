import { useEffect, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
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
  Sparkles,
  Tag as TagIcon,
  Terminal,
  Trash2,
} from "lucide-react";
import { formatBytes, type User } from "@kosh/shared";
import { cn } from "@/lib/cn";
import { useData } from "@/data/store";
import { useUi } from "@/data/ui";
import { allTags } from "@/data/selectors";
import { api, API_BASE, type ApiKeyPublic } from "@/data/api";
import { startConnect } from "@/lib/connect";
import { uid } from "@/lib/ids";
import { ago } from "@/lib/time";
import { EmptyState, PageHeader, SectionCard } from "@/components/common";
import { Collapse } from "@/components/motion";
import { Modal, SelectMenu } from "@/components/overlays";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Avatar, Badge, Button, Input, Skeleton } from "@/components/ui";

// Demo keys for mock mode; real keys are loaded from the API when a backend is wired.
const DEMO_KEYS: ApiKeyPublic[] = [
  { id: "k1", name: "Laptop CLI", prefix: "ksh_a1b2", scopes: ["read", "write"], createdAt: new Date(Date.now() - 21 * 864e5).toISOString() },
  { id: "k2", name: "Bookmarklet", prefix: "ksh_9f8e", scopes: ["write"], createdAt: new Date(Date.now() - 7 * 864e5).toISOString() },
];

// Tag chip rename/delete: hover-revealed on pointers, always visible (and 40px) on touch screens.
const TAG_ACTION =
  "rounded-full text-faint opacity-0 transition-opacity hover:bg-surface-3 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 [@media(pointer:coarse)]:opacity-100";

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
  // `null` = the real list is still in flight (backend mode) — skeleton rows, never the demo keys.
  const [apiKeys, setApiKeys] = useState<ApiKeyPublic[] | null>(backend ? null : DEMO_KEYS);
  const [creatingKey, setCreatingKey] = useState(false);
  // The freshly-created key's plaintext, shown once in a reveal dialog.
  const [newKey, setNewKey] = useState<{ name: string; key: string } | null>(null);

  // GitHub connection (for publishing project folders to new repos).
  const ghConnected = user.github?.connected ?? false;
  const [ghToken, setGhToken] = useState("");
  const [ghConnecting, setGhConnecting] = useState(false);
  // `null` while the config request is in flight so the card's slot is reserved instead of popping in.
  const [ghOauth, setGhOauth] = useState<boolean | null>(backend ? null : false);
  const [showTokenEntry, setShowTokenEntry] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  // Is one-click "Connect GitHub" (OAuth) available?
  useEffect(() => {
    if (!backend) return;
    let live = true;
    api
      .githubConnectConfig()
      .then((c) => { if (live) setGhOauth(c.oauth); })
      .catch(() => { if (live) setGhOauth(false); });
    return () => { live = false; };
  }, [backend]);

  // Handle the OAuth return (?github_connected | ?github_error) once, then strip the params.
  useEffect(() => {
    const okLogin = searchParams.get("github_connected");
    const errCode = searchParams.get("github_error");
    if (!okLogin && !errCode) return;
    const next = new URLSearchParams(searchParams);
    next.delete("github_connected");
    next.delete("github_error");
    setSearchParams(next, { replace: true });
    if (okLogin) {
      void api.me().then((me) => useData.setState({ user: me.user })).catch(() => {});
      toast({ message: `GitHub connected as @${okLogin}`, tone: "ok" });
    } else if (errCode) {
      toast({ message: "GitHub connection failed. Please try again.", tone: "danger" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // In backend mode the server is the source of truth — replace the demo rows with the real ones.
  useEffect(() => {
    if (!backend) return;
    let alive = true;
    api
      .listApiKeys()
      .then(({ apiKeys }) => alive && setApiKeys(apiKeys))
      // On failure fall back to the empty state instead of an unrecoverable loading skeleton
      // (apiKeys starts null in backend mode to show the skeleton until the fetch resolves).
      .catch(() => alive && setApiKeys([]));
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
      setCreatingKey(true);
      api
        .createApiKey({ name })
        .then(({ apiKey, key }) => {
          setApiKeys((k) => [apiKey, ...(k ?? [])]);
          setNewKey({ name, key });
        })
        .catch((err: unknown) => toast({ message: "Couldn't create key", description: err instanceof Error ? err.message : undefined, tone: "danger" }))
        .finally(() => setCreatingKey(false));
      return;
    }
    const { key, prefix } = generateLocalKey();
    const row: ApiKeyPublic = { id: uid("k"), name, prefix, scopes: ["read", "write"], createdAt: new Date().toISOString() };
    setApiKeys((k) => [row, ...(k ?? [])]);
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
        setApiKeys((keys) => (keys ?? []).filter((x) => x.id !== k.id));
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

  // Live endpoints for the "Ways in" snippets — derived from the app's configured API base (VITE_API_URL)
  // so they point at THIS deployment, not a hardcoded host. Falls back to the public host in mock mode.
  const apiBase = API_BASE || "https://api.kosh.app/api";
  const mcpCmd = `claude mcp add --transport http kosh ${apiBase}/mcp -H "Authorization: Bearer ksh_…"`;
  const iphoneCmd = `Shortcuts → new → Receive URLs & Text from Share Sheet → Get Contents of URL: POST ${apiBase}/items, body {"url": Input}, header Authorization: Bearer ksh_…`;
  const bookmarklet = `javascript:(()=>{fetch("${apiBase}/items",{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer ksh_…"},body:JSON.stringify({url:location.href,note:String(getSelection())||undefined,source:"bookmarklet"})}).then(r=>alert(r.ok?"Saved to Kosh":"Kosh: failed "+r.status))})();`;

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
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
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
            <Snippet icon={Blocks} title="MCP (Claude Code)" cmd={mcpCmd} onCopy={copy} />
            <Snippet icon={MessageCircle} title="Telegram bot" cmd="/start to link · send a link, .md/.zip, or text" onCopy={copy} plain />
            <Snippet icon={Bookmark} title="Bookmarklet" cmd={bookmarklet} onCopy={copy} truncate />
            <Snippet icon={Smartphone} title="Android — share sheet" cmd="Install Kosh to your home screen, then Share → Kosh from any app" onCopy={copy} plain />
            <Snippet icon={Share2} title="iPhone Shortcut" cmd={iphoneCmd} onCopy={copy} plain />
            <Snippet icon={Mail} title="Email-in" cmd={`Forward newsletters to inbox+${user.emailToken ?? "<your-token>"}@yourdomain.com — links land in your Inbox`} onCopy={copy} plain />
          </div>
        </SectionCard>

        {/* api keys */}
        <SectionCard
          title="API keys"
          subtitle="Bearer keys for the CLI, MCP, bookmarklet and Shortcuts"
          action={
            <Button variant="outline" size="sm" onClick={promptNewKey} loading={creatingKey}>
              <Plus size={15} /> New key
            </Button>
          }
        >
          <div className="space-y-2">
            {apiKeys === null ? (
              // Matches a real row's height — taller on phones where the meta line wraps (80px) and 58px
              // from `sm` up — so the swap doesn't shift the sections below.
              <div role="status" aria-busy="true" aria-label="Loading API keys" className="space-y-2">
                <Skeleton className="h-20 rounded-[var(--radius-control)] sm:h-[58px]" />
                <Skeleton className="h-20 rounded-[var(--radius-control)] sm:h-[58px]" />
              </div>
            ) : apiKeys.length === 0 ? (
              <EmptyState size="sm" icon={KeyRound} title="No API keys yet" description="Create one to use the CLI, MCP or bookmarklet." />
            ) : (
              apiKeys.map((k) => (
                <div key={k.id} className="flex items-center gap-3 rounded-[var(--radius-control)] border border-border bg-surface-2 px-3 py-2.5">
                  <KeyRound size={16} className="shrink-0 text-muted" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13.5px] font-medium">{k.name}</div>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-faint">
                      <span className="whitespace-nowrap font-mono">{k.prefix}••••••••</span>
                      <span className="whitespace-nowrap">· created {ago(k.createdAt)}</span>
                      {k.lastUsedAt && <span className="whitespace-nowrap">· used {ago(k.lastUsedAt)}</span>}
                    </div>
                  </div>
                  <div className="hidden gap-1 sm:flex">
                    {k.scopes.map((s) => (
                      <Badge key={s} tone="neutral">
                        {s}
                      </Badge>
                    ))}
                  </div>
                  <Button variant="ghost" size="icon" className="text-danger hover:bg-danger-soft" onClick={() => revokeKey(k)} aria-label="Revoke">
                    <Trash2 size={15} />
                  </Button>
                </div>
              ))
            )}
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
            <StatusRow
              icon={
                user.github?.avatarUrl ? (
                  <img src={user.github.avatarUrl} alt="" referrerPolicy="no-referrer" className="h-8 w-8 shrink-0 rounded-full" />
                ) : (
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-ok-soft text-ok"><Check size={16} /></span>
                )
              }
              title={`Connected${user.github?.login ? ` as @${user.github.login}` : ""}`}
              description={
                <>
                  {user.github?.source === "oauth" ? "Connected with GitHub" : "A token with repo access is stored"} (encrypted).
                  {user.github?.scopes?.length ? ` Scopes: ${user.github.scopes.join(", ")}.` : ""}
                </>
              }
              action={
                <Button variant="ghost" size="sm" className="text-danger hover:bg-danger-soft" onClick={disconnectGithub}>
                  Disconnect
                </Button>
              }
            />
          ) : (
            <div className="space-y-3">
              {ghOauth === null && (
                // A StatusRow-shaped placeholder (plus the "Prefer a PAT?" link row it lands with): the row
                // stacks on phones (icon + copy, then a full-width button) so the GitHub card — and the AI
                // card below it — don't grow when /api/github/config resolves.
                <>
                  <div className="flex flex-col gap-3 rounded-[var(--radius-control)] border border-border p-3.5 sm:h-[62px] sm:flex-row sm:items-center">
                    <div className="flex flex-1 items-center gap-3">
                      <Skeleton className="h-9 w-9 shrink-0 rounded-lg" />
                      <div className="flex-1 space-y-2">
                        <Skeleton className="h-3.5 w-40 max-w-full" />
                        <Skeleton className="h-3 w-56 max-w-full" />
                      </div>
                    </div>
                    <Skeleton className="h-10 w-full rounded-[var(--radius-control)] sm:h-9 sm:w-40" />
                  </div>
                  <Skeleton className="h-4 w-56 max-w-full" />
                </>
              )}
              {ghOauth && (
                <StatusRow
                  tone="primary"
                  className="reveal-in"
                  icon={<span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-surface text-foreground shadow-[var(--shadow-sm)]"><Github size={18} /></span>}
                  title="Connect with one click"
                  description="Approve on GitHub and land right back here — nothing to paste."
                  action={
                    <Button variant="primary" onClick={() => { void startConnect("github", "settings"); }}>
                      <Github size={15} /> Connect GitHub
                    </Button>
                  }
                />
              )}
              {ghOauth && !showTokenEntry && (
                <button onClick={() => setShowTokenEntry(true)} className="pressable -my-2 py-2 text-[12.5px] font-medium text-muted underline-offset-2 hover:text-foreground hover:underline">
                  Prefer a Personal Access Token? Paste one instead
                </button>
              )}
              <Collapse open={ghOauth === false || showTokenEntry}>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    type="password"
                    value={ghToken}
                    onChange={(e) => setGhToken(e.target.value)}
                    placeholder="ghp_… or github_pat_…"
                    className="min-w-0 font-mono sm:flex-1 sm:text-[13px]"
                  />
                  <Button variant={ghOauth ? "outline" : "primary"} onClick={connectGithub} loading={ghConnecting} disabled={ghToken.trim().length < 10}>
                    <ShieldCheck size={15} /> Connect token
                  </Button>
                </div>
                <p className="mt-2 text-[12px] text-faint">
                  Create a token at github.com/settings/tokens with the <span className="font-mono">repo</span> scope. Stored encrypted; never shown again.
                </p>
              </Collapse>
            </div>
          )}
        </SectionCard>

        {/* AI provider */}
        <AiProviderCard user={user} backend={backend} />

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
          {/* The inner scroller is desktop-only: on phones a nested 256px scroll area traps finger scrolls. */}
          <div className="flex flex-wrap gap-2 sm:max-h-64 sm:overflow-y-auto">
            {tags.length === 0 && (
              <EmptyState
                size="sm"
                icon={TagIcon}
                title="No tags yet"
                description={
                  <>
                    Tags live on your items — open something in your Library and type in its{" "}
                    <span className="font-medium text-foreground">Tags</span> field. Tags you add there show up here to rename, merge or remove.
                  </>
                }
                action={
                  <Button variant="outline" size="sm" onClick={() => navigate("/library")}>
                    Open Library
                  </Button>
                }
                className="w-full"
              />
            )}
            {tags.map((t) => {
              const isPicked = picked.includes(t.tag);
              if (mergeMode) {
                return (
                  <button
                    key={t.tag}
                    onClick={() => togglePicked(t.tag)}
                    className={cn(
                      "pressable inline-flex h-8 items-center gap-1.5 rounded-full border pl-3 pr-2.5 text-[13px] transition-colors [@media(pointer:coarse)]:h-10",
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
                <div key={t.tag} className="group inline-flex h-8 items-center gap-1 rounded-full border border-border bg-surface-2 pl-3 pr-1 text-[13px] [@media(pointer:coarse)]:h-10">
                  <TagIcon size={12} className="text-faint" />
                  <span>{t.tag}</span>
                  <span className="tabular text-[11px] text-faint">{t.value}</span>
                  <Button
                    variant="ghost"
                    size="icon-sm"
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
                    className={TAG_ACTION}
                    aria-label="Rename tag"
                  >
                    <RefreshCw size={13} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() =>
                      openConfirm({
                        title: `Remove #${t.tag}?`,
                        message: `This removes the tag from ${t.value} item${t.value === 1 ? "" : "s"}. The items themselves are kept.`,
                        confirmLabel: "Remove tag",
                        onConfirm: () => { deleteTag(t.tag); toast({ message: `Removed #${t.tag}`, tone: "warn" }); },
                      })
                    }
                    className={cn(TAG_ACTION, "hover:bg-danger-soft hover:text-danger")}
                    aria-label="Delete tag"
                  >
                    <Trash2 size={13} />
                  </Button>
                </div>
              );
            })}
          </div>

          <Collapse open={mergeMode}>
            <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3 sm:flex-row sm:items-center">
              <span className="text-[12px] text-muted">Merge {picked.length} into</span>
              <Input
                list="kosh-merge-target"
                value={mergeInto}
                onChange={(e) => setMergeInto(e.target.value)}
                placeholder="target tag"
                className="sm:w-36 [&::-webkit-calendar-picker-indicator]:hidden"
              />
              <datalist id="kosh-merge-target">
                {picked.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
              <Button variant="primary" size="sm" className="w-full sm:w-auto" onClick={doMerge} disabled={!mergeInto.trim() || picked.filter((t) => t !== mergeInto.trim().replace(/^#/, "")).length === 0}>
                <GitMerge size={15} /> Merge
              </Button>
            </div>
          </Collapse>
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

/** Pick which model provider runs Kosh's AI features (summaries, auto-tags, NL search, cleanup), override
 *  the model, bring your own key (encrypted at rest), and tune the daily spend cap. Free-tier and local
 *  providers never count toward the cap. The server exposes only booleans for stored keys — never the key. */
function AiProviderCard({ user, backend }: { user: User; backend: boolean }) {
  const toast = useUi((s) => s.toast);
  const providers = user.aiProviders ?? [];
  const selected = user.aiProvider ?? providers[0]?.id ?? "anthropic";
  const current = providers.find((p) => p.id === selected);
  const hasKey = !!user.aiKeys?.[selected];
  // Prefer the server's authoritative availability (same signal it uses to gate calls); fall back to a
  // local derivation only if the field is absent.
  const ready = user.aiAvailable ?? (current ? !current.needsKey || hasKey || current.hasServerKey : false);

  const [model, setModel] = useState(user.aiModel ?? "");
  const [keyDraft, setKeyDraft] = useState("");
  const [cap, setCap] = useState(String(user.aiSpendCap ?? 2));
  // Which control is mid-request — so only that button shows the spinner while all of them lock.
  const [busy, setBusy] = useState<"provider" | "model" | "key" | "clearKey" | "cap" | null>(null);

  // Re-sync local drafts when the server state changes — e.g. switching provider clears the model override.
  useEffect(() => setModel(user.aiModel ?? ""), [user.aiModel, user.aiProvider]);
  useEffect(() => setCap(String(user.aiSpendCap ?? 2)), [user.aiSpendCap]);
  // Never carry a half-typed key across a provider switch — it must not be saved under the wrong provider.
  useEffect(() => setKeyDraft(""), [user.aiProvider]);

  const run = async (what: NonNullable<typeof busy>, fn: () => Promise<{ user: User }>, ok: string): Promise<boolean> => {
    setBusy(what);
    try {
      const { user: next } = await fn();
      useData.setState({ user: next });
      toast({ message: ok, tone: "ok" });
      return true;
    } catch (err) {
      toast({ message: "Couldn't update AI settings", description: err instanceof Error ? err.message : undefined, tone: "danger" });
      return false;
    } finally {
      setBusy(null);
    }
  };

  if (!backend || providers.length === 0) {
    return (
      <SectionCard title="AI provider" subtitle="Choose which model powers Kosh's AI features" className="lg:col-span-2">
        <div className="flex items-center gap-2 rounded-[var(--radius-control)] border border-border bg-surface-2 px-3 py-2.5 text-[13px] text-muted">
          <Sparkles size={16} className="shrink-0" />
          Demo mode — connect the API to pick a provider (Anthropic, Gemini, Groq, OpenRouter and more) and add your own key.
        </div>
      </SectionCard>
    );
  }

  const providerOptions = providers.map((p) => ({
    value: p.id,
    label: (
      <span className="flex items-center gap-2">
        {p.label}
        {p.free && <span className="rounded-full bg-ok-soft px-1.5 py-px text-[11px] font-semibold uppercase tracking-wide text-ok">free</span>}
      </span>
    ),
  }));

  const saveKey = async () => {
    const k = keyDraft.trim();
    if (k.length < 8) return;
    if (await run("key", () => api.setAiKey(selected, k), "Key saved")) setKeyDraft("");
  };
  const saveCap = () => {
    const n = Number(cap);
    // Blank / non-numeric / negative must not silently become $0 (which would disable all paid AI) —
    // revert the field and tell the user instead.
    if (cap.trim() === "" || !Number.isFinite(n) || n < 0) {
      setCap(String(user.aiSpendCap ?? 2));
      toast({ message: "Enter a daily cap of $0 or more", tone: "danger" });
      return;
    }
    void run("cap", () => api.updateAiSettings({ spendCap: n }), "Spend cap updated");
  };

  return (
    <SectionCard
      title="AI provider"
      subtitle="Summaries, auto-tags, NL search & cleanup"
      className="lg:col-span-2"
      action={<Badge tone={ready ? "ok" : "warn"}>{ready ? "Ready" : "Needs a key"}</Badge>}
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* provider + status */}
        <div className="space-y-2">
          <span className="block text-[12.5px] font-medium text-muted">Provider</span>
          <SelectMenu
            value={selected}
            options={providerOptions}
            onChange={(id) => void run("provider", () => api.updateAiSettings({ provider: id }), "AI provider updated")}
            width={300}
            disabled={!!busy}
            ariaLabel="AI provider"
            className="w-full"
          />
          {current && (
            <p className="text-[12px] leading-snug text-faint">
              {current.free ? "Has a free tier — usage doesn't count toward your daily spend cap. " : ""}
              {current.needsKey ? <>Get a key at <span className="font-mono">{current.hint}</span>.</> : current.hint}
              {current.hasServerKey && !hasKey && current.needsKey ? " A server key is configured as a fallback." : ""}
            </p>
          )}
        </div>

        {/* model override */}
        <div className="space-y-2">
          <span className="block text-[12.5px] font-medium text-muted">
            Model <span className="font-normal text-faint">(optional override)</span>
          </span>
          <div className="flex gap-2">
            <Input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder={current?.defaultModel ?? "provider default"}
              disabled={!!busy}
              className="min-w-0 flex-1 font-mono sm:text-[13px]"
            />
            <Button
              variant="outline"
              onClick={() => void run("model", () => api.updateAiSettings({ model: model.trim() }), "Model saved")}
              loading={busy === "model"}
              disabled={!!busy || model.trim() === (user.aiModel ?? "")}
            >
              Save
            </Button>
          </div>
          {current && (
            <p className="text-[12px] text-faint">
              Leave blank to use <span className="font-mono">{current.defaultModel}</span>.
            </p>
          )}
        </div>
      </div>

      {/* BYOK key */}
      {current?.needsKey && (
        <div className="mt-4 border-t border-border pt-4">
          <span className="mb-1.5 block text-[12.5px] font-medium text-muted">Your API key</span>
          {hasKey ? (
            <StatusRow
              icon={<span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-ok-soft text-ok"><Check size={16} /></span>}
              title="Your key is saved"
              description="Stored encrypted; never shown again. Used instead of any server key."
              action={
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-danger hover:bg-danger-soft"
                  onClick={() => void run("clearKey", () => api.clearAiKey(selected), "Key removed")}
                  loading={busy === "clearKey"}
                  disabled={!!busy}
                >
                  <Trash2 size={15} /> Remove
                </Button>
              }
            />
          ) : (
            // `flex-1` only in the row layout: inside the phone column it would zero the flex-basis and
            // collapse the field to its line box.
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                type="password"
                value={keyDraft}
                onChange={(e) => setKeyDraft(e.target.value)}
                placeholder="Paste your API key"
                className="min-w-0 font-mono sm:flex-1 sm:text-[13px]"
                disabled={!!busy}
              />
              <Button variant="primary" onClick={saveKey} loading={busy === "key"} disabled={!!busy || keyDraft.trim().length < 8}>
                <ShieldCheck size={15} /> Save key
              </Button>
            </div>
          )}
        </div>
      )}

      {/* daily spend cap */}
      <div className="mt-4 flex flex-wrap items-end gap-x-3 gap-y-2 border-t border-border pt-4">
        <div className="space-y-1.5">
          <span className="block text-[12.5px] font-medium text-muted">Daily spend cap (USD)</span>
          <div className="flex gap-2">
            <Input type="number" min={0} max={100} step={0.5} value={cap} onChange={(e) => setCap(e.target.value)} className="w-28 tabular" disabled={!!busy} />
            <Button variant="outline" onClick={saveCap} loading={busy === "cap"} disabled={!!busy || cap === String(user.aiSpendCap ?? 2)}>
              Save
            </Button>
          </div>
        </div>
        <p className="pb-2 text-[12px] text-faint">Paid providers stop once you hit this each day. Free tiers and local models never count.</p>
      </div>
    </SectionCard>
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
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <div className="flex items-center gap-2 rounded-[var(--radius-control)] border border-border bg-surface-2 py-1.5 pl-3 pr-1.5">
              <code className="min-w-0 flex-1 break-all font-mono text-[12.5px] text-foreground">{newKey.key}</code>
              <Button variant="ghost" size="icon-sm" className="shrink-0" onClick={() => onCopy(newKey.key, "API key copied")} aria-label="Copy key">
                <Copy size={15} />
              </Button>
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

/** Icon + title/description + one action. Stacks on phones so the copy never squeezes into a narrow
 *  column beside the button; one row from `sm` up. */
function StatusRow({ icon, title, description, action, tone, className }: { icon: ReactNode; title: string; description: ReactNode; action: ReactNode; tone?: "primary"; className?: string }) {
  const primary = tone === "primary";
  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-[var(--radius-control)] border sm:flex-row sm:items-center",
        primary ? "border-primary/30 bg-primary-soft/40 px-3.5 py-3" : "border-border bg-surface-2 px-3 py-2.5",
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {icon}
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] font-medium">{title}</div>
          <div className={cn("text-[12px]", primary ? "text-muted" : "text-faint")}>{description}</div>
        </div>
      </div>
      <div className="flex shrink-0 [&>*]:w-full sm:[&>*]:w-auto">{action}</div>
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
        {/* Commands wrap at any character only when a token (a URL) is longer than the line, so ordinary words
            stay whole; the one-line bookmarklet scrolls sideways inside its card instead of being clipped. */}
        <code
          className={cn(
            "min-w-0 flex-1 font-mono text-[12px] text-muted",
            truncate
              ? "overflow-x-auto whitespace-nowrap py-1 [scrollbar-width:thin] [mask-image:linear-gradient(90deg,black_calc(100%-28px),transparent)]"
              : plain ? "" : "whitespace-pre-wrap [overflow-wrap:anywhere]",
          )}
        >
          {cmd}
        </code>
        {!plain && (
          <Button variant="ghost" size="icon-sm" className="-my-1 shrink-0" onClick={() => onCopy(cmd)} aria-label="Copy">
            <Copy size={14} />
          </Button>
        )}
      </div>
    </div>
  );
}
