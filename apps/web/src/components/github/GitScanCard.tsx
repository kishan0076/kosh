import { useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, Check, Copy, FileWarning, FolderSearch, GitBranch, RefreshCw, Sparkles } from "lucide-react";
import { detectStacks, gitignoreForPaths } from "@kosh/shared";
import { cn } from "@/lib/cn";
import { useUi } from "@/data/ui";
import { fsAccessSupported, pickDirectory, scanGitState, writeGitignore, type DirHandle, type GitScan } from "@/lib/fsAccess";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { Badge, Button } from "@/components/ui";

/**
 * Scan a LOCAL folder for git hygiene: does it have a `.git` folder and a `.gitignore`? A missing
 * `.gitignore` can be created here (stack-aware); a missing `.git` is explained with a copyable
 * `git init` command (the browser can't run git) plus a nudge to publish.
 */
export function GitScanCard() {
  const toast = useUi((s) => s.toast);
  const supported = fsAccessSupported();
  // No phone browser has showDirectoryPicker: on a touch device without it the card would only explain
  // what it can't do, so it steps aside (the folder dropzone below carries the note instead).
  const coarse = useMediaQuery("(pointer: coarse)");
  const [dir, setDir] = useState<DirHandle | null>(null);
  const [scan, setScan] = useState<GitScan | null>(null);
  const [scanning, setScanning] = useState(false);
  const [writing, setWriting] = useState(false);

  const stacks = useMemo(() => (scan ? detectStacks(scan.entries) : []), [scan]);
  const initCmd = 'git init && git add . && git commit -m "Initial commit"';

  async function choose() {
    setScanning(true);
    try {
      const handle = await pickDirectory();
      if (!handle) return; // cancelled
      setDir(handle);
      setScan(await scanGitState(handle));
    } catch (err) {
      toast({ message: err instanceof Error ? err.message : "Couldn't read that folder.", tone: "danger" });
    } finally {
      setScanning(false);
    }
  }

  async function rescan() {
    if (!dir) return;
    setScanning(true);
    try {
      setScan(await scanGitState(dir));
    } finally {
      setScanning(false);
    }
  }

  async function createGitignore() {
    if (!dir || !scan) return;
    setWriting(true);
    try {
      await writeGitignore(dir, gitignoreForPaths(scan.entries));
      toast({ message: ".gitignore created", tone: "ok" });
      await rescan();
    } catch (err) {
      toast({ message: err instanceof Error ? err.message : "Couldn't write .gitignore.", tone: "danger" });
    } finally {
      setWriting(false);
    }
  }

  const copy = (text: string) => {
    navigator.clipboard?.writeText(text).catch(() => {});
    toast({ message: "Copied", tone: "ok" });
  };

  if (!supported && coarse) return null;

  return (
    <section className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
        <FolderSearch size={17} className="shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold">Check a local folder</div>
          <div className="text-[12px] text-muted">Scan a folder on your computer for a <span className="font-mono">.git</span> repo and a <span className="font-mono">.gitignore</span>.</div>
        </div>
        {supported && (
          <Button variant={scan ? "ghost" : "secondary"} size="sm" onClick={choose} loading={scanning}>
            <FolderSearch size={14} /> {scan ? "Choose another" : "Choose folder"}
          </Button>
        )}
      </div>

      {!supported ? (
        <div className="flex items-start gap-2 px-4 py-3.5 text-[12.5px] text-muted">
          <AlertTriangle size={15} className="mt-0.5 shrink-0 text-warn" />
          <span>Local folder scanning needs the File System Access API — available in Chrome, Edge and other Chromium browsers. In other browsers, drop or choose the folder below; a starter <span className="font-mono">.gitignore</span> can be added when you push.</span>
        </div>
      ) : !scan ? (
        <div className="px-4 py-4 text-[12.5px] text-muted">Choose a folder to check its git setup — nothing leaves your computer.</div>
      ) : (
        <div className="space-y-3 px-4 py-4">
          <div className="flex items-center gap-2 text-[13px] font-medium">
            <span className="min-w-0 truncate">{scan.folderName}</span>
            <Button variant="ghost" size="icon-sm" className="-my-1 shrink-0 text-faint" onClick={rescan} aria-label="Re-scan"><RefreshCw size={13} className={cn(scanning && "animate-spin")} /></Button>
            {stacks.length > 0 && (
              <span className="ml-auto flex flex-wrap justify-end gap-1">
                {stacks.map((s) => <Badge key={s}>{s}</Badge>)}
              </span>
            )}
          </div>

          {/* .git row */}
          <StatusRow ok={scan.hasGit} okText=".git repository found" missingText="No .git repository — this folder isn't a git repo yet">
            {!scan.hasGit && (
              <div className="mt-2 space-y-2">
                <p className="text-[12px] text-muted">A browser can't run <span className="font-mono">git init</span> for you. Run this in the folder, or just publish it — that creates a repo on GitHub:</p>
                <div className="flex items-center gap-2 rounded-[var(--radius-control)] border border-border bg-surface-2 px-2.5 py-2">
                  <GitBranch size={13} className="shrink-0 text-muted" />
                  <code className="min-w-0 flex-1 truncate font-mono text-[12px]">{initCmd}</code>
                  <Button variant="ghost" size="icon-sm" className="-my-1.5 shrink-0 text-faint" onClick={() => copy(initCmd)} aria-label="Copy command"><Copy size={13} /></Button>
                </div>
              </div>
            )}
          </StatusRow>

          {/* .gitignore row */}
          <StatusRow ok={scan.hasGitignore} okText=".gitignore found" missingText="No .gitignore — build files and secrets could be committed">
            {!scan.hasGitignore && (
              <div className="mt-2">
                <Button variant="primary" size="sm" onClick={createGitignore} loading={writing}>
                  <Sparkles size={14} /> Create a {stacks.length ? stacks.join(" + ") + " " : ""}.gitignore
                </Button>
                <p className="mt-1.5 text-[12px] text-faint">Written straight to the folder{stacks.length ? ", tailored to what's inside" : ""}.</p>
              </div>
            )}
          </StatusRow>
        </div>
      )}
    </section>
  );
}

function StatusRow({ ok, okText, missingText, children }: { ok: boolean; okText: string; missingText: string; children?: ReactNode }) {
  return (
    <div className={cn("rounded-[var(--radius-control)] border px-3 py-2.5", ok ? "border-ok/30 bg-ok-soft/40" : "border-warn/40 bg-warn-soft/50")}>
      <div className="flex items-center gap-2 text-[13px]">
        {ok ? <Check size={15} className="shrink-0 text-ok" /> : <FileWarning size={15} className="shrink-0 text-warn" />}
        <span className={cn("font-medium", ok ? "text-foreground" : "text-warn")}>{ok ? okText : missingText}</span>
      </div>
      {children}
    </div>
  );
}
