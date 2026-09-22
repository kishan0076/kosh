import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, FolderUp, GitBranch, RefreshCw, Upload } from "lucide-react";
import { formatBytes, PUBLISH_LIMITS } from "@kosh/shared";
import { ApiError } from "@/data/api";
import { githubV2Api, type RepoDetail } from "@/data/githubV2Api";
import { ghToast } from "@/data/githubV2";
import { readFolderPlan, type LoadedRepoFile } from "@/lib/repoFolder";
import { Button, Spinner } from "@/components/ui";
import { Modal } from "@/components/overlays";

/**
 * Push a picked folder to an existing repo as one commit (on top of a branch). Everything — filtering,
 * reading, secret scanning — happens in the browser; only the included files are sent.
 */
export function PushFilesModal({ repo, onClose }: { repo: RepoDetail; onClose: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [folderName, setFolderName] = useState("");
  const [files, setFiles] = useState<LoadedRepoFile[]>([]);
  const [skipped, setSkipped] = useState(0);
  const [findings, setFindings] = useState<{ path: string; line: number; text: string }[]>([]);
  const [confirmSecrets, setConfirmSecrets] = useState(false);
  const [reading, setReading] = useState(false);
  const [branch, setBranch] = useState(repo.defaultBranch);
  const [message, setMessage] = useState("Update from Kosh");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const el = inputRef.current;
    if (el) {
      el.setAttribute("webkitdirectory", "");
      el.setAttribute("directory", "");
    }
  }, []);

  const totalBytes = useMemo(() => files.reduce((a, f) => a + f.size, 0), [files]);

  async function onPick(list: FileList | null) {
    if (!list || list.length === 0) return;
    setReading(true);
    setError(null);
    try {
      const plan = await readFolderPlan(list);
      setFolderName(plan.topFolder);
      setFiles(plan.files);
      setSkipped(plan.skipped.length);
      setFindings(plan.findings);
      setConfirmSecrets(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't read that folder.");
    } finally {
      setReading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const canPush = files.length > 0 && !reading && !busy && branch.trim() && message.trim() && (findings.length === 0 || confirmSecrets);

  async function push() {
    if (!canPush) return;
    setBusy(true);
    setError(null);
    try {
      const { push } = await githubV2Api.pushFiles(repo.owner, repo.name, {
        files: files.map((f) => ({ path: f.path, content: f.content, encoding: f.encoding })),
        message: message.trim(),
        branch: branch.trim(),
        allowSecrets: confirmSecrets,
      });
      ghToast(`Pushed ${files.length} file${files.length === 1 ? "" : "s"} to ${branch.trim()}`, "ok");
      window.open(push.htmlUrl, "_blank", "noopener");
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.code === "SECRETS_FOUND") {
        setError("Possible secrets were found. Review the warnings and tick the box to push anyway.");
        setConfirmSecrets(false);
      } else {
        setError(err instanceof ApiError ? err.message : "Couldn't push the files.");
      }
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} className="w-full max-w-lg" labelledBy="push-title">
      <div className="p-5">
        <h2 id="push-title" className="text-[16px] font-semibold">Push files to <span className="font-mono">{repo.owner}/{repo.name}</span></h2>
        <p className="mt-1 text-[12.5px] text-muted">Adds a commit on top of a branch. Existing files are kept unless a pushed file overwrites them.</p>

        <input ref={inputRef} type="file" multiple hidden onChange={(e) => onPick(e.target.files)} />

        <div className="mt-4 space-y-3.5">
          {files.length === 0 ? (
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={reading}
              className="flex min-h-[140px] w-full flex-col items-center justify-center gap-2 rounded-[var(--radius-card)] border-2 border-dashed border-border bg-surface px-6 py-8 text-center transition-colors hover:border-primary hover:bg-primary-soft/30 disabled:opacity-60"
            >
              <span className="grid h-11 w-11 place-items-center rounded-2xl bg-primary-soft text-primary">{reading ? <Spinner size={20} /> : <FolderUp size={22} />}</span>
              <span className="text-[14px] font-semibold">{reading ? "Reading folder…" : "Choose a folder to push"}</span>
              <span className="text-[12px] text-muted">Build files & secrets are filtered out automatically.</span>
            </button>
          ) : (
            <div className="overflow-hidden rounded-[var(--radius-control)] border border-border">
              <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-[12.5px]">
                <Check size={14} className="text-ok" />
                <span className="min-w-0 flex-1 truncate font-medium">{folderName}</span>
                <span className="text-faint">{files.length} file{files.length === 1 ? "" : "s"} · {formatBytes(totalBytes)}{skipped ? ` · ${skipped} skipped` : ""}</span>
                <Button variant="ghost" size="sm" onClick={() => inputRef.current?.click()} disabled={busy}><RefreshCw size={13} /> Change</Button>
              </div>
              <div className="max-h-40 overflow-y-auto">
                {files.slice(0, 200).map((f) => (
                  <div key={f.path} className="flex items-center gap-2 border-b border-border px-3 py-1 font-mono text-[11.5px] last:border-0">
                    <span className="min-w-0 flex-1 truncate">{f.path}</span>
                    <span className="shrink-0 text-faint">{formatBytes(f.size)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {findings.length > 0 && (
            <div className="rounded-[var(--radius-control)] border border-warn/40 bg-warn-soft px-3 py-2.5">
              <div className="flex items-center gap-2 text-[13px] font-semibold"><AlertTriangle size={15} className="text-warn" /> Possible secrets found</div>
              <ul className="mt-1.5 max-h-24 space-y-0.5 overflow-y-auto font-mono text-[11.5px]">
                {findings.slice(0, 20).map((f, i) => <li key={i}><span className="text-foreground">{f.path}</span>:{f.line} — {f.text}</li>)}
              </ul>
              <label className="mt-2 flex cursor-pointer items-center gap-2 text-[12.5px]">
                <input type="checkbox" checked={confirmSecrets} onChange={(e) => setConfirmSecrets(e.target.checked)} className="h-4 w-4 accent-[var(--primary)]" />
                I&apos;ve reviewed these and want to push anyway
              </label>
            </div>
          )}

          {files.length > 0 && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="pf-branch" className="mb-1.5 block text-[12px] font-medium text-muted">Branch</label>
                <div className="flex items-center overflow-hidden rounded-[var(--radius-control)] border border-border bg-surface focus-within:border-primary focus-within:ring-focus">
                  <span className="grid h-9 w-9 shrink-0 place-items-center border-r border-border bg-surface-2 text-faint"><GitBranch size={14} /></span>
                  <input id="pf-branch" value={branch} onChange={(e) => setBranch(e.target.value)} className="min-w-0 flex-1 bg-transparent px-2.5 py-2 font-mono text-[13px] outline-none" />
                </div>
              </div>
              <div>
                <label htmlFor="pf-msg" className="mb-1.5 block text-[12px] font-medium text-muted">Commit message</label>
                <input id="pf-msg" value={message} onChange={(e) => setMessage(e.target.value)} className="w-full rounded-[var(--radius-control)] border border-border bg-surface px-3 py-2 text-[13px] outline-none focus:border-primary focus:ring-focus" />
              </div>
            </div>
          )}

          {error && <div className="rounded-[var(--radius-control)] border border-danger/40 bg-danger-soft px-3 py-2 text-[12.5px] text-danger">{error}</div>}
        </div>

        <div className="mt-5 flex items-center justify-between">
          <span className="text-[11.5px] text-faint">Up to {PUBLISH_LIMITS.maxTotalBytes / (1024 * 1024)} MB per push.</span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button variant="primary" onClick={push} disabled={!canPush}>{busy ? <Spinner size={15} /> : <Upload size={15} />} Push {files.length > 0 ? `${files.length} file${files.length === 1 ? "" : "s"}` : ""}</Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
