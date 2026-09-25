import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { CheckCircle2, Home, LibraryBig, XCircle } from "lucide-react";
import { useData } from "@/data/store";
import { useUi } from "@/data/ui";
import { Button, Spinner } from "@/components/ui";

const firstUrl = (s: string): string | undefined => s.match(/https?:\/\/[^\s]+/i)?.[0];

type Status = { kind: "working" } | { kind: "done"; duplicate: boolean; itemId: string } | { kind: "empty" };

/** PWA Web Share Target (§9.2). Android shares land here as /share?title&text&url;
 *  we pull out the URL, save it, and bounce to the Library. */
export function Share() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const ingestUrl = useData((s) => s.ingestUrl);
  const hydrated = useData((s) => s.hydrated);
  const openItem = useUi((s) => s.openItem);
  const toast = useUi((s) => s.toast);
  const [status, setStatus] = useState<Status>({ kind: "working" });
  // Which share was ingested (one save per share, even when StrictMode runs the effect twice) and where
  // it leads; the redirect timer is armed on every effect run so a cleanup can't strand the page.
  const handled = useRef<string | null>(null);
  const result = useRef<{ duplicate: boolean; itemId: string } | null>(null);

  const follow = (r: { duplicate: boolean; itemId: string }) => (r.duplicate ? openItem(r.itemId) : navigate("/library"));

  useEffect(() => {
    if (!hydrated) return;
    const key = params.toString();
    if (handled.current !== key) {
      handled.current = key;
      const url = params.get("url")?.trim() || firstUrl(params.get("text") ?? "") || firstUrl(params.get("title") ?? "");
      if (!url) {
        setStatus({ kind: "empty" });
        return;
      }
      const note = (params.get("text") ?? "").replace(url, "").trim() || undefined;
      const { item, duplicate } = ingestUrl(url, { source: "share", note });
      result.current = { duplicate, itemId: item.id };
      setStatus({ kind: "done", duplicate, itemId: item.id });
      toast({ message: duplicate ? "Already saved" : "Saved to Kosh", description: item.title ?? url, tone: "ok" });
    }
    const r = result.current;
    if (!r) return;
    const t = window.setTimeout(() => follow(r), 900);
    return () => window.clearTimeout(t);
  }, [params, hydrated, ingestUrl, navigate, openItem, toast]);

  return (
    <div role="status" aria-live="polite" className="mx-auto flex max-w-md flex-col items-center justify-center rounded-[var(--radius-card)] border border-border bg-surface px-6 py-16 text-center">
      {status.kind === "working" && (
        <>
          <Spinner size={28} className="mb-4 text-primary" />
          <h1 className="text-lg font-semibold">Saving to Kosh…</h1>
          <p className="mt-1 text-sm text-muted">Capturing what you shared.</p>
        </>
      )}
      {status.kind === "done" && (
        <>
          <CheckCircle2 size={40} className="mb-3 text-ok" />
          <h1 className="text-lg font-semibold">{status.duplicate ? "Already in Kosh" : "Saved ✓"}</h1>
          <p className="mt-1 text-sm text-muted">{status.duplicate ? "Opening the saved item…" : "Taking you to your library…"}</p>
          <Button variant="primary" size="lg" className="mt-5" onClick={() => follow(status)}>
            <LibraryBig size={16} /> {status.duplicate ? "Open item" : "Open library"}
          </Button>
        </>
      )}
      {status.kind === "empty" && (
        <>
          <XCircle size={40} className="mb-3 text-warn" />
          <h1 className="text-lg font-semibold">Nothing to save</h1>
          <p className="mt-1 text-sm text-muted">That share didn't contain a link.</p>
          <Button variant="primary" size="lg" className="mt-5" onClick={() => navigate("/")}>
            <Home size={16} /> Go home
          </Button>
        </>
      )}
    </div>
  );
}
