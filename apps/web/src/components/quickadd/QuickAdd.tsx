import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, Blocks, CheckCircle2, FileText, FolderUp, Sparkles, UploadCloud, X } from "lucide-react";
import { formatBytes } from "@kosh/shared";
import { cn } from "@/lib/cn";
import { GitHubMark } from "@/lib/icons";
import { useData, type DropDraft } from "@/data/store";
import { useUi } from "@/data/ui";
import { Button } from "../ui";
import { collectDrop, collectFiles, groupIntoDrafts } from "./dropUtils";
import { detectHint } from "./detectHint";

export function QuickAdd() {
  const [value, setValue] = useState("");
  const [drafts, setDrafts] = useState<DropDraft[]>([]);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);

  const ingestUrl = useData((s) => s.ingestUrl);
  const finalizeDrafts = useData((s) => s.finalizeDrafts);
  const toast = useUi((s) => s.toast);
  const openItem = useUi((s) => s.openItem);
  const navigate = useNavigate();

  const hint = detectHint(value);

  useEffect(() => {
    const onDragEnter = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes("Files")) return;
      dragDepth.current += 1;
      setDragging(true);
    };
    const onDragLeave = () => {
      dragDepth.current -= 1;
      if (dragDepth.current <= 0) setDragging(false);
    };
    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
    };
    const onDrop = async (e: DragEvent) => {
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      if (!e.dataTransfer) return;
      const collected = await collectDrop(e.dataTransfer);
      if (collected.length) setDrafts(groupIntoDrafts(collected));
    };
    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
    };
  }, []);

  const submit = () => {
    if (!value.trim()) return;
    if (hint.kind === "link" || hint.kind === "repo") {
      const { item, duplicate } = ingestUrl(value.trim(), { source: "web" });
      if (duplicate) {
        toast({ message: "Already saved", description: item.title, action: { label: "Open", onClick: () => openItem(item.id) } });
      } else {
        toast({ message: "Saving…", description: item.url, tone: "ok" });
      }
      setValue("");
    } else {
      toast({ message: "That doesn't look like a link", description: "Paste a URL, drop files, or press ⌘K to search.", tone: "warn" });
    }
  };

  const pickFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const collected = await collectFiles(files);
    if (collected.length) setDrafts(groupIntoDrafts(collected));
  };

  const saveDrafts = () => {
    const created = finalizeDrafts(drafts, "web");
    toast({ message: `Saved ${created.length} item${created.length > 1 ? "s" : ""}`, tone: "ok" });
    setDrafts([]);
    navigate("/library");
  };

  const pasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) setValue(text);
    } catch {
      toast({ message: "Clipboard unavailable", tone: "warn" });
    }
  };

  return (
    <div className="relative">
      {/* input row */}
      <div
        className={cn(
          "flex items-center gap-2 rounded-[var(--radius-panel)] border-2 bg-surface p-2 pl-4 transition-colors",
          dragging ? "border-gold" : "border-border focus-within:border-primary",
        )}
      >
        <span className="shrink-0 text-muted">
          {hint.kind === "repo" ? <GitHubMark size={19} /> : hint.kind === "command" ? <Sparkles size={19} className="text-primary" /> : <UploadCloud size={19} />}
        </span>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          onPaste={(e) => {
            const text = e.clipboardData.getData("text");
            if (/^https?:\/\//i.test(text.trim())) {
              // auto-save on paste of a bare URL
              setValue(text.trim());
            }
          }}
          placeholder="Paste a link, drop a folder, or type to capture…"
          className="h-11 flex-1 bg-transparent text-[15px] outline-none placeholder:text-faint"
        />
        <button
          onClick={pasteFromClipboard}
          className="hidden h-9 items-center gap-1.5 rounded-[var(--radius-control)] border border-border px-3 text-[13px] text-muted hover:bg-surface-2 sm:inline-flex"
        >
          Paste
        </button>
        <button
          onClick={() => fileInput.current?.click()}
          className="grid h-9 w-9 place-items-center rounded-[var(--radius-control)] border border-border text-muted hover:bg-surface-2"
          aria-label="Upload files"
        >
          <FolderUp size={17} />
        </button>
        <Button variant={hint.kind === "link" || hint.kind === "repo" ? "primary" : "secondary"} onClick={submit} disabled={!value.trim()}>
          {hint.label}
        </Button>
        <input
          ref={fileInput}
          type="file"
          multiple
          // @ts-expect-error non-standard directory attributes
          webkitdirectory=""
          directory=""
          className="hidden"
          onChange={(e) => pickFiles(e.target.files)}
        />
      </div>

      {/* drop tray */}
      <AnimatePresence>
        {drafts.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0, marginTop: 0 }}
            animate={{ opacity: 1, height: "auto", marginTop: 12 }}
            exit={{ opacity: 0, height: 0, marginTop: 0 }}
            transition={{ duration: 0.25, ease: [0.2, 0.8, 0.2, 1] }}
            className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface"
          >
            <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
              <span className="text-[13px] font-semibold">
                Ready to save · {drafts.length} item{drafts.length > 1 ? "s" : ""}
              </span>
              <button onClick={() => setDrafts([])} className="rounded-md p-1 text-faint hover:bg-surface-2 hover:text-foreground">
                <X size={16} />
              </button>
            </div>
            <div className="max-h-64 space-y-1.5 overflow-y-auto p-3">
              {drafts.map((d, i) => (
                <TrayRow key={i} draft={d} />
              ))}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-2.5">
              <Button variant="ghost" size="sm" onClick={() => setDrafts([])}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" onClick={saveDrafts}>
                Save all
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* global drop overlay */}
      <AnimatePresence>
        {dragging && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="pointer-events-none fixed inset-0 z-[65] grid place-items-center bg-background/70 backdrop-blur-sm"
          >
            <div className="flex flex-col items-center gap-3 rounded-[var(--radius-panel)] border-2 border-dashed border-gold bg-surface px-12 py-10 shadow-[var(--shadow-pop)]">
              <UploadCloud size={40} className="text-gold" />
              <div className="font-display text-lg font-semibold">Drop to add to Kosh</div>
              <div className="text-[13px] text-muted">Folders with a SKILL.md become skills · everything else is saved as files</div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function TrayRow({ draft }: { draft: DropDraft }) {
  if (draft.kind === "skill") {
    const risky = draft.scan.risky;
    const ok = draft.lint.ok;
    return (
      <div className="flex items-center gap-3 rounded-[var(--radius-control)] border border-border bg-surface-2 px-3 py-2">
        <Blocks size={16} className="shrink-0 text-tool-claude" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium">{draft.name}</div>
          <div className="text-[11px] text-muted">
            skill · {draft.files.length} file{draft.files.length > 1 ? "s" : ""}
          </div>
        </div>
        {ok ? (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-ok">
            <CheckCircle2 size={13} /> valid
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-danger">
            <AlertTriangle size={13} /> {draft.lint.errors.length} errors
          </span>
        )}
        {risky && (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-warn">
            <AlertTriangle size={13} /> {draft.scan.findings.length}
          </span>
        )}
      </div>
    );
  }
  return (
    <div className="flex items-center gap-3 rounded-[var(--radius-control)] border border-border bg-surface-2 px-3 py-2">
      <FileText size={16} className="shrink-0 text-muted" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium">{draft.path}</div>
        <div className="text-[11px] text-muted">file · {formatBytes(draft.size)}</div>
      </div>
    </div>
  );
}
