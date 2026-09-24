import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, Blocks, CheckCircle2, ClipboardPaste, FileText, FolderUp, Sparkles, UploadCloud, X } from "lucide-react";
import { formatBytes } from "@kosh/shared";
import { cn } from "@/lib/cn";
import { GitHubMark } from "@/lib/icons";
import { DUR, EASE } from "@/lib/motion";
import { PHONE_QUERY, useMediaQuery } from "@/lib/useMediaQuery";
import { useData, type DropDraft } from "@/data/store";
import { useUi } from "@/data/ui";
import { Button } from "../ui";
import { collectDrop, collectFiles, groupIntoDrafts } from "./dropUtils";
import { detectHint } from "./detectHint";

const isSaveKind = (kind: string) => kind === "link" || kind === "repo";

export function QuickAdd() {
  const [value, setValue] = useState("");
  const [drafts, setDrafts] = useState<DropDraft[]>([]);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const phone = useMediaQuery(PHONE_QUERY);

  const ingestUrl = useData((s) => s.ingestUrl);
  const finalizeDrafts = useData((s) => s.finalizeDrafts);
  const toast = useUi((s) => s.toast);
  const dismissToast = useUi((s) => s.dismissToast);
  const openItem = useUi((s) => s.openItem);
  const setPalette = useUi((s) => s.setPalette);
  const navigate = useNavigate();

  const hint = detectHint(value);
  const isSave = isSaveKind(hint.kind);
  // Commands and free text are the palette's job (search + commands live there), so the button says so.
  const label = isSave || hint.kind === "empty" ? hint.label : "Search";

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

  /** Save a link/repo (the row lands in the store first) or hand anything else to the palette. */
  const submit = (raw = value) => {
    const text = raw.trim();
    if (!text) return;
    if (!isSaveKind(detectHint(text).kind)) {
      setPalette(true);
      return;
    }
    const { item, duplicate } = ingestUrl(text, { source: "web" });
    setValue("");
    if (duplicate) {
      toast({ message: "Already saved", description: item.title, action: { label: "Open", onClick: () => openItem(item.id) } });
      return;
    }
    // Follow the optimistic row: "Saving…" until enrichment lands (→ "Saved") or the store rolls the
    // row back after a failed POST (it toasts that failure itself, so this one just goes away). The
    // server row replaces the optimistic one in two writes (remove, then upsert), so each change is
    // judged a beat later, once the store has settled.
    const pending = toast({ message: "Saving…", description: item.url, duration: 15000 });
    let done = false;
    const finish = () => {
      if (done) return;
      const row = useData.getState().items.find((i) => i.url === item.url && !i.deletedAt);
      if (row?.status === "enriching") return;
      done = true;
      stop();
      window.clearTimeout(giveUp);
      dismissToast(pending);
      if (row) toast({ message: "Saved", description: row.title, tone: "ok", action: { label: "Open", onClick: () => openItem(row.id) } });
    };
    const stop = useData.subscribe(() => window.setTimeout(finish, 50));
    const giveUp = window.setTimeout(() => {
      done = true;
      stop();
    }, 30_000);
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

  /** Read the clipboard into the bar; with `save`, a pasted link is submitted straight away (one tap). */
  const pasteFromClipboard = async (save = false) => {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (!text) return;
      setValue(text);
      if (save && isSaveKind(detectHint(text).kind)) submit(text);
    } catch {
      toast({ message: "Clipboard unavailable", tone: "warn" });
    }
  };

  return (
    <div className="relative">
      {/* input row */}
      <div
        className={cn(
          "flex items-center gap-2 rounded-[var(--radius-panel)] border-2 bg-surface p-2 pl-3 transition-colors sm:pl-4",
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
          placeholder={phone ? "Paste a link…" : "Paste a link, drop a folder, or type to capture…"}
          className="h-11 w-full min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-faint sm:text-[15px]"
        />
        {/* Phones: one-tap paste-and-save while the bar is empty (long-press → Paste is the fiddly path). */}
        {!value.trim() && (
          <Button variant="outline" size="icon" onClick={() => pasteFromClipboard(true)} aria-label="Paste" className="shrink-0 sm:hidden">
            <ClipboardPaste size={17} />
          </Button>
        )}
        <Button variant="outline" onClick={() => pasteFromClipboard()} className="hidden shrink-0 sm:inline-flex">
          Paste
        </Button>
        <Button variant="outline" size="icon" onClick={() => fileInput.current?.click()} aria-label="Upload files" className="shrink-0">
          <FolderUp size={17} />
        </Button>
        <Button variant={isSave ? "primary" : "secondary"} onClick={() => submit()} disabled={!value.trim()} className="shrink-0">
          {label}
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
            transition={{ duration: DUR.base, ease: EASE.standard }}
            className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface"
          >
            <div className="flex items-center justify-between border-b border-border py-1.5 pl-4 pr-2">
              <span className="text-[13px] font-semibold">
                Ready to save · {drafts.length} item{drafts.length > 1 ? "s" : ""}
              </span>
              <Button variant="ghost" size="icon-sm" onClick={() => setDrafts([])} aria-label="Clear">
                <X size={16} />
              </Button>
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
            transition={{ duration: DUR.base, ease: EASE.standard }}
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
