import { useEffect, useMemo, useState } from "react";
import { Check, Clock, Download, Globe, Link2, Lock, RefreshCw, Share2, UserPlus, X } from "lucide-react";
import { canGrantExpiry } from "@kosh/shared";
import { cn } from "@/lib/cn";
import { shortDate } from "@/lib/time";
import { Button, Input, Skeleton, Spinner, Toggle } from "@/components/ui";
import { Modal, SelectMenu } from "@/components/overlays";
import { useUi } from "@/data/ui";
import { driveV2Api, type DriveNode, type DrivePermission } from "@/data/driveV2Api";
import { useDriveV2 } from "@/data/driveV2";

const ROLE_LABEL: Record<string, string> = { owner: "Owner", organizer: "Manager", fileOrganizer: "Manager", writer: "Editor", commenter: "Commenter", reader: "Viewer" };
// "…with the link can view" — the verb form, for the general-access sentence.
const ROLE_VERB: Record<string, string> = { reader: "view", commenter: "comment", writer: "edit" };
const ASSIGNABLE = [
  { role: "reader", label: "Viewer" },
  { role: "commenter", label: "Commenter" },
  { role: "writer", label: "Editor" },
];

const isValidEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

const pad = (n: number) => String(n).padStart(2, "0");
const toDateInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
// Drive wants a future expiry within one year; expire at the end of the chosen local day.
const expiryToIso = (dateStr: string) => new Date(`${dateStr}T23:59:59`).toISOString();

/** A person-row silhouette (avatar, two text lines, the role control) — same height as a real row. */
function PersonSkeleton() {
  return (
    <div className="flex items-center gap-2.5 px-1.5 py-2">
      <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <Skeleton className="h-3 w-2/5" />
        <Skeleton className="h-3 w-3/5" />
      </div>
      <Skeleton className="h-8 w-24" />
    </div>
  );
}

export function ShareModal({ node, onClose }: { node: DriveNode; onClose: () => void }) {
  const accountId = useDriveV2((s) => s.accountId)!;
  const spaceId = useDriveV2((s) => s.spaceId); // non-null ⇒ a Shared Drive, where Drive forbids per-grant expiry
  const toast = useUi((s) => s.toast);
  const [perms, setPerms] = useState<DrivePermission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [addRole, setAddRole] = useState("reader"); // least-privilege default (Viewer)
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [expiryEditId, setExpiryEditId] = useState<string | null>(null);
  const [copyDisabled, setCopyDisabled] = useState(() => !!node.copyRequiresWriterPermission);

  const canExpire = spaceId == null; // expiry is a My-Drive-only capability
  const canEditFile = node.capabilities?.canEdit !== false;
  const dateBounds = useMemo(() => {
    const now = new Date();
    const min = new Date(now); min.setDate(min.getDate() + 1); // earliest is tomorrow
    // Drive caps expiry at one year out. Since we expire at end-of-day (T23:59:59), the last date one full
    // year ahead would overshoot the cap — step back a day so the chosen day always lands inside the window.
    const max = new Date(now); max.setFullYear(max.getFullYear() + 1); max.setDate(max.getDate() - 1);
    return { min: toDateInput(min), max: toDateInput(max) };
  }, []);

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
  // The owner permission is always present, so a file is only genuinely "shared" once someone other than
  // the owner has access (or a link exists). This gates the download/copy control below.
  const isShared = !!anyone || people.some((p) => p.role !== "owner");
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
    if (busy) return;
    setBusy(perm.id);
    try {
      // Merge the full returned permission so the row also reflects any expiry Drive kept or dropped.
      const { permission } = await driveV2Api.updatePermission(accountId, node.id, perm.id, { role });
      setPerms((ps) => ps.map((p) => (p.id === perm.id ? { ...p, ...permission } : p)));
    } catch (err) {
      // Surface Google's real reason (e.g. "you don't have permission…") instead of a generic line.
      toast({ message: err instanceof Error ? err.message : "Couldn't update access", tone: "danger" });
    } finally {
      setBusy(null);
    }
  }

  async function setExpiry(perm: DrivePermission, dateStr: string) {
    if (!dateStr || busy) return;
    setBusy(perm.id);
    try {
      // Send the current role alongside the expiry so the server can enforce the eligibility rule.
      const { permission } = await driveV2Api.updatePermission(accountId, node.id, perm.id, { role: perm.role, expirationTime: expiryToIso(dateStr) });
      setPerms((ps) => ps.map((p) => (p.id === perm.id ? { ...p, ...permission } : p)));
      setExpiryEditId(null);
      toast({ message: `Access expires ${shortDate(permission.expirationTime ?? expiryToIso(dateStr))}`, tone: "ok" });
    } catch (err) {
      toast({ message: err instanceof Error ? err.message : "Couldn't set an expiry", tone: "danger" });
    } finally {
      setBusy(null);
    }
  }

  async function clearExpiry(perm: DrivePermission) {
    if (busy) return;
    setBusy(perm.id);
    try {
      const { permission } = await driveV2Api.updatePermission(accountId, node.id, perm.id, { removeExpiration: true });
      // Drive omits expirationTime once cleared, so drop it explicitly rather than trusting the merge.
      setPerms((ps) => ps.map((p) => (p.id === perm.id ? { ...p, ...permission, expirationTime: undefined } : p)));
      setExpiryEditId(null);
    } catch (err) {
      toast({ message: err instanceof Error ? err.message : "Couldn't remove the expiry", tone: "danger" });
    } finally {
      setBusy(null);
    }
  }

  async function remove(perm: DrivePermission) {
    if (busy) return;
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
    if (busy) return;
    setBusy("anyone");
    try {
      if (on) {
        // Least privilege: a new link grants Viewer; the owner can raise it below.
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

  async function changeLinkRole(role: string) {
    if (!anyone || busy) return;
    setBusy("anyone");
    try {
      const { permission } = await driveV2Api.updatePermission(accountId, node.id, anyone.id, { role });
      setPerms((ps) => ps.map((p) => (p.id === anyone.id ? { ...p, ...permission } : p)));
    } catch (err) {
      toast({ message: err instanceof Error ? err.message : "Couldn't change link access", tone: "danger" });
    } finally {
      setBusy(null);
    }
  }

  async function toggleCopy(allow: boolean) {
    if (busy) return;
    setBusy("copy");
    try {
      // Go through the store action (not the raw API) so the cached node + open inspector stay in sync;
      // it optimistically updates, folds in the server response, and rolls back + toasts on failure.
      await useDriveV2.getState().updateMeta(node.id, { copyRequiresWriterPermission: !allow });
    } catch {
      /* the store surfaces the error toast and rolls back */
    } finally {
      // Reflect the store's post-mutation truth rather than assuming the optimistic value stuck.
      const s = useDriveV2.getState();
      const fresh = s.nodes.find((n) => n.id === node.id) ?? (s.detailsId === node.id ? s.detailsNode : null);
      setCopyDisabled(fresh ? !!fresh.copyRequiresWriterPermission : !allow);
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
      <div className="flex shrink-0 items-center gap-3 border-b border-border px-5 py-4">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary"><Share2 size={19} /></span>
        <div className="min-w-0">
          {/* Two lines, breaking anywhere: the file being shared must stay identifiable on a phone. */}
          <h2 id="share-title" className="line-clamp-2 break-all text-[15px] font-semibold leading-snug">Share “{node.name}”</h2>
          <p className="text-[12px] text-muted">Manage who can access this {node.isFolder ? "folder" : "file"}.</p>
        </div>
      </div>

      {/* The body scrolls; header + footer stay pinned (the Modal panel is a flex column). */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* add people */}
        <div className="flex flex-col gap-2 px-5 py-4 sm:flex-row">
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void addPerson(); }}
            placeholder="Add people by email"
            className="min-w-0 sm:flex-1"
          />
          <RoleSelect value={addRole} onChange={setAddRole} />
          <Button variant="primary" onClick={addPerson} disabled={!isValidEmail(email.trim())} loading={adding}>
            <UserPlus size={15} /> Share
          </Button>
        </div>

        {/* people with access */}
        <div className="px-5 pb-2">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-faint">People with access</div>
          {loading ? (
            <div role="status" aria-busy="true" aria-label="Loading people">
              {[0, 1, 2].map((i) => <PersonSkeleton key={i} />)}
            </div>
          ) : error ? (
            <div className="flex flex-wrap items-center gap-2 py-3 text-[12.5px] text-danger">
              <span className="min-w-0 flex-1">{error}</span>
              <Button variant="outline" size="sm" onClick={() => void load()}><RefreshCw size={14} /> Try again</Button>
            </div>
          ) : (
            <div className="space-y-0.5">
              {people.map((p) => {
                const assignable = ASSIGNABLE.some((r) => r.role === p.role);
                const showExpiry = canExpire && canGrantExpiry(p.type, p.role);
                const editingExpiry = expiryEditId === p.id;
                return (
                <div key={p.id} className="rounded-[var(--radius-control)] hover:bg-surface-2">
                  {/* On phones the role controls wrap under the name so name/email/expiry get the full width. */}
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 px-1.5 py-2">
                    {p.photoLink ? <img src={p.photoLink} alt="" referrerPolicy="no-referrer" className="h-8 w-8 shrink-0 rounded-full" /> : <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary-soft text-[12px] font-semibold text-primary">{personName(p).slice(0, 1).toUpperCase()}</span>}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium">{personName(p)}{p.pendingOwner ? " (pending)" : ""}</div>
                      {p.emailAddress && p.displayName && <div className="truncate text-[11.5px] text-muted">{p.emailAddress}</div>}
                      {p.expirationTime && <div className="text-[11.5px] text-warn">Access expires {shortDate(p.expirationTime)}</div>}
                    </div>
                    {busy === p.id ? (
                      <Spinner size={15} className="text-muted" />
                    ) : p.role === "owner" ? (
                      <span className="shrink-0 text-[12px] text-muted">Owner</span>
                    ) : assignable ? (
                      <div className="flex basis-full items-center justify-end gap-1 sm:ml-auto sm:basis-auto">
                        {showExpiry && (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => setExpiryEditId(editingExpiry ? null : p.id)}
                            className={cn(p.expirationTime ? "text-warn hover:text-warn" : "text-faint")}
                            aria-label={p.expirationTime ? "Change expiration" : "Set expiration"}
                            aria-expanded={editingExpiry}
                            title={p.expirationTime ? `Expires ${shortDate(p.expirationTime)}` : "Set an expiry"}
                          ><Clock size={16} /></Button>
                        )}
                        <RoleSelect value={p.role} onChange={(r) => void changeRole(p, r)} compact />
                        <Button variant="ghost" size="icon-sm" onClick={() => void remove(p)} className="text-faint hover:text-danger" aria-label="Remove access"><X size={16} /></Button>
                      </div>
                    ) : (
                      // Manager (organizer/fileOrganizer) & domain grants can't be set to an assignable role —
                      // show the TRUE role read-only (never a fabricated "Editor") but still allow revoking.
                      <div className="ml-auto flex shrink-0 items-center gap-1">
                        <span className="text-[12px] text-muted">{ROLE_LABEL[p.role] ?? p.role}</span>
                        <Button variant="ghost" size="icon-sm" onClick={() => void remove(p)} className="text-faint hover:text-danger" aria-label="Remove access"><X size={16} /></Button>
                      </div>
                    )}
                  </div>
                  {showExpiry && editingExpiry && (
                    <div className="flex flex-wrap items-center gap-2 pb-2.5 pl-[46px] pr-2">
                      <label className="text-[11.5px] text-muted">Access expires</label>
                      <Input
                        type="date"
                        min={dateBounds.min}
                        max={dateBounds.max}
                        disabled={busy === p.id}
                        defaultValue={p.expirationTime ? toDateInput(new Date(p.expirationTime)) : ""}
                        onChange={(e) => { if (e.target.value) void setExpiry(p, e.target.value); }}
                        className="w-auto"
                      />
                      {p.expirationTime && (
                        <Button variant="ghost" size="sm" onClick={() => void clearExpiry(p)} disabled={busy === p.id} className="hover:text-danger">Remove expiry</Button>
                      )}
                    </div>
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
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
              <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-full", anyone ? "bg-ok-soft text-ok" : "bg-surface-2 text-muted")}>{anyone ? <Globe size={17} /> : <Lock size={17} />}</span>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium">{anyone ? "Anyone with the link" : "Restricted"}</div>
                <div className="text-[11.5px] text-muted">{anyone ? `Anyone on the internet with the link can ${ROLE_VERB[anyone.role] ?? "view"}` : "Only people with access can open"}</div>
              </div>
              {busy === "anyone" ? <Spinner size={15} className="text-muted" /> : (
                <div className="ml-auto flex items-center gap-2">
                  {anyone && <RoleSelect value={anyone.role} onChange={(r) => void changeLinkRole(r)} compact />}
                  <Toggle checked={!!anyone} onChange={(on) => void toggleLink(on)} label="Anyone with the link" />
                </div>
              )}
            </div>
          </div>
        )}

        {/* owner controls: keep viewers from downloading/printing/copying */}
        {!loading && !error && isShared && canEditFile && (
          <div className="border-t border-border px-5 py-4">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-faint">Download &amp; copy</div>
            <div className="flex items-center gap-2.5">
              <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-full", copyDisabled ? "bg-warn-soft text-warn" : "bg-surface-2 text-muted")}><Download size={17} /></span>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium">Viewers &amp; commenters can download</div>
                <div className="text-[11.5px] text-muted">{copyDisabled ? "Download, print and copy are turned off for viewers and commenters" : `They can download, print, and copy this ${node.isFolder ? "folder" : "file"}`}</div>
              </div>
              {busy === "copy" ? <Spinner size={15} className="text-muted" /> : (
                <Toggle checked={!copyDisabled} onChange={(allow) => void toggleCopy(allow)} label="Allow download, print and copy" />
              )}
            </div>
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border px-5 py-3.5">
        <Button variant="outline" onClick={copyLink} disabled={!node.webViewLink}><Link2 size={15} /> Copy link</Button>
        <Button variant="primary" onClick={onClose}><Check size={15} /> Done</Button>
      </div>
    </Modal>
  );
}

function RoleSelect({ value, onChange, compact }: { value: string; onChange: (role: string) => void; compact?: boolean }) {
  return (
    <SelectMenu
      value={value}
      onChange={onChange}
      options={ASSIGNABLE.map((r) => ({ value: r.role, label: r.label }))}
      width={compact ? 130 : 150}
      size={compact ? "sm" : "md"}
      align="end"
      ariaLabel="Access role"
      className={compact ? "shrink-0" : undefined}
    />
  );
}
