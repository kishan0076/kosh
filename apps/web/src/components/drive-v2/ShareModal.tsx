import { useEffect, useState } from "react";
import { Check, Globe, Link2, Lock, Share2, UserPlus, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button, Spinner } from "@/components/ui";
import { Modal } from "@/components/overlays";
import { useUi } from "@/data/ui";
import { driveV2Api, type DriveNode, type DrivePermission } from "@/data/driveV2Api";
import { useDriveV2 } from "@/data/driveV2";

const ROLE_LABEL: Record<string, string> = { owner: "Owner", organizer: "Manager", fileOrganizer: "Manager", writer: "Editor", commenter: "Commenter", reader: "Viewer" };
const ASSIGNABLE = [
  { role: "reader", label: "Viewer" },
  { role: "commenter", label: "Commenter" },
  { role: "writer", label: "Editor" },
];

const isValidEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

export function ShareModal({ node, onClose }: { node: DriveNode; onClose: () => void }) {
  const accountId = useDriveV2((s) => s.accountId)!;
  const toast = useUi((s) => s.toast);
  const [perms, setPerms] = useState<DrivePermission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [addRole, setAddRole] = useState("writer");
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const { permissions } = await driveV2Api.listPermissions(accountId, node.id);
      setPerms(permissions);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load sharing.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [accountId, node.id]);

  // Include domain grants too — otherwise a file shared with a whole domain wrongly reads "only you".
  const people = perms.filter((p) => p.type === "user" || p.type === "group" || p.type === "domain");
  const anyone = perms.find((p) => p.type === "anyone") ?? null;
  const personName = (p: DrivePermission) =>
    p.type === "domain" ? `Everyone at ${p.domain ?? "your organization"}` : p.displayName ?? p.emailAddress ?? "Unknown";

  async function addPerson() {
    const addr = email.trim();
    if (!isValidEmail(addr) || adding) return;
    setAdding(true);
    try {
      await driveV2Api.addPermission(accountId, node.id, { role: addRole, type: "user", emailAddress: addr, sendNotificationEmail: true });
      setEmail("");
      toast({ message: `Shared with ${addr}`, tone: "ok" });
      await load();
    } catch (err) {
      toast({ message: err instanceof Error ? err.message : "Couldn't share", tone: "danger" });
    } finally {
      setAdding(false);
    }
  }

  async function changeRole(perm: DrivePermission, role: string) {
    setBusy(perm.id);
    try {
      await driveV2Api.updatePermission(accountId, node.id, perm.id, role);
      setPerms((ps) => ps.map((p) => (p.id === perm.id ? { ...p, role } : p)));
    } catch (err) {
      // Surface Google's real reason (e.g. "you don't have permission…") instead of a generic line.
      toast({ message: err instanceof Error ? err.message : "Couldn't update access", tone: "danger" });
    } finally {
      setBusy(null);
    }
  }

  async function remove(perm: DrivePermission) {
    setBusy(perm.id);
    try {
      await driveV2Api.removePermission(accountId, node.id, perm.id);
      setPerms((ps) => ps.filter((p) => p.id !== perm.id));
    } catch (err) {
      toast({ message: err instanceof Error ? err.message : "Couldn't remove access", tone: "danger" });
    } finally {
      setBusy(null);
    }
  }

  async function toggleLink(on: boolean) {
    setBusy("anyone");
    try {
      if (on) {
        const { permission } = await driveV2Api.addPermission(accountId, node.id, { role: "reader", type: "anyone" });
        setPerms((ps) => [...ps.filter((p) => p.type !== "anyone"), permission]);
      } else if (anyone) {
        await driveV2Api.removePermission(accountId, node.id, anyone.id);
        setPerms((ps) => ps.filter((p) => p.id !== anyone.id));
      }
    } catch {
      toast({ message: "Couldn't change link sharing", tone: "danger" });
    } finally {
      setBusy(null);
    }
  }

  async function copyLink() {
    if (!node.webViewLink) return;
    try {
      await navigator.clipboard.writeText(node.webViewLink);
      toast({ message: "Link copied", tone: "ok" });
    } catch {
      toast({ message: "Couldn't copy the link", tone: "warn" });
    }
  }

  return (
    <Modal open onClose={onClose} className="max-w-lg" labelledBy="share-title">
      <div className="flex items-center gap-3 border-b border-border px-5 py-4">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary-soft text-primary"><Share2 size={19} /></span>
        <div className="min-w-0">
          <h2 id="share-title" className="truncate text-[15px] font-semibold">Share “{node.name}”</h2>
          <p className="text-[12px] text-muted">Manage who can access this {node.isFolder ? "folder" : "file"}.</p>
        </div>
      </div>

      <div className="max-h-[60vh] overflow-y-auto">
        {/* add people */}
        <div className="flex flex-col gap-2 px-5 py-4 sm:flex-row">
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void addPerson(); }}
            placeholder="Add people by email"
            className="min-w-0 flex-1 rounded-[var(--radius-control)] border border-border bg-surface px-3 py-2 text-[13.5px] outline-none focus:border-primary focus:ring-focus"
          />
          <RoleSelect value={addRole} onChange={setAddRole} />
          <Button variant="primary" onClick={addPerson} disabled={!isValidEmail(email.trim()) || adding}>
            {adding ? <Spinner size={15} /> : <UserPlus size={15} />} Share
          </Button>
        </div>

        {/* people with access */}
        <div className="px-5 pb-2">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-faint">People with access</div>
          {loading ? (
            <div className="grid place-items-center py-6"><Spinner size={18} className="text-muted" /></div>
          ) : error ? (
            <div className="py-3 text-[12.5px] text-danger">{error}</div>
          ) : (
            <div className="space-y-0.5">
              {people.map((p) => {
                const assignable = ASSIGNABLE.some((r) => r.role === p.role);
                return (
                <div key={p.id} className="flex items-center gap-2.5 rounded-[var(--radius-control)] px-1.5 py-1.5 hover:bg-surface-2">
                  {p.photoLink ? <img src={p.photoLink} alt="" className="h-8 w-8 rounded-full" /> : <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary-soft text-[12px] font-semibold text-primary">{personName(p).slice(0, 1).toUpperCase()}</span>}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium">{personName(p)}{p.pendingOwner ? " (pending)" : ""}</div>
                    {p.emailAddress && p.displayName && <div className="truncate text-[11.5px] text-muted">{p.emailAddress}</div>}
                  </div>
                  {busy === p.id ? (
                    <Spinner size={15} className="text-muted" />
                  ) : p.role === "owner" ? (
                    <span className="shrink-0 text-[12px] text-muted">Owner</span>
                  ) : assignable ? (
                    <>
                      <RoleSelect value={p.role} onChange={(r) => void changeRole(p, r)} compact />
                      <button onClick={() => void remove(p)} className="shrink-0 rounded-md p-1 text-faint hover:bg-surface-3 hover:text-danger" aria-label="Remove access"><X size={15} /></button>
                    </>
                  ) : (
                    // Manager (organizer/fileOrganizer) & domain grants can't be set to an assignable role —
                    // show the TRUE role read-only (never a fabricated "Editor") but still allow revoking.
                    <>
                      <span className="shrink-0 text-[12px] text-muted">{ROLE_LABEL[p.role] ?? p.role}</span>
                      <button onClick={() => void remove(p)} className="shrink-0 rounded-md p-1 text-faint hover:bg-surface-3 hover:text-danger" aria-label="Remove access"><X size={15} /></button>
                    </>
                  )}
                </div>
                );
              })}
              {people.length === 0 && <div className="px-1.5 py-2 text-[12.5px] text-muted">Only you have access.</div>}
            </div>
          )}
        </div>

        {/* general access (link) */}
        {!loading && !error && (
          <div className="border-t border-border px-5 py-4">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-faint">General access</div>
            <div className="flex items-center gap-2.5">
              <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-full", anyone ? "bg-ok-soft text-ok" : "bg-surface-2 text-muted")}>{anyone ? <Globe size={17} /> : <Lock size={17} />}</span>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium">{anyone ? "Anyone with the link" : "Restricted"}</div>
                <div className="text-[11.5px] text-muted">{anyone ? `Anyone on the internet with the link can ${ROLE_LABEL[anyone.role]?.toLowerCase() ?? "view"}` : "Only people with access can open"}</div>
              </div>
              {busy === "anyone" ? <Spinner size={15} className="text-muted" /> : (
                <button
                  onClick={() => void toggleLink(!anyone)}
                  role="switch"
                  aria-checked={!!anyone}
                  className={cn("relative h-6 w-10 shrink-0 rounded-full transition-colors", anyone ? "bg-primary" : "bg-surface-3")}
                >
                  <span className={cn("absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform", anyone ? "translate-x-[18px]" : "translate-x-0.5")} />
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-border px-5 py-3.5">
        <Button variant="outline" onClick={copyLink} disabled={!node.webViewLink}><Link2 size={15} /> Copy link</Button>
        <Button variant="primary" onClick={onClose}><Check size={15} /> Done</Button>
      </div>
    </Modal>
  );
}

function RoleSelect({ value, onChange, compact }: { value: string; onChange: (role: string) => void; compact?: boolean }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn("rounded-[var(--radius-control)] border border-border bg-surface text-[13px] outline-none focus:border-primary", compact ? "px-2 py-1" : "px-2.5 py-2")}
    >
      {ASSIGNABLE.map((r) => <option key={r.role} value={r.role}>{r.label}</option>)}
    </select>
  );
}
