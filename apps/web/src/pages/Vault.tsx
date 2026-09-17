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
import { useData } from "@/data/store";
import { useUi } from "@/data/ui";
import { useVault, type VaultEntry, type VaultEntryType } from "@/data/vault";
import { passwordStrength } from "@/lib/vaultCrypto";
import { PageHeader } from "@/components/common";
import { Modal } from "@/components/overlays";
import { Button, Spinner } from "@/components/ui";

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
      {status === "loading" && (
        <div className="grid min-h-[60vh] place-items-center">
          <Spinner size={26} className="text-primary" />
        </div>
      )}
      {status === "error" && (
        <Gate icon={AlertTriangle} title="Couldn't open the vault">
          Something went wrong reaching the vault API. <button onClick={() => void init()} className="text-primary underline">Try again</button>.
        </Gate>
      )}
      {status === "first-run" && <CreateScreen />}
      {status === "locked" && <UnlockScreen />}
      {status === "unlocked" && <Dashboard />}
    </div>
  );
}

/* ── gates & screens ─────────────────────────────────────────── */

function Gate({ icon: Icon, title, children }: { icon: typeof Lock; title: string; children: ReactNode }) {
  return (
    <div className="mx-auto mt-16 max-w-md text-center">
      <span className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-primary-soft text-primary">
        <Icon size={26} />
      </span>
      <h1 className="text-lg font-semibold">{title}</h1>
      <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted">{children}</p>
    </div>
  );
}

function VaultHeader({ subtitle }: { subtitle: string }) {
  return (
    <div className="mb-6 flex flex-col items-center text-center">
      <span className="mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-primary-soft text-primary">
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
    <div className="mx-auto mt-10 max-w-sm">
      <VaultHeader subtitle="Create a master password to protect this device's vault." />
      <div className="space-y-3 rounded-[var(--radius-card)] border border-border bg-surface p-5">
        <div>
          <label className="mb-1.5 block text-[12px] font-medium text-muted">Master password</label>
          <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus className="w-full rounded-[var(--radius-control)] border border-border bg-surface px-3 py-2 text-[14px] outline-none focus:border-primary focus:ring-focus" />
          {pw && (
            <div className="mt-1.5 flex items-center gap-2">
              <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface-3">
                <div className={cn("h-full rounded-full transition-all", strength.score >= 3 ? "bg-ok" : strength.score >= 2 ? "bg-warn" : "bg-danger")} style={{ width: `${(strength.score / 4) * 100}%` }} />
              </div>
              <span className="text-[11px] text-muted">{strength.label}</span>
            </div>
          )}
        </div>
        <div>
          <label className="mb-1.5 block text-[12px] font-medium text-muted">Confirm password</label>
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className="w-full rounded-[var(--radius-control)] border border-border bg-surface px-3 py-2 text-[14px] outline-none focus:border-primary focus:ring-focus" />
          {confirm && confirm !== pw && <p className="mt-1 text-[11.5px] text-danger">Passwords don't match.</p>}
        </div>
        <label className="flex cursor-pointer items-start gap-2 rounded-[var(--radius-control)] bg-warn-soft px-3 py-2.5 text-[12.5px]">
          <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--primary)]" />
          <span>I understand that <strong>this password can't be recovered</strong> — if I forget it, the vault contents are permanently unreadable.</span>
        </label>
        {error && <p className="text-[12.5px] text-danger">{error}</p>}
        <Button variant="primary" className="w-full" disabled={!canCreate} onClick={() => void create(pw)}>
          {busy ? <Spinner size={15} /> : <ShieldCheck size={15} />} Create vault
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
    <div className="mx-auto mt-16 max-w-sm">
      <VaultHeader subtitle="Enter your master password to unlock." />
      <div className="space-y-3 rounded-[var(--radius-card)] border border-border bg-surface p-5">
        <input
          type="password"
          value={pw}
          autoFocus
          onChange={(e) => setPw(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="Master password"
          className="w-full rounded-[var(--radius-control)] border border-border bg-surface px-3 py-2 text-[14px] outline-none focus:border-primary focus:ring-focus"
        />
        {error && <p className="text-[12.5px] text-danger">{error}</p>}
        <Button variant="primary" className="w-full" disabled={!pw || busy} onClick={submit}>
          {busy ? <Spinner size={15} /> : <LockKeyhole size={15} />} Unlock
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
        {/* categories */}
        <aside className="space-y-1 lg:sticky lg:top-4">
          <CatButton label="All items" count={entries.length} active={cat === null} onClick={() => setCat(null)} />
          {(data?.categories ?? []).map((c) => (
            <CatButton key={c} label={c} count={entries.filter((e) => e.category === c).length} active={cat === c} onClick={() => setCat(c)} />
          ))}
        </aside>

        {/* entries */}
        <div className="space-y-4">
          <div className="relative">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search the vault…"
              className="w-full rounded-[var(--radius-control)] border border-border bg-surface py-2 pl-9 pr-3 text-[14px] outline-none focus:border-primary focus:ring-focus"
            />
          </div>

          {filtered.length === 0 ? (
            <div className="rounded-[var(--radius-card)] border border-dashed border-border bg-surface px-6 py-12 text-center text-[13px] text-muted">
              {entries.length === 0 ? "Your vault is empty. Add a note, secret, or file." : "No matching items."}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {filtered.map((e) => {
                const Icon = TYPE_ICON[e.type];
                return (
                  <button
                    key={e.id}
                    onClick={() => setViewing(e)}
                    className="flex flex-col items-start rounded-[var(--radius-card)] border border-border bg-surface p-3.5 text-left card-hover hover:border-border-strong"
                  >
                    <div className="flex w-full items-center gap-2">
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary"><Icon size={15} /></span>
                      <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{e.title}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
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
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center justify-between rounded-[var(--radius-control)] px-3 py-2 text-left text-[13px] transition-colors",
        active ? "bg-primary-soft font-medium text-primary" : "text-foreground hover:bg-surface-2",
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
      <div className="space-y-3.5 overflow-y-auto px-5 py-4">
        {!editing && (
          <div className="grid grid-cols-3 gap-2">
            {(["note", "secret", "file"] as const).map((t) => {
              const Icon = TYPE_ICON[t];
              return (
                <button key={t} onClick={() => setType(t)} className={cn("flex flex-col items-center gap-1 rounded-[var(--radius-control)] border px-2 py-2.5 text-[12px] font-medium capitalize transition-colors", type === t ? "border-primary bg-primary-soft text-primary" : "border-border bg-surface-2 hover:border-border-strong")}>
                  <Icon size={16} /> {t}
                </button>
              );
            })}
          </div>
        )}
        <Field label="Title">
          <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus className="input" placeholder="e.g. Bank login" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category">
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="input">
              {(data?.categories ?? ["Personal"]).map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="New category (optional)">
            <input value={newCat} onChange={(e) => setNewCat(e.target.value)} className="input" placeholder="Add one" />
          </Field>
        </div>
        <Field label="Folder (optional)">
          <input value={folder} onChange={(e) => setFolder(e.target.value)} className="input" placeholder="e.g. Finance" />
        </Field>
        {type === "secret" && (
          <Field label="Secret value">
            <textarea value={secret} onChange={(e) => setSecret(e.target.value)} rows={3} className="input font-mono" placeholder="Password, API key, seed phrase…" />
          </Field>
        )}
        {type === "file" && !editing && (
          <Field label="File (encrypted before upload)">
            <input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block w-full text-[13px] text-muted file:mr-3 file:rounded-md file:border-0 file:bg-primary-soft file:px-3 file:py-1.5 file:text-[12px] file:font-medium file:text-primary" />
          </Field>
        )}
        <Field label="Note (optional)">
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} className="input" placeholder="Anything you want to remember…" />
        </Field>
      </div>
      <div className="flex justify-end gap-2 border-t border-border px-5 py-3.5">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={submit} disabled={busy || !title.trim() || (type === "file" && !editing && !file)}>
          {busy ? <Spinner size={15} /> : null} {editing ? "Save" : "Add"}
        </Button>
      </div>
      <style>{`.input{width:100%;border-radius:var(--radius-control);border:1px solid var(--border);background:var(--surface);padding:.5rem .75rem;font-size:14px;outline:none}.input:focus{border-color:var(--primary);box-shadow:var(--ring-focus,0 0 0 3px color-mix(in oklab,var(--primary) 25%,transparent))}`}</style>
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
          <h2 id="vault-detail-title" className="truncate text-base font-semibold">{entry.title}</h2>
          <div className="text-[12px] text-muted">{entry.category}{entry.folder ? ` · ${entry.folder}` : ""} · updated {ago(entry.updatedAt)}</div>
        </div>
      </div>
      <div className="space-y-4 overflow-y-auto px-5 py-4">
        {entry.type === "secret" && (
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[12px] font-medium text-muted">Secret</span>
              <div className="flex gap-1">
                <button onClick={() => setReveal((r) => !r)} className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-foreground" aria-label={reveal ? "Hide" : "Reveal"}>{reveal ? <EyeOff size={15} /> : <Eye size={15} />}</button>
                <button onClick={copySecret} className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-foreground" aria-label="Copy"><Copy size={15} /></button>
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
              <button onClick={download} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-primary hover:bg-primary-soft"><Download size={14} /> Download</button>
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
