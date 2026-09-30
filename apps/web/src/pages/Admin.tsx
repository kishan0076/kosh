import { useEffect, useState } from "react";
import { ShieldCheck, UserPlus, Trash2, RefreshCw, Users as UsersIcon } from "lucide-react";
import { isValidEmail, passwordProblem } from "@kosh/shared";
import { api, type AdminUserRow } from "@/data/api";
import { useData } from "@/data/store";
import { useUi } from "@/data/ui";
import { Button, Input, Badge, Divider, Spinner } from "@/components/ui";
import { SelectMenu, Modal } from "@/components/overlays";

/** Admin-only Users management: list every account, create one, change roles, enable/disable, delete. */
export function Admin() {
  const backend = useData((s) => s.backend);
  const me = useData((s) => s.user);
  const toast = useUi((s) => s.toast);

  const [users, setUsers] = useState<AdminUserRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<AdminUserRow | null>(null);

  // Create-user form.
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"admin" | "user">("user");
  const [creating, setCreating] = useState(false);

  const load = async () => {
    setError(null);
    try {
      const { users } = await api.adminListUsers();
      setUsers(users);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load users.");
    }
  };

  useEffect(() => {
    if (backend && me.isAdmin) void load();
  }, [backend, me.isAdmin]);

  if (!backend) {
    return <Gate title="Users need the API" body="User management needs the Kosh API running." />;
  }
  if (!me.isAdmin) {
    return <Gate title="Admins only" body="This screen is for admins. Ask an admin to grant you access." />;
  }

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValidEmail(email)) return toast({ message: "Enter a valid email", tone: "danger" });
    const problem = passwordProblem(password);
    if (problem) return toast({ message: problem, tone: "danger" });
    setCreating(true);
    try {
      const { user } = await api.adminCreateUser({ email: email.trim(), password, name: name.trim() || undefined, role });
      setUsers((list) => [...(list ?? []), user]);
      setEmail("");
      setName("");
      setPassword("");
      setRole("user");
      toast({ message: "Account created", description: user.email, tone: "ok" });
    } catch (err) {
      toast({ message: "Couldn't create account", description: err instanceof Error ? err.message : undefined, tone: "danger" });
    } finally {
      setCreating(false);
    }
  };

  const patch = async (u: AdminUserRow, changes: { role?: "admin" | "user"; disabled?: boolean }) => {
    setBusyId(u.id);
    try {
      const { user } = await api.adminUpdateUser(u.id, changes);
      setUsers((list) => (list ?? []).map((x) => (x.id === user.id ? user : x)));
    } catch (err) {
      toast({ message: "Couldn't update account", description: err instanceof Error ? err.message : undefined, tone: "danger" });
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (u: AdminUserRow) => {
    setBusyId(u.id);
    try {
      await api.adminDeleteUser(u.id);
      setUsers((list) => (list ?? []).filter((x) => x.id !== u.id));
      toast({ message: "Account deleted", description: u.email ?? u.login, tone: "ok" });
    } catch (err) {
      toast({ message: "Couldn't delete account", description: err instanceof Error ? err.message : undefined, tone: "danger" });
    } finally {
      setBusyId(null);
      setConfirmDelete(null);
    }
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <header className="mb-6 flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary-soft text-primary">
          <UsersIcon size={20} />
        </span>
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight">Users</h1>
          <p className="text-[13px] text-muted">Manage who can sign in, their role, and access.</p>
        </div>
        <Button variant="ghost" size="sm" className="ml-auto" onClick={load} aria-label="Refresh">
          <RefreshCw size={15} /> Refresh
        </Button>
      </header>

      {/* Create account */}
      <form onSubmit={create} className="mb-6 rounded-xl border border-border bg-surface p-4">
        <div className="mb-3 flex items-center gap-2 text-[13px] font-semibold">
          <UserPlus size={15} className="text-primary" /> Add a user
        </div>
        <div className="grid gap-2.5 sm:grid-cols-2">
          <Input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} autoCapitalize="none" aria-label="Email" />
          <Input type="text" placeholder="Name (optional)" value={name} onChange={(e) => setName(e.target.value)} aria-label="Name" />
          <Input type="password" placeholder="Temporary password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" aria-label="Password" />
          <div className="flex items-center gap-2">
            <SelectMenu
              value={role}
              onChange={(v) => setRole(v as "admin" | "user")}
              ariaLabel="Role"
              width={160}
              options={[
                { value: "user", label: "Member" },
                { value: "admin", label: "Admin" },
              ]}
            />
            <Button type="submit" variant="primary" disabled={creating || !email.trim() || !password} className="ml-auto">
              {creating ? <Spinner size={15} /> : <UserPlus size={15} />} Create
            </Button>
          </div>
        </div>
      </form>

      {/* User list */}
      {error && <div className="mb-4 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-[13px] text-danger">{error}</div>}
      {users === null && !error && (
        <div className="flex items-center gap-2 py-10 text-muted">
          <Spinner /> Loading users…
        </div>
      )}
      {users && (
        <div className="rounded-xl border border-border bg-surface">
          {users.map((u, i) => (
            <div key={u.id}>
              {i > 0 && <Divider />}
              <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[14px] font-medium">{u.name || u.email || u.login}</span>
                    {u.role === "admin" && (
                      <Badge tone="primary" className="gap-1">
                        <ShieldCheck size={12} /> Admin
                      </Badge>
                    )}
                    {u.configAdmin && <Badge tone="neutral">config</Badge>}
                    {u.disabled && <Badge tone="danger">Disabled</Badge>}
                  </div>
                  <div className="truncate text-[12px] text-muted">
                    {u.email ?? u.login} · signs in with {u.authProvider === "github" ? "GitHub" : u.authProvider === "password" ? "email" : "dev"}
                  </div>
                </div>

                {u.configAdmin || u.id === me.id ? (
                  <span className="text-[12px] text-faint">{u.id === me.id ? "You" : "Configured admin"}</span>
                ) : (
                  <div className="flex items-center gap-2">
                    <SelectMenu
                      value={u.role}
                      onChange={(v) => patch(u, { role: v as "admin" | "user" })}
                      ariaLabel={`Role for ${u.email ?? u.login}`}
                      size="sm"
                      width={140}
                      disabled={busyId === u.id}
                      options={[
                        { value: "user", label: "Member" },
                        { value: "admin", label: "Admin" },
                      ]}
                    />
                    <Button variant="outline" size="sm" disabled={busyId === u.id} onClick={() => patch(u, { disabled: !u.disabled })}>
                      {u.disabled ? "Enable" : "Disable"}
                    </Button>
                    <Button variant="ghost" size="sm" className="text-danger hover:bg-danger-soft" disabled={busyId === u.id} onClick={() => setConfirmDelete(u)} aria-label={`Delete ${u.email ?? u.login}`}>
                      <Trash2 size={15} />
                    </Button>
                  </div>
                )}
              </div>
            </div>
          ))}
          {users.length === 0 && <div className="px-4 py-10 text-center text-muted">No accounts yet.</div>}
        </div>
      )}

      <Modal open={!!confirmDelete} onClose={() => setConfirmDelete(null)}>
        <h2 className="mb-2 text-[16px] font-semibold">Delete this account?</h2>
        <p className="text-[13.5px] text-muted">
          This permanently removes <b>{confirmDelete?.email ?? confirmDelete?.login}</b> and all of their saved items, skills, prompts and vault. This can’t be undone.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setConfirmDelete(null)}>
            Cancel
          </Button>
          <Button variant="danger" disabled={busyId === confirmDelete?.id} onClick={() => confirmDelete && remove(confirmDelete)}>
            {busyId === confirmDelete?.id ? <Spinner size={15} /> : <Trash2 size={15} />} Delete account
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function Gate({ title, body }: { title: string; body: string }) {
  return (
    <div className="mx-auto max-w-md px-4 py-20 text-center">
      <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-xl bg-surface-2 text-muted">
        <UsersIcon size={22} />
      </div>
      <h1 className="text-[18px] font-semibold">{title}</h1>
      <p className="mt-1 text-[13.5px] text-muted">{body}</p>
    </div>
  );
}
