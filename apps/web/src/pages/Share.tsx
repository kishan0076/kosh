import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { CheckCircle2, Share2, XCircle } from "lucide-react";
import { useData } from "@/data/store";
import { useUi } from "@/data/ui";
import { Spinner } from "@/components/ui";

const firstUrl = (s: string): string | undefined => s.match(/https?:\/\/[^\s]+/i)?.[0];

/** PWA Web Share Target (§9.2). Android shares land here as /share?title&text&url;
 *  we pull out the URL, save it, and bounce to the Library. */
export function Share() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const ingestUrl = useData((s) => s.ingestUrl);
  const hydrated = useData((s) => s.hydrated);
  const openItem = useUi((s) => s.openItem);
  const toast = useUi((s) => s.toast);
  const [status, setStatus] = useState<"working" | "done" | "empty">("working");
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current || !hydrated) return;
    handled.current = true;

    const url = params.get("url")?.trim() || firstUrl(params.get("text") ?? "") || firstUrl(params.get("title") ?? "");
    if (!url) {
      setStatus("empty");
      return;
    }
    const note = (params.get("text") ?? "").replace(url, "").trim() || undefined;
    const { item, duplicate } = ingestUrl(url, { source: "share", note });
    setStatus("done");
    toast({ message: duplicate ? "Already saved" : "Saved to Kosh", description: item.title ?? url, tone: "ok" });
    const t = window.setTimeout(() => (duplicate ? openItem(item.id) : navigate("/library")), 900);
    return () => window.clearTimeout(t);
  }, [params, hydrated, ingestUrl, navigate, openItem, toast]);

  return (
    <div role="status" aria-live="polite" className="mx-auto flex max-w-md flex-col items-center justify-center rounded-[var(--radius-card)] border border-border bg-surface px-6 py-16 text-center">
      {status === "working" && (
        <>
          <Spinner size={28} className="mb-4 text-primary" />
          <h1 className="text-lg font-semibold">Saving to Kosh…</h1>
          <p className="mt-1 text-sm text-muted">Capturing what you shared.</p>
        </>
      )}
      {status === "done" && (
        <>
          <CheckCircle2 size={40} className="mb-3 text-ok" />
          <h1 className="text-lg font-semibold">Saved ✓</h1>
          <p className="mt-1 text-sm text-muted">Taking you to your library…</p>
        </>
      )}
      {status === "empty" && (
        <>
          <XCircle size={40} className="mb-3 text-warn" />
          <h1 className="text-lg font-semibold">Nothing to save</h1>
          <p className="mt-1 text-sm text-muted">That share didn't contain a link.</p>
          <button onClick={() => navigate("/")} className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-primary">
            <Share2 size={15} /> Go home
          </button>
        </>
      )}
    </div>
  );
}
