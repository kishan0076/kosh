import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Copy,
  Download,
  Eye,
  EyeOff,
  FileText,
  FolderLock,
  KeyRound,
  Lock,
  LockKeyhole,
  Paperclip,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { formatBytes } from "@kosh/shared";
import { ago } from "@/lib/time";
import { revealClass, revealStyle } from "@/lib/motion";
import { useData } from "@/data/store";
import { useUi } from "@/data/ui";
import { useVault, type VaultEntry, type VaultEntryType } from "@/data/vault";
import { passwordStrength } from "@/lib/vaultCrypto";
import { EmptyState, PageHeader } from "@/components/common";
import { Modal, SelectMenu } from "@/components/overlays";
import { PageSkeleton } from "@/components/PageSkeleton";
import { Button, Input, Textarea } from "@/components/ui";

const TYPE_ICON: Record<VaultEntryType, typeof FileText> = { note: FileText, secret: KeyRound, file: Paperclip };

export function Vault() {
  const user = useData((s) => s.user);
  const backend = useData((s) => s.backend);
  const status = useVault((s) => s.status);
  const init = useVault((s) => s.init);
  const lock = useVault((s) => s.lock);
  const touch = useVault((s) => s.touch);

  const isAdmin = !!user.isAdmin;

  useEffect(() => {
    if (backend && isAdmin) void init();
  }, [backend, isAdmin, init]);

  // Lock on unmount / tab hidden so secrets never linger.
  useEffect(() => {
    const onHide = () => document.visibilityState === "hidden" && lock();
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      lock();
    };
  }, [lock]);

  if (!backend) {
    return (
      <Gate icon={FolderLock} title="Secure Vault needs the API">
        The vault stores encrypted data on the server, so it needs the Kosh API running. Start it with{" "}
        <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[12px]">npm run api</code>.
      </Gate>
    );
  }
  if (!isAdmin) {
    return (
      <Gate icon={Lock} title="Admin only">
        The Secure Vault is restricted to the admin account. Ask the owner to add your login to{" "}
        <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[12px]">KOSH_ADMIN_LOGIN</code>.
      </Gate>
    );
  }

  return (
    <div onClickCapture={touch} onKeyDownCapture={touch}>
      {status === "loading" && <PageSkeleton variant="vault" />}
      {status === "error" && (
        <Gate
          icon={AlertTriangle}
          title="Couldn't open the vault"
          action={
            <Button variant="outline" size="sm" onClick={() => void init()}>
              Try again
            </Button>
          }
        >
          Something went wrong reaching the vault API.
        </Gate>
      )}
      {status === "first-run" && <CreateScreen />}
      {status === "locked" && <UnlockScreen />}
      {status === "unlocked" && <Dashboard />}
    </div>
  );
}

/* ── gates & screens ─────────────────────────────────────────── */

function Gate({ icon: Icon, title, action, children }: { icon: typeof Lock; title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="mx-auto mt-16 max-w-md text-center">
      <span className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-primary-soft text-primary">
        <Icon size={26} />
      </span>
      <h1 className="text-lg font-semibold">{title}</h1>
      <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted">{children}</p>
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

function VaultHeader({ subtitle }: { subtitle: string }) {
  return (
    <div className="mb-4 flex flex-col items-center text-center sm:mb-6">
      {/* On a short (keyboard-open) viewport the 56px badge is dropped so the field + CTA stay above the fold. */}
      <span className="mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-primary-soft text-primary [@media(max-height:560px)]:hidden">
        <FolderLock size={26} />
      </span>
      <h1 className="text-xl font-semibold">Secure Vault</h1>
      <p className="mt-1 text-[13px] text-muted">{subtitle}</p>
    </div>
  );
}

function CreateScreen() {
  const create = useVault((s) => s.create);
  const busy = useVault((s) => s.busy);
  const error = useVault((s) => s.error);
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [ack, setAck] = useState(false);
  const strength = passwordStrength(pw);
  const canCreate = pw.length >= 8 && pw === confirm && ack && !busy;

  return (
    <div className="mx-auto mt-6 max-w-sm sm:mt-10">
      <VaultHeader subtitle="Create a master password to protect this device's vault." />
      <div className="space-y-3 rounded-[var(--radius-card)] border border-border bg-surface p-5">
        <div>
          <label className="mb-1.5 block text-[12px] font-medium text-muted">Master password</label>
          <Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
          {pw && (
            <div className="mt-1.5 flex items-center gap-2">
              <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface-3">
                <div className={cn("h-full rounded-full transition-all", strength.score >= 3 ? "bg-ok" : strength.score >= 2 ? "bg-warn" : "bg-danger")} style={{ width: `${(strength.score / 4) * 100}%` }} />
              </div>
              <span className="text-[12px] text-muted">{strength.label}</span>
            </div>
          )}
        </div>
        <div>
          <label className="mb-1.5 block text-[12px] font-medium text-muted">Confirm password</label>
          <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          {confirm && confirm !== pw && <p className="mt-1 text-[12.5px] text-danger">Passwords don't match.</p>}
        </div>
        <label className="flex cursor-pointer items-start gap-2 rounded-[var(--radius-control)] bg-warn-soft px-3 py-2.5 text-[12.5px]">
          <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--primary)]" />
          <span>I understand that <strong>this password can't be recovered</strong> — if I forget it, the vault contents are permanently unreadable.</span>
        </label>
        {error && <p className="text-[12.5px] text-danger">{error}</p>}
        <Button variant="primary" className="w-full" loading={busy} disabled={!canCreate} onClick={() => void create(pw)}>
          <ShieldCheck size={15} /> Create vault
        </Button>
      </div>
    </div>
  );
}

function UnlockScreen() {
  const unlock = useVault((s) => s.unlock);
  const busy = useVault((s) => s.busy);
  const error = useVault((s) => s.error);
  const [pw, setPw] = useState("");
  const submit = () => pw && void unlock(pw);

  return (
    <div className="mx-auto mt-6 max-w-sm sm:mt-16">
      <VaultHeader subtitle="Enter your master password to unlock." />
      <div className="space-y-3 rounded-[var(--radius-card)] border border-border bg-surface p-5">
        <Input
          type="password"
          value={pw}
          autoFocus
          onChange={(e) => setPw(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="Master password"
          aria-label="Master password"
        />
        {error && <p className="text-[12.5px] text-danger">{error}</p>}
        <Button variant="primary" className="w-full" loading={busy} disabled={!pw} onClick={submit}>
          <LockKeyhole size={15} /> Unlock
        </Button>
      </div>
    </div>
  );
}

/* ── unlocked dashboard ──────────────────────────────────────── */

function Dashboard() {
  const data = useVault((s) => s.data);
  const lock = useVault((s) => s.lock);
  const [cat, setCat] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<VaultEntry | null>(null);
  const [viewing, setViewing] = useState<VaultEntry | null>(null);

  const entries = data?.entries ?? [];
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((e) => {
      if (cat && e.category !== cat) return false;
      if (!q) return true;
      return [e.title, e.category, e.folder, e.note, ...(e.file ? [e.file.name] : [])].some((f) => f?.toLowerCase().includes(q));
    });
  }, [entries, cat, query]);

  return (
    <div className="w-full">
      <PageHeader
        title="Secure Vault"
        subtitle={`${entries.length} encrypted item${entries.length === 1 ? "" : "s"} · auto-locks after inactivity`}
        icon={FolderLock}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="primary" size="sm" onClick={() => setAdding(true)}><Plus size={15} /> Add</Button>
            <Button variant="outline" size="sm" onClick={lock}><Lock size={15} /> Lock</Button>
          </div>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[220px_minmax(0,1fr)] lg:items-start">
        {/* categories — a horizontal chip strip (edge to edge) below lg, a sticky column on desktop */}
        <aside className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:-mx-5 sm:px-5 lg:sticky lg:top-4 lg:mx-0 lg:block lg:space-y-1 lg:px-0 lg:pb-0">
          <CatButton label="All items" count={entries.length} active={cat === null} onClick={() => setCat(null)} />
          {(data?.categories ?? []).map((c) => (
            <CatButton key={c} label={c} count={entries.filter((e) => e.category === c).length} active={cat === c} onClick={() => setCat(c)} />
          ))}
        </aside>

        {/* entries */}
        <div className="space-y-4">
          <div className="relative">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search the vault…" aria-label="Search the vault" className="pl-9" />
          </div>

          {filtered.length === 0 ? (
            entries.length === 0 ? (
              <EmptyState
                size="sm"
                icon={FolderLock}
                title="Your vault is empty"
                description="Add a note, secret, or file — everything is encrypted on this device before it leaves."
                action={<Button variant="primary" size="sm" onClick={() => setAdding(true)}><Plus size={15} /> Add an item</Button>}
              />
            ) : (
              <EmptyState size="sm" icon={Search} title="No matching items" description="Try another search or category." />
            )
          ) : (
            // Keyed by the active filter so re-filtering re-reveals; adds/edits patch in place without replaying.
            <div key={`${cat ?? "all"}|${query.trim().toLowerCase()}`} className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {filtered.map((e, i) => {
                const Icon = TYPE_ICON[e.type];
                return (
                  <button
                    key={e.id}
                    onClick={() => setViewing(e)}
                    className={cn("flex flex-col items-start rounded-[var(--radius-card)] border border-border bg-surface p-3.5 text-left card-hover pressable hover:border-border-strong", revealClass(i))}
                    style={revealStyle(i)}
                  >
                    <div className="flex w-full items-center gap-2">
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary"><Icon size={15} /></span>
                      <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{e.title}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[12px] text-muted">
                      <span className="rounded-md bg-surface-2 px-1.5 py-0.5">{e.category}</span>
                      {e.folder && <span className="rounded-md bg-surface-2 px-1.5 py-0.5">{e.folder}</span>}
                      <span className="text-faint">· {ago(e.updatedAt)}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {adding && <EntryForm onClose={() => setAdding(false)} />}
      {editing && <EntryForm entry={editing} onClose={() => setEditing(null)} />}
      {viewing && <EntryDetail entry={viewing} onClose={() => setViewing(null)} onEdit={() => { setEditing(viewing); setViewing(null); }} />}
    </div>
  );
}

function CatButton({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    // A pill in the phone strip; a full-width row in the desktop column.
    <button
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "pressable flex h-8 shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-3 text-[13px] transition-colors [@media(pointer:coarse)]:h-9",
        "lg:h-auto lg:w-full lg:justify-between lg:rounded-[var(--radius-control)] lg:border-transparent lg:py-2 lg:[@media(pointer:coarse)]:min-h-10",
        active ? "border-primary/30 bg-primary-soft font-medium text-primary lg:border-transparent" : "border-border bg-surface text-foreground hover:bg-surface-2",
      )}
    >
      <span className="truncate">{label}</span>
      <span className="tabular text-[11px] text-faint">{count}</span>
    </button>
  );
}

/* ── add / edit ──────────────────────────────────────────────── */

function EntryForm({ entry, onClose }: { entry?: VaultEntry; onClose: () => void }) {
  const data = useVault((s) => s.data);
  const addEntry = useVault((s) => s.addEntry);
  const updateEntry = useVault((s) => s.updateEntry);
  const uploadFile = useVault((s) => s.uploadFile);
  const toast = useUi((s) => s.toast);

  const [type, setType] = useState<VaultEntryType>(entry?.type ?? "note");
  const [title, setTitle] = useState(entry?.title ?? "");
  const [category, setCategory] = useState(entry?.category ?? data?.categories[0] ?? "Personal");
  const [newCat, setNewCat] = useState("");
  const [folder, setFolder] = useState(entry?.folder ?? "");
  const [note, setNote] = useState(entry?.note ?? "");
  const [secret, setSecret] = useState(entry?.secret ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const editing = !!entry;

  const submit = async () => {
    const finalCat = (newCat.trim() || category).trim() || "Personal";
    if (!title.trim()) return;
    setBusy(true);
    try {
      const base = { title: title.trim(), category: finalCat, folder: folder.trim() || undefined };
      if (editing) {
        await updateEntry(entry!.id, { ...base, note: note || undefined, secret: type === "secret" ? secret : undefined });
      } else if (type === "file") {
        if (!file) { setBusy(false); return; }
        const ref = await uploadFile(file);
        await addEntry({ ...base, type: "file", note: note || undefined, file: ref });
      } else {
        await addEntry({ ...base, type, note: note || undefined, secret: type === "secret" ? secret : undefined });
      }
      onClose();
    } catch (err) {
      toast({ message: "Couldn't save to the vault", description: err instanceof Error ? err.message : undefined, tone: "danger" });
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} className="max-w-lg" labelledBy="vault-form-title">
      <div className="border-b border-border px-5 py-4">
        <h2 id="vault-form-title" className="text-base font-semibold">{editing ? "Edit item" : "Add to vault"}</h2>
      </div>
      <div className="min-h-0 flex-1 space-y-3.5 overflow-y-auto px-5 py-4">
        {!editing && (
          <div className="grid grid-cols-3 gap-2">
            {(["note", "secret", "file"] as const).map((t) => {
              const Icon = TYPE_ICON[t];
              return (
                <button key={t} onClick={() => setType(t)} aria-pressed={type === t} className={cn("pressable flex flex-col items-center gap-1 rounded-[var(--radius-control)] border px-2 py-2.5 text-[12px] font-medium capitalize transition-colors", type === t ? "border-primary bg-primary-soft text-primary" : "border-border bg-surface-2 hover:border-border-strong")}>
                  <Icon size={16} /> {t}
                </button>
              );
            })}
          </div>
        )}
        <Field label="Title">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus placeholder="e.g. Bank login" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category">
            <SelectMenu
              value={category}
              onChange={setCategory}
              options={(data?.categories ?? ["Personal"]).map((c) => ({ value: c, label: c }))}
              width={200}
              ariaLabel="Category"
              className="w-full"
            />
          </Field>
          <Field label="New category (optional)">
            <Input value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="Add one" />
          </Field>
        </div>
        <Field label="Folder (optional)">
          <Input value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="e.g. Finance" />
        </Field>
        {type === "secret" && (
          <Field label="Secret value">
            <Textarea value={secret} onChange={(e) => setSecret(e.target.value)} rows={3} className="font-mono" placeholder="Password, API key, seed phrase…" />
          </Field>
        )}
        {type === "file" && !editing && (
          <Field label="File (encrypted before upload)">
            <input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block w-full text-[13px] text-muted file:mr-3 file:rounded-md file:border-0 file:bg-primary-soft file:px-3 file:py-1.5 file:text-[12px] file:font-medium file:text-primary [@media(pointer:coarse)]:file:py-2.5" />
          </Field>
        )}
        <Field label="Note (optional)">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="Anything you want to remember…" />
        </Field>
      </div>
      <div className="flex justify-end gap-2 border-t border-border px-5 py-3.5">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={submit} loading={busy} disabled={!title.trim() || (type === "file" && !editing && !file)}>
          {editing ? "Save" : "Add"}
        </Button>
      </div>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12px] font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}

/* ── detail view ─────────────────────────────────────────────── */

function EntryDetail({ entry, onClose, onEdit }: { entry: VaultEntry; onClose: () => void; onEdit: () => void }) {
  const deleteEntry = useVault((s) => s.deleteEntry);
  const readFile = useVault((s) => s.readFile);
  const toast = useUi((s) => s.toast);
  const openConfirm = useUi((s) => s.openConfirm);
  const [reveal, setReveal] = useState(false);
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const Icon = TYPE_ICON[entry.type];

  // Decrypt image files to a temporary object URL for preview; revoke on close.
  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    if (entry.file && entry.file.mime.startsWith("image/")) {
      readFile(entry.file)
        .then((blob) => {
          if (cancelled) return; // unmounted / locked mid-decrypt — don't mint a lingering plaintext URL
          url = URL.createObjectURL(blob);
          setImgUrl(url);
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [entry, readFile]);

  const copySecret = async () => {
    if (!entry.secret) return;
    const secret = entry.secret;
    try {
      await navigator.clipboard.writeText(secret);
    } catch {
      toast({ message: "Couldn't access the clipboard", tone: "warn" });
      return;
    }
    toast({ message: "Secret copied to clipboard", tone: "ok" });
    // Best-effort clear after 20s — only if the clipboard still holds OUR secret, so we never
    // clobber something the user copied afterwards (and never throws if clipboard-read is denied).
    window.setTimeout(async () => {
      try {
        if ((await navigator.clipboard.readText()) === secret) await navigator.clipboard.writeText("");
      } catch {
        /* clipboard-read not permitted — leave it rather than wipe unrelated content */
      }
    }, 20000);
  };

  const download = async () => {
    if (!entry.file) return;
    try {
      const blob = await readFile(entry.file);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = entry.file.name;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (err) {
      toast({ message: "Couldn't decrypt the file", description: err instanceof Error ? err.message : undefined, tone: "danger" });
    }
  };

  return (
    <Modal open onClose={onClose} className="max-w-lg" labelledBy="vault-detail-title">
      <div className="flex items-center gap-2.5 border-b border-border px-5 py-4">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary"><Icon size={17} /></span>
        <div className="min-w-0 flex-1">
          <h2 id="vault-detail-title" className="line-clamp-2 break-words text-base font-semibold leading-snug">{entry.title}</h2>
          <div className="text-[12px] text-muted">{entry.category}{entry.folder ? ` · ${entry.folder}` : ""} · updated {ago(entry.updatedAt)}</div>
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
        {entry.type === "secret" && (
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[12px] font-medium text-muted">Secret</span>
              <div className="-my-1 flex gap-1">
                <Button variant="ghost" size="icon" onClick={() => setReveal((r) => !r)} aria-label={reveal ? "Hide" : "Reveal"}>
                  {reveal ? <EyeOff size={15} /> : <Eye size={15} />}
                </Button>
                <Button variant="ghost" size="icon" onClick={copySecret} aria-label="Copy">
                  <Copy size={15} />
                </Button>
              </div>
            </div>
            <div className="break-all rounded-[var(--radius-control)] border border-border bg-surface-2 px-3 py-2.5 font-mono text-[13px]">
              {reveal ? entry.secret : "•".repeat(Math.min(24, entry.secret?.length ?? 8))}
            </div>
          </div>
        )}
        {entry.file && (
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[12px] font-medium text-muted">File</span>
              <Button variant="ghost" size="sm" className="-my-1 text-primary hover:bg-primary-soft hover:text-primary" onClick={download}>
                <Download size={14} /> Download
              </Button>
            </div>
            {imgUrl ? (
              <img src={imgUrl} alt={entry.file.name} className="max-h-72 w-full rounded-[var(--radius-control)] border border-border object-contain" />
            ) : (
              <div className="rounded-[var(--radius-control)] border border-border bg-surface-2 px-3 py-2.5 text-[13px]">
                <div className="font-medium">{entry.file.name}</div>
                <div className="text-[12px] text-faint">{entry.file.mime} · {formatBytes(entry.file.size)}</div>
              </div>
            )}
          </div>
        )}
        {entry.note && (
          <div>
            <span className="mb-1.5 block text-[12px] font-medium text-muted">Note</span>
            <p className="whitespace-pre-wrap rounded-[var(--radius-control)] border border-border bg-surface-2 px-3 py-2.5 text-[13.5px] leading-relaxed">{entry.note}</p>
          </div>
        )}
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-border px-5 py-3.5">
        <Button
          variant="ghost"
          size="sm"
          className="text-danger hover:bg-danger-soft"
          onClick={() =>
            openConfirm({
              title: "Delete this item?",
              message: `"${entry.title}" will be permanently removed from your vault.`,
              confirmLabel: "Delete",
              onConfirm: () => { void deleteEntry(entry.id); onClose(); },
            })
          }
        >
          <Trash2 size={15} /> Delete
        </Button>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <Button variant="outline" onClick={onEdit}>Edit</Button>
        </div>
      </div>
    </Modal>
  );
}
