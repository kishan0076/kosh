import { useEffect, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import { Check, CheckCircle2, ChevronLeft, ChevronRight, CornerDownRight, CornerUpRight, Download, ExternalLink, Eye, MessageSquare, Pencil, Plus, RefreshCw, RotateCcw, RotateCw, Share2, Sparkles, Star, Tag, Trash2, User, Users, X, ZoomIn, ZoomOut } from "lucide-react";
import { formatBytes, normalizeTag, parseTags, isNativeGoogleDoc, driveHasTextSource } from "@kosh/shared";
import { cn } from "@/lib/cn";
import { ago } from "@/lib/time";
import { NodeIcon, tagChipClass } from "./items";
import { Button, Input, Skeleton, Spinner, Textarea } from "@/components/ui";
import { SkeletonText } from "@/components/PageSkeleton";
import { Markdown } from "@/components/markdown";
import { useUi } from "@/data/ui";
import { driveV2Api, kindOf, type DriveComment, type DriveKind, type DriveNode } from "@/data/driveV2Api";
import { useDriveV2 } from "@/data/driveV2";

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 py-1.5 text-[12.5px]">
      <span className="shrink-0 text-muted">{label}</span>
      {/* Long values (an owner's full name, a checksum) wrap rather than vanish behind an ellipsis. */}
      <span className="min-w-0 break-words text-right font-medium">{value}</span>
    </div>
  );
}

/** Inline text-link action (Reply, Resolve, Edit…) with a real hit area: 32px tall, 40px on touch. */
function LinkButton({ onClick, tone = "primary", className, children }: { onClick: () => void; tone?: "primary" | "muted"; className?: string; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "pressable -mx-1.5 inline-flex min-h-8 items-center gap-1 rounded-md px-1.5 text-[11.5px] [@media(pointer:coarse)]:min-h-10",
        tone === "primary" ? "text-primary hover:underline" : "text-muted hover:text-foreground",
        className,
      )}
    >
      {children}
    </button>
  );
}

const KIND_LABEL: Record<DriveKind, string> = { folder: "Folder", doc: "Document", sheet: "Spreadsheet", slide: "Presentation", image: "Image", video: "Video", audio: "Audio", pdf: "PDF", archive: "Archive", other: "File" };

export function DriveDetails({
  node,
  count,
  totalBytes,
  loading,
  onClose,
  onRename,
  onStar,
  onMove,
  onTrash,
  onPreview,
  onShare,
  onUpdateMeta,
  onSetTags,
  onDownload,
}: {
  node: DriveNode | null;
  count: number;
  totalBytes: number;
  loading: boolean;
  onClose: () => void;
  onRename: (node: DriveNode) => void;
  onStar: (node: DriveNode) => void;
  onMove: (node: DriveNode) => void;
  onTrash: (node: DriveNode) => void;
  onPreview: (node: DriveNode) => void;
  onShare: (node: DriveNode) => void;
  onUpdateMeta: (node: DriveNode, patch: { description?: string }) => void;
  onSetTags: (node: DriveNode, tags: string[]) => void;
  onDownload: (node: DriveNode) => void;
}) {
  // Multi-select aggregate
  if (count > 1) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <Header title={`${count} items selected`} onClose={onClose} />
        <div className="p-4 text-[13px] text-muted">Total size: <span className="font-medium text-foreground">{formatBytes(totalBytes)}</span></div>
      </div>
    );
  }
  if (!node) return null;
  const kind = kindOf(node);
  const canPreview = !node.isFolder; // images render inline; everything else embeds via Drive's viewer

  return (
    // Header pinned, body scrolls — as the phone sheet and the desktop column alike.
    <div className="flex h-full min-h-0 flex-col">
      <Header title="Details" onClose={onClose} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col items-center gap-3 border-b border-border px-4 py-5 text-center">
          <span className="grid h-20 w-20 place-items-center overflow-hidden rounded-xl bg-surface-2"><NodeIcon node={node} size={40} thumb /></span>
          <div className="min-w-0">
            <div className="break-words text-[14px] font-semibold">{node.name}</div>
            <div className="mt-0.5 text-[12px] text-muted">{KIND_LABEL[kind]}{!node.isFolder && node.size != null ? ` · ${formatBytes(node.size)}` : ""}</div>
          </div>
          <div className="flex flex-wrap justify-center gap-1.5">
            {canPreview && <QuickAction icon={Eye} label="Preview" onClick={() => onPreview(node)} />}
            <QuickAction icon={Star} label={node.starred ? "Unstar" : "Star"} active={node.starred} onClick={() => onStar(node)} />
            {node.capabilities?.canShare !== false && <QuickAction icon={Share2} label="Share" onClick={() => onShare(node)} />}
            {node.capabilities?.canRename !== false && <QuickAction icon={Pencil} label="Rename" onClick={() => onRename(node)} />}
            {node.capabilities?.canMoveItemWithinDrive !== false && <QuickAction icon={CornerUpRight} label="Move" onClick={() => onMove(node)} />}
            {node.webViewLink && <QuickAction icon={ExternalLink} label="Open" href={node.webViewLink} />}
            {!node.isFolder && <QuickAction icon={Download} label="Download" onClick={() => onDownload(node)} />}
            {node.capabilities?.canTrash !== false && <QuickAction icon={Trash2} label="Trash" danger onClick={() => onTrash(node)} />}
          </div>
        </div>

        <div className="px-4 py-3">
          {/* The full record is still arriving: a bar the height of the old status line, no layout jump. */}
          {loading && <Skeleton className="mb-2 h-3 w-24" />}
          <Fact label="Type" value={KIND_LABEL[kind]} />
          {!node.isFolder && node.size != null && <Fact label="Size" value={formatBytes(node.size)} />}
          <Fact label="Owner" value={node.owners?.[0]?.displayName ?? (node.ownedByMe ? "Me" : "—")} />
          {node.modifiedTime && <Fact label="Modified" value={ago(node.modifiedTime)} />}
          {node.createdTime && <Fact label="Created" value={ago(node.createdTime)} />}
          <Fact label="Shared" value={node.shared ? "Yes" : "No"} />
          {node.md5Checksum && <Fact label="Checksum" value={node.md5Checksum.slice(0, 12) + "…"} />}
        </div>

        <TagsEditor key={`tags-${node.id}`} node={node} onSetTags={(tags) => onSetTags(node, tags)} />

        <NotesEditor key={node.id} node={node} onSave={(desc) => onUpdateMeta(node, { description: desc })} />

        <AiFileSection
          key={`ai-${node.id}`}
          node={node}
          onSaveNote={(text) => onUpdateMeta(node, { description: text })}
          onAddTags={(tags) => onSetTags(node, [...parseTags(node), ...tags])}
        />

        {!node.isFolder && <CommentsSection key={`comments-${node.id}`} node={node} />}

        <div className="border-t border-border px-4 py-3">
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-faint">
            {node.shared ? <Users size={12} /> : <User size={12} />} Sharing
          </div>
          <p className="text-[12.5px] text-muted">{node.shared ? "Shared with others." : "Private to you."} {node.ownedByMe ? "You own this." : ""}</p>
        </div>
      </div>
    </div>
  );
}

/** Editable notes — persisted to the file's Drive `description`. */
function NotesEditor({ node, onSave }: { node: DriveNode; onSave: (desc: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(node.description ?? "");
  const canEdit = node.capabilities?.canEdit !== false;
  return (
    <div className="border-t border-border px-4 py-3">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-faint">Notes</span>
        {canEdit && !editing && (
          <LinkButton onClick={() => { setValue(node.description ?? ""); setEditing(true); }}>
            {node.description ? <><Pencil size={11} /> Edit</> : <><Plus size={12} /> Add</>}
          </LinkButton>
        )}
      </div>
      {editing ? (
        <div className="space-y-2">
          <Textarea autoFocus value={value} onChange={(e) => setValue(e.target.value)} rows={3} maxLength={1000} className="min-h-0 resize-none sm:text-[12.5px]" />
          <div className="flex justify-end gap-1.5">
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)}><X size={13} /> Cancel</Button>
            <Button variant="primary" size="sm" onClick={() => { onSave(value.trim()); setEditing(false); }}><Check size={13} /> Save</Button>
          </div>
        </div>
      ) : node.description ? (
        <p className="whitespace-pre-wrap break-words text-[12.5px] text-muted">{node.description}</p>
      ) : (
        <p className="text-[12.5px] text-faint">No notes yet.</p>
      )}
    </div>
  );
}

/** Author avatar (photo or initial) shared by comments + replies. */
function AuthorAvatar({ name, photo, size = 24 }: { name: string; photo?: string; size?: number }) {
  return photo ? (
    <img src={photo} alt="" referrerPolicy="no-referrer" className="shrink-0 rounded-full" style={{ height: size, width: size }} />
  ) : (
    <span className="grid shrink-0 place-items-center rounded-full bg-primary-soft text-[11px] font-semibold text-primary" style={{ height: size, width: size }}>{name.slice(0, 1).toUpperCase()}</span>
  );
}

/** Comment-card silhouette (avatar, author line, one text line) for the thread list while it loads. */
function CommentSkeleton() {
  return (
    <div className="rounded-[var(--radius-control)] border border-border p-2.5">
      <div className="flex items-start gap-2">
        <Skeleton className="h-6 w-6 shrink-0 rounded-full" />
        <div className="min-w-0 flex-1 space-y-2 pt-1">
          <Skeleton className="h-3 w-2/5" />
          <Skeleton className="h-3 w-full" />
        </div>
      </div>
    </div>
  );
}

/**
 * Inline Drive comment threads. Reads/writes go straight through driveV2Api (like ShareModal) — comments
 * aren't part of the vault store. Renders plain-text `content` only (never Drive's htmlContent) to keep
 * collaborator-authored text un-injectable, per the "never render unsanitized markup" rule.
 */
function CommentsSection({ node }: { node: DriveNode }) {
  const accountId = useDriveV2((s) => s.accountId)!;
  const toast = useUi((s) => s.toast);
  const canComment = node.capabilities?.canComment !== false;
  const [comments, setComments] = useState<DriveComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0); // bumped by "Try again" to refetch the thread list
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null); // comment id currently mutating (reply / resolve)
  const [replyId, setReplyId] = useState<string | null>(null); // which thread's reply box is open
  const [replyDraft, setReplyDraft] = useState("");

  useEffect(() => {
    let live = true;
    setLoading(true);
    // Debounce: browsing files with j/k shouldn't fire a comments request per transient selection —
    // only the node you actually land on (>250ms) is fetched.
    const t = setTimeout(() => {
      driveV2Api
        .listComments(accountId, node.id)
        .then(({ comments }) => { if (live) { setComments([...comments].sort((a, b) => (b.createdTime ?? "").localeCompare(a.createdTime ?? ""))); setError(null); } })
        .catch((err) => { if (live) setError(err instanceof Error ? err.message : "Couldn't load comments."); })
        .finally(() => { if (live) setLoading(false); });
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [accountId, node.id, attempt]);

  async function postComment() {
    const content = draft.trim();
    if (!content || posting) return;
    setPosting(true);
    try {
      const { comment } = await driveV2Api.addComment(accountId, node.id, content);
      setComments((cs) => [comment, ...cs]);
      setError(null); // a transient initial-load error must not keep hiding the list now that we have a comment
      setDraft("");
    } catch (err) {
      toast({ message: err instanceof Error ? err.message : "Couldn't add the comment", tone: "danger" });
    } finally {
      setPosting(false);
    }
  }

  async function postReply(comment: DriveComment) {
    const content = replyDraft.trim();
    if (!content || busyId) return;
    setBusyId(comment.id);
    try {
      const { reply } = await driveV2Api.addReply(accountId, node.id, comment.id, { content });
      setComments((cs) => cs.map((c) => (c.id === comment.id ? { ...c, replies: [...(c.replies ?? []), reply] } : c)));
      setReplyDraft("");
      setReplyId(null);
    } catch (err) {
      toast({ message: err instanceof Error ? err.message : "Couldn't post the reply", tone: "danger" });
    } finally {
      setBusyId(null);
    }
  }

  async function toggleResolve(comment: DriveComment) {
    if (busyId) return;
    const action = comment.resolved ? "reopen" : "resolve";
    setBusyId(comment.id);
    try {
      const { reply } = await driveV2Api.addReply(accountId, node.id, comment.id, { action });
      setComments((cs) => cs.map((c) => (c.id === comment.id ? { ...c, resolved: action === "resolve", replies: [...(c.replies ?? []), reply] } : c)));
    } catch (err) {
      toast({ message: err instanceof Error ? err.message : "Couldn't update the thread", tone: "danger" });
    } finally {
      setBusyId(null);
    }
  }

  // Nothing to show and nothing you can add (e.g. a file type that doesn't support comments) → stay hidden.
  if (!canComment && comments.length === 0) return null;

  return (
    <div className="border-t border-border px-4 py-3">
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-faint">
        <MessageSquare size={12} /> Comments{comments.length > 0 && <span className="text-faint">· {comments.length}</span>}
      </div>

      {/* Wait for the initial load before offering the composer, so a post can't be clobbered by a
          slower in-flight list fetch. */}
      {canComment && !loading && (
        <div className="mb-3 space-y-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={2}
            maxLength={4000}
            disabled={posting}
            placeholder="Add a comment…"
            className="min-h-0 resize-none disabled:opacity-60 sm:text-[12.5px]"
          />
          <div className="flex justify-end">
            <Button variant="primary" size="sm" disabled={!draft.trim()} loading={posting} onClick={() => void postComment()}>
              <MessageSquare size={13} /> Comment
            </Button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="space-y-3" role="status" aria-busy="true" aria-label="Loading comments">
          <CommentSkeleton />
          <CommentSkeleton />
        </div>
      ) : error ? (
        <div className="flex flex-wrap items-center gap-2 py-1 text-[12.5px] text-danger">
          <span className="min-w-0 flex-1">{error}</span>
          <Button variant="outline" size="sm" onClick={() => setAttempt((a) => a + 1)}><RefreshCw size={14} /> Try again</Button>
        </div>
      ) : comments.length === 0 ? (
        <p className="text-[12.5px] text-faint">No comments yet.</p>
      ) : (
        <ul className="space-y-3">
          {comments.map((c) => {
            const replies = (c.replies ?? []).filter((r) => r.content); // hide bare resolve/reopen markers (deleted ones are already excluded server-side)
            const authorName = c.author?.displayName || "Someone";
            return (
              <li key={c.id} className={cn("rounded-[var(--radius-control)] border border-border p-2.5", c.resolved && "opacity-70")}>
                <div className="flex items-start gap-2">
                  <AuthorAvatar name={authorName} photo={c.author?.photoLink} />
                  <div className="min-w-0 flex-1">
                    {/* Name gives way; the timestamp and badge never wrap. */}
                    <div className="flex items-center gap-1.5">
                      <span className="min-w-0 truncate text-[12.5px] font-medium">{authorName}</span>
                      {c.createdTime && <span className="shrink-0 whitespace-nowrap text-[11px] text-faint">· {ago(c.createdTime)}</span>}
                      {c.resolved && <span className="inline-flex shrink-0 items-center gap-0.5 rounded-[var(--radius-chip)] bg-ok-soft px-1.5 py-0.5 text-[11px] font-medium text-ok"><CheckCircle2 size={10} /> Resolved</span>}
                    </div>
                    {c.quotedFileContent?.value && <p className="mt-1 border-l-2 border-border pl-2 text-[11.5px] italic text-muted">{c.quotedFileContent.value}</p>}
                    {c.content && <p className="mt-0.5 whitespace-pre-wrap break-words text-[12.5px]">{c.content}</p>}

                    {replies.length > 0 && (
                      <ul className="mt-2 space-y-2 border-l border-border pl-2.5">
                        {replies.map((r) => (
                          <li key={r.id} className="flex items-start gap-2">
                            <AuthorAvatar name={r.author?.displayName || "Someone"} photo={r.author?.photoLink} size={20} />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                <span className="min-w-0 truncate text-[12px] font-medium">{r.author?.displayName || "Someone"}</span>
                                {r.createdTime && <span className="shrink-0 whitespace-nowrap text-[11px] text-faint">· {ago(r.createdTime)}</span>}
                              </div>
                              <p className="mt-0.5 whitespace-pre-wrap break-words text-[12px]">{r.content}</p>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}

                    {canComment && (
                      replyId === c.id ? (
                        <div className="mt-2 space-y-1.5">
                          <Textarea autoFocus value={replyDraft} onChange={(e) => setReplyDraft(e.target.value)} rows={2} maxLength={4000} placeholder="Reply…" disabled={busyId === c.id} className="min-h-0 resize-none sm:text-[12px]" />
                          <div className="flex justify-end gap-1.5">
                            <Button variant="ghost" size="sm" disabled={busyId === c.id} onClick={() => { setReplyId(null); setReplyDraft(""); }}><X size={12} /> Cancel</Button>
                            <Button variant="primary" size="sm" disabled={!replyDraft.trim()} loading={busyId === c.id} onClick={() => void postReply(c)}><CornerDownRight size={12} /> Reply</Button>
                          </div>
                        </div>
                      ) : busyId === c.id ? (
                        <div className="mt-2 flex min-h-8 items-center"><Spinner size={13} className="text-muted" /></div>
                      ) : (
                        <div className="mt-1 flex items-center gap-4">
                          <LinkButton onClick={() => { setReplyId(c.id); setReplyDraft(""); }}><CornerDownRight size={11} /> Reply</LinkButton>
                          <LinkButton tone="muted" onClick={() => void toggleResolve(c)}>
                            {c.resolved ? <><RotateCcw size={11} /> Reopen</> : <><CheckCircle2 size={11} /> Resolve</>}
                          </LinkButton>
                        </div>
                      )
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Flatten the AI summary's light markdown into plain text for the Notes field (which renders as-is):
 *  headings/bold lose their markers, list dashes become bullets. */
function summaryToPlainText(md: string): string {
  return md
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1$2")
    .replace(/^\s*[-*]\s+/gm, "• ")
    .trim();
}

/**
 * AI summary + tag suggestions for a single file. Self-contained (calls driveV2Api directly, like
 * CommentsSection). Hidden unless the server has AI configured and the file has a readable text form.
 * Renders the summary through <Markdown> (never raw HTML) and offers to save it to notes / apply tags.
 */
function AiFileSection({ node, onSaveNote, onAddTags }: { node: DriveNode; onSaveNote: (text: string) => void; onAddTags: (tags: string[]) => void }) {
  const accountId = useDriveV2((s) => s.accountId)!;
  const aiEnabled = useDriveV2((s) => s.aiEnabled);
  const toast = useUi((s) => s.toast);
  const [summary, setSummary] = useState("");
  const [suggested, setSuggested] = useState<string[]>([]);
  const [ran, setRan] = useState(false);
  const [busy, setBusy] = useState(false);
  const [savedNote, setSavedNote] = useState(false);

  if (!aiEnabled || node.isFolder || !driveHasTextSource(node.mimeType)) return null;

  async function run() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await driveV2Api.summarizeFile(accountId, node.id);
      setSummary(res.summary);
      // Only surface suggestions the file doesn't already carry, normalized + de-duplicated.
      const have = new Set(parseTags(node));
      setSuggested([...new Set(res.suggestedTags.map(normalizeTag))].filter((t) => t && !have.has(t)));
      setRan(true);
      setSavedNote(false);
    } catch (err) {
      toast({ message: err instanceof Error ? err.message : "Couldn't generate a summary", tone: "danger" });
    } finally {
      setBusy(false);
    }
  }

  function saveNote() {
    if (!summary) return;
    // Notes are plain text, so the markdown is flattened first (no literal ** and - in the note).
    const plain = summaryToPlainText(summary);
    // Never clobber notes the user already wrote — append under a separator (and don't double-append).
    const existing = node.description?.trim() ?? "";
    if (existing.includes(plain)) { setSavedNote(true); return; }
    onSaveNote(existing ? `${existing}\n\n${plain}` : plain);
    setSavedNote(true);
    toast({ message: existing ? "Summary added to notes" : "Summary saved to notes", tone: "ok" });
  }

  function addTag(tag: string) {
    onAddTags([tag]);
    setSuggested((s) => s.filter((t) => t !== tag));
  }
  function addAll() {
    if (!suggested.length) return;
    onAddTags(suggested);
    setSuggested([]);
  }

  return (
    <div className="border-t border-border px-4 py-3">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-faint"><Sparkles size={12} /> AI</span>
        {ran && !busy && <LinkButton onClick={() => void run()}>Regenerate</LinkButton>}
      </div>

      {!ran ? (
        <Button variant="outline" size="sm" onClick={() => void run()} loading={busy}>
          <Sparkles size={14} /> Summarize &amp; suggest tags
        </Button>
      ) : busy ? (
        <SkeletonText lines={3} className="py-1" />
      ) : (
        <div className="space-y-2.5">
          {summary ? (
            <div className="rounded-[var(--radius-control)] border border-primary/20 bg-primary-soft/40 p-2.5">
              <Markdown className="text-[12.5px]">{summary}</Markdown>
              <div className="mt-2 flex justify-end">
                <Button variant="ghost" size="sm" onClick={saveNote} disabled={savedNote}>
                  {savedNote ? <><Check size={13} /> Saved to notes</> : <><Pencil size={13} /> {node.description?.trim() ? "Add to notes" : "Save to notes"}</>}
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-[12.5px] text-faint">No summary was produced.</p>
          )}

          {suggested.length > 0 && (
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[11px] text-muted">Suggested tags</span>
                <LinkButton onClick={addAll}>Add all</LinkButton>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {suggested.map((t) => (
                  <button
                    key={t}
                    onClick={() => addTag(t)}
                    className="pressable inline-flex min-h-7 items-center gap-1 rounded-[var(--radius-chip)] border border-dashed border-border-strong px-2 py-0.5 text-[11.5px] font-medium text-muted transition-colors hover:border-primary hover:text-primary [@media(pointer:coarse)]:min-h-8"
                  >
                    <Plus size={10} /> {t}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Editable tag chips — persisted to the file's app-private Drive `appProperties`. */
function TagsEditor({ node, onSetTags }: { node: DriveNode; onSetTags: (tags: string[]) => void }) {
  const canEdit = node.capabilities?.canEdit !== false;
  const tags = parseTags(node);
  const [draft, setDraft] = useState("");
  const add = () => {
    const t = normalizeTag(draft);
    setDraft("");
    if (t && !tags.includes(t)) onSetTags([...tags, t]);
  };
  return (
    <div className="border-t border-border px-4 py-3">
      <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-faint"><Tag size={12} /> Tags</div>
      {(tags.length > 0 || !canEdit) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {tags.map((t) => (
            <span key={t} className={cn("inline-flex items-center gap-1 rounded-[var(--radius-chip)] py-1 pl-2 pr-1 text-[11.5px] font-medium", tagChipClass(t))}>
              {t}
              {/* The × keeps its 11px glyph but gets a padded, round hit area. */}
              {canEdit && (
                <button
                  onClick={() => onSetTags(tags.filter((x) => x !== t))}
                  aria-label={`Remove tag ${t}`}
                  className="pressable -my-1 grid h-6 w-6 place-items-center rounded-full opacity-70 transition-opacity hover:bg-foreground/10 hover:opacity-100 [@media(pointer:coarse)]:-my-2 [@media(pointer:coarse)]:h-8 [@media(pointer:coarse)]:w-8"
                ><X size={11} /></button>
              )}
            </span>
          ))}
          {!tags.length && <span className="text-[12.5px] text-faint">No tags.</span>}
        </div>
      )}
      {canEdit && (
        <div className="mt-2 flex items-center gap-1.5">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
            placeholder="Add a tag…"
            maxLength={32}
            className="min-w-0 flex-1 bg-surface-2 sm:h-8 sm:text-[12.5px]"
          />
          <Button variant="ghost" size="sm" disabled={!draft.trim()} onClick={add}><Plus size={13} /> Add</Button>
        </div>
      )}
    </div>
  );
}

function Header({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="flex shrink-0 items-center justify-between border-b border-border py-2 pl-4 pr-2">
      <span className="text-[13px] font-semibold">{title}</span>
      {/* The sheet's only close affordance: a full 40px target. */}
      <button onClick={onClose} className="pressable grid h-10 w-10 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-foreground" aria-label="Close details"><X size={18} /></button>
    </div>
  );
}

function QuickAction({ icon: Icon, label, onClick, href, danger, active }: { icon: typeof Star; label: string; onClick?: () => void; href?: string; danger?: boolean; active?: boolean }) {
  const cls = cn(
    "pressable grid h-9 w-9 place-items-center rounded-[var(--radius-control)] border border-border transition-colors [@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:w-10",
    danger ? "text-muted hover:border-danger/40 hover:bg-danger-soft hover:text-danger" : active ? "border-gold/40 bg-gold-soft text-gold" : "text-muted hover:bg-surface-2 hover:text-foreground",
  );
  if (href) return <a href={href} target="_blank" rel="noreferrer noopener" className={cls} aria-label={label} title={label}><Icon size={16} /></a>;
  return <button onClick={onClick} className={cls} aria-label={label} title={label}><Icon size={16} /></button>;
}

/** The Google embed URL for a node — native Docs/Sheets/Slides use docs.google.com; the rest use Drive. */
function embedUrl(node: DriveNode): string | null {
  const id = node.id;
  switch (node.mimeType) {
    case "application/vnd.google-apps.document": return `https://docs.google.com/document/d/${id}/preview`;
    case "application/vnd.google-apps.spreadsheet": return `https://docs.google.com/spreadsheets/d/${id}/preview`;
    case "application/vnd.google-apps.presentation": return `https://docs.google.com/presentation/d/${id}/preview`;
    case "application/vnd.google-apps.folder": return null;
    default: return `https://drive.google.com/file/d/${id}/preview`; // PDF, video, and most binary types
  }
}

/* ── Quick Look ── */

const TEXT_EXT = new Set(["txt", "log", "json", "xml", "yaml", "yml", "toml", "ini", "env", "js", "ts", "tsx", "jsx", "mjs", "cjs", "css", "scss", "html", "py", "rb", "go", "rs", "java", "kt", "c", "cpp", "h", "hpp", "sh", "bash", "sql", "swift", "php"]);
const TEXT_PREVIEW_CAP = 2_000_000; // don't stream huge files into memory for a peek

/** Which inline Quick Look renderer fits a file, if any (native rendering beats a Drive iframe). */
function textPreviewKind(node: DriveNode): "markdown" | "csv" | "code" | null {
  // Native Google docs have no binary bytes (alt=media 403s) — they must use the Drive iframe embed,
  // even when their NAME ends in .csv/.md/etc.
  if (node.isFolder || isNativeGoogleDoc(node.mimeType)) return null;
  if (node.size != null && node.size > TEXT_PREVIEW_CAP) return null;
  const mime = node.mimeType || "";
  const ext = (node.name.split(".").pop() || "").toLowerCase();
  if (mime === "text/markdown" || ext === "md" || ext === "markdown") return "markdown";
  if (mime === "text/csv" || ext === "csv") return "csv";
  if (mime === "text/tab-separated-values" || ext === "tsv") return "csv";
  if (mime.startsWith("text/") || mime === "application/json" || mime === "application/xml" || TEXT_EXT.has(ext)) return "code";
  return null;
}

/** Tiny quote-aware CSV/TSV parser — enough for a read-only preview (first rows only). */
function parseDelimited(text: string, delimiter: string, maxRows: number): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length && rows.length < maxRows; i++) {
    const c = text[i]!;
    if (inQuotes) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === delimiter) { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if ((field || row.length) && rows.length < maxRows) { row.push(field); rows.push(row); }
  return rows;
}

// Preview-chrome icon buttons/links: 36px at rest, the 40px floor on touch.
const CHROME_BTN = "pressable grid h-9 w-9 shrink-0 place-items-center rounded-md text-white transition-colors hover:bg-white/10 disabled:opacity-30 [@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:w-10";

/** A preview-chrome icon button (module-scope so its type is stable across PreviewOverlay re-renders). */
function ChromeBtn({ onClick, label, disabled, className, children }: { onClick: () => void; label: string; disabled?: boolean; className?: string; children: ReactNode }) {
  return (
    <button onClick={onClick} disabled={disabled} aria-label={label} className={cn(CHROME_BTN, className)}>{children}</button>
  );
}

const SWIPE_PX = 60; // horizontal drag past this pages the filmstrip

/** Full-screen Quick Look: native rendering for images (zoom/rotate) and text/markdown/code/CSV; a
 *  Drive iframe for PDF/Docs/Sheets/Slides/video; filmstrip prev/next across the visible list. */
export function PreviewOverlay({ node, list = [], onClose }: { node: DriveNode; list?: DriveNode[]; onClose: () => void }) {
  const isImage = node.mimeType.startsWith("image/");
  const imgSrc = node.thumbnailLink?.replace(/=s\d+$/, "=s1600") ?? node.webContentLink;
  const textKind = !isImage ? textPreviewKind(node) : null;
  const frame = !isImage && !textKind ? embedUrl(node) : null;

  const [loading, setLoading] = useState(!isImage && !textKind && !!frame);
  const [text, setText] = useState<string | null>(null);
  const [textErr, setTextErr] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [rot, setRot] = useState(0);

  // Filmstrip position within the (already sorted+filtered) visible list.
  const idx = list.findIndex((n) => n.id === node.id);
  const go = (delta: number) => { if (idx < 0) return; const t = list[idx + delta]; if (t) useDriveV2.getState().setPreview(t); };
  const hasPrev = idx > 0;
  const hasNext = idx >= 0 && idx < list.length - 1;
  const filmstrip = list.length > 1 && idx >= 0;
  // Swipe between files on images (an iframe swallows the gesture; a zoomed image should pan, not page).
  const swipeable = filmstrip && isImage && zoom === 1;

  // Reset per-node view state whenever the previewed node changes (filmstrip paging reuses this overlay).
  useEffect(() => { setZoom(1); setRot(0); setText(null); setTextErr(false); setLoading(!isImage && !textKind && !!frame); }, [node.id, isImage, textKind, frame]);

  // Fetch text content for the native text/code/CSV renderer.
  useEffect(() => {
    if (!textKind) return;
    let live = true;
    useDriveV2.getState().fetchFileText(node).then((t) => { if (live) setText(t); }).catch(() => { if (live) setTextErr(true); });
    return () => { live = false; };
  }, [node, textKind]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") { e.preventDefault(); go(1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); go(-1); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose, idx, list]);

  // Zoom/rotate live in the header on wide screens and in the bottom toolbar on phones.
  const imageTools = isImage && (
    <>
      <ChromeBtn onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))} label="Zoom out"><ZoomOut size={17} /></ChromeBtn>
      <ChromeBtn onClick={() => setZoom((z) => Math.min(5, z + 0.25))} label="Zoom in"><ZoomIn size={17} /></ChromeBtn>
      <ChromeBtn onClick={() => setRot((r) => (r + 90) % 360)} label="Rotate"><RotateCw size={17} /></ChromeBtn>
    </>
  );
  const counter = filmstrip && <span className="shrink-0 tabular text-[12px] text-white/60">{idx + 1} / {list.length}</span>;

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-black/80 backdrop-blur-sm" onClick={onClose}>
      {/* Top bar: on phones the name + close share the first row and the actions wrap to a second one;
          from sm up it's a single row. Padded past the notch. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 pb-2 pt-[max(0.5rem,var(--safe-top))] text-white sm:py-3" onClick={(e) => e.stopPropagation()}>
        <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">{node.name}</span>
        <ChromeBtn onClick={onClose} label="Close preview" className="sm:order-last"><X size={18} /></ChromeBtn>
        <div className="flex basis-full items-center justify-end gap-1 sm:basis-auto">
          <span className="hidden sm:contents">{counter}</span>
          <span className="hidden sm:contents">{imageTools}</span>
          {!node.isFolder && <ChromeBtn onClick={() => void useDriveV2.getState().downloadNode(node.id)} label="Download"><Download size={17} /></ChromeBtn>}
          <ChromeBtn onClick={() => void useDriveV2.getState().toggleStar(node.id)} label={node.starred ? "Unstar" : "Star"}><Star size={17} className={cn(node.starred && "fill-gold text-gold")} /></ChromeBtn>
          {node.webViewLink && (
            <>
              <a href={node.webViewLink} target="_blank" rel="noreferrer noopener" onClick={(e) => e.stopPropagation()} aria-label="Open in Drive" title="Open in Drive" className={cn(CHROME_BTN, "sm:hidden")}><ExternalLink size={17} /></a>
              <a href={node.webViewLink} target="_blank" rel="noreferrer noopener" onClick={(e) => e.stopPropagation()} className="pressable hidden items-center gap-1.5 whitespace-nowrap rounded-[var(--radius-control)] bg-white/10 px-3 py-1.5 text-[12.5px] hover:bg-white/20 sm:inline-flex [@media(pointer:coarse)]:min-h-10">
                <ExternalLink size={14} /> Open in Drive
              </a>
            </>
          )}
        </div>
      </div>

      <motion.div
        className="relative flex min-h-0 flex-1 items-center justify-center p-4 sm:p-6"
        onClick={(e) => e.stopPropagation()}
        drag={swipeable ? "x" : false}
        dragSnapToOrigin
        dragElastic={0.15}
        onDragEnd={(_, info) => {
          if (info.offset.x < -SWIPE_PX && hasNext) go(1);
          else if (info.offset.x > SWIPE_PX && hasPrev) go(-1);
        }}
      >
        {/* Filmstrip arrows (sm+): a solid chip so they stay visible over a white PDF/Docs card. On phones
            the bottom bar below carries Previous / Next instead. */}
        {hasPrev && <button onClick={() => go(-1)} aria-label="Previous" className="pressable absolute left-2 top-1/2 z-10 hidden h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-black/60 text-white shadow-[var(--shadow-pop)] backdrop-blur hover:bg-black/75 sm:grid"><ChevronLeft size={22} /></button>}
        {hasNext && <button onClick={() => go(1)} aria-label="Next" className="pressable absolute right-2 top-1/2 z-10 hidden h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-black/60 text-white shadow-[var(--shadow-pop)] backdrop-blur hover:bg-black/75 sm:grid"><ChevronRight size={22} /></button>}

        {isImage && imgSrc ? (
          <img
            src={imgSrc}
            alt={node.name}
            referrerPolicy="no-referrer"
            draggable={false}
            style={{ transform: `scale(${zoom}) rotate(${rot}deg)` }}
            className="max-h-full max-w-full rounded-lg object-contain shadow-2xl transition-transform duration-[var(--motion-base)] ease-[var(--ease-standard)] motion-reduce:transition-none"
          />
        ) : textKind ? (
          <div className="h-full w-full max-w-4xl overflow-auto rounded-lg bg-surface p-5 text-foreground shadow-2xl">
            {text == null && !textErr ? (
              <SkeletonText lines={8} />
            ) : textErr ? (
              <div className="grid h-full place-items-center text-[13px] text-muted">Couldn't load a preview. Open it in Drive instead.</div>
            ) : textKind === "markdown" ? (
              <Markdown>{text!}</Markdown>
            ) : textKind === "csv" ? (
              <CsvTable rows={parseDelimited(text!, node.mimeType === "text/tab-separated-values" || node.name.toLowerCase().endsWith(".tsv") ? "\t" : ",", 200)} />
            ) : (
              <pre className="whitespace-pre-wrap break-words font-mono text-[12.5px] leading-relaxed">{text}</pre>
            )}
          </div>
        ) : frame ? (
          <div className="relative h-full w-full max-w-5xl">
            {/* The loader sits ON TOP of the (white, otherwise blank) embed until it has loaded. */}
            {loading && (
              <div className="absolute inset-0 z-10 grid place-items-center rounded-lg bg-surface text-muted" role="status" aria-busy="true">
                <div className="flex items-center gap-2 text-[13px]"><Spinner size={18} className="text-primary" /> Loading preview…</div>
              </div>
            )}
            <iframe
              src={frame}
              title={node.name}
              onLoad={() => setLoading(false)}
              className={cn("h-full w-full rounded-lg bg-white shadow-2xl transition-opacity duration-[var(--motion-base)]", loading && "opacity-0")}
              allow="autoplay"
              sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-downloads"
            />
          </div>
        ) : (
          <div className="text-center text-white/80">
            <div className="mb-2 text-[15px] font-medium">No inline preview</div>
            <p className="text-[13px] text-white/60">Open it in Google Drive to view this item.</p>
          </div>
        )}
      </motion.div>

      {/* Phone toolbar: filmstrip paging + image tools, above the home indicator. */}
      {(filmstrip || isImage) && (
        <div className="flex items-center justify-between gap-2 px-4 pt-2 pb-[max(0.75rem,var(--safe-bottom))] text-white sm:hidden" onClick={(e) => e.stopPropagation()}>
          {filmstrip ? <ChromeBtn onClick={() => go(-1)} label="Previous" disabled={!hasPrev}><ChevronLeft size={22} /></ChromeBtn> : <span className="w-9" />}
          <div className="flex min-w-0 items-center justify-center gap-2">
            {imageTools}
            {counter}
          </div>
          {filmstrip ? <ChromeBtn onClick={() => go(1)} label="Next" disabled={!hasNext}><ChevronRight size={22} /></ChromeBtn> : <span className="w-9" />}
        </div>
      )}
    </div>
  );
}

/** CSV/TSV Quick Look: one line per row (no wrapping), long cells clipped, header row stuck to the top. */
function CsvTable({ rows }: { rows: string[][] }) {
  const [head, ...body] = rows;
  return (
    <table className="min-w-full border-collapse text-[12.5px]">
      {head && (
        <thead>
          <tr>
            {head.map((cell, ci) => <th key={ci} className="sticky top-0 z-10 whitespace-nowrap border border-border bg-surface-2 px-2 py-1 text-left font-semibold"><span className="block max-w-[260px] truncate">{cell}</span></th>)}
          </tr>
        </thead>
      )}
      <tbody>
        {body.map((r, ri) => (
          <tr key={ri}>
            {r.map((cell, ci) => <td key={ci} className="whitespace-nowrap border border-border px-2 py-1 align-top"><span className="block max-w-[260px] truncate">{cell}</span></td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
