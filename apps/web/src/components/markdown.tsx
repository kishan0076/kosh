import { useEffect, useRef, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { cn } from "@/lib/cn";

/** A horizontal scroller that shows a right-edge fade only while more content is clipped to the right,
 *  so on touch (where the scrollbar is invisible) there's an affordance that a wide table/code block
 *  continues sideways. The fade retracts as you reach the end. */
function OverflowScroller({ className, children }: { className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [atEnd, setAtEnd] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    el.addEventListener("scroll", check, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", check);
    };
  }, [children]);
  return (
    <div className="relative my-3">
      <div ref={ref} className={cn("max-w-full overflow-x-auto [-webkit-overflow-scrolling:touch] [scrollbar-width:thin]", className)}>
        {children}
      </div>
      {/* A fade that only appears while there's more to the right; never intercepts touches. */}
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-y-0 right-0 w-8 rounded-r-[inherit] bg-gradient-to-l from-surface-2 to-transparent transition-opacity duration-150",
          atEnd && "opacity-0",
        )}
      />
    </div>
  );
}

/** Sanitized markdown renderer (README / SKILL.md / notes). Never uses dangerouslySetInnerHTML.
 *  Phone-safe by construction: prose breaks long tokens (URLs, paths) anywhere, code blocks and
 *  tables scroll inside their own wrapper (with a fade affordance), images never exceed the column.
 *  Headings are demoted one level (a README's `# title` renders as an <h2>) so the page keeps a single
 *  top-level <h1> — the item/page title above the rendered body. */
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn("kosh-md min-w-0 break-words text-[14px] leading-relaxed text-foreground [overflow-wrap:anywhere]", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={{
          h1: ({ node, ...p }) => <h2 className="mt-6 mb-3 font-display text-xl font-semibold first:mt-0" {...p} />,
          h2: ({ node, ...p }) => <h3 className="mt-6 mb-2.5 font-display text-lg font-semibold first:mt-0" {...p} />,
          h3: ({ node, ...p }) => <h4 className="mt-5 mb-2 font-display text-base font-semibold first:mt-0" {...p} />,
          p: ({ node, ...p }) => <p className="my-3 first:mt-0" {...p} />,
          a: ({ node, ...p }) => <a className="font-medium text-primary underline decoration-primary/30 underline-offset-2 [overflow-wrap:anywhere] hover:decoration-primary" target="_blank" rel="noreferrer noopener" {...p} />,
          ul: ({ node, ...p }) => <ul className="my-3 ml-5 list-disc space-y-1.5 marker:text-faint" {...p} />,
          ol: ({ node, ...p }) => <ol className="my-3 ml-5 list-decimal space-y-1.5 marker:text-faint" {...p} />,
          li: ({ node, ...p }) => <li className="pl-1" {...p} />,
          blockquote: ({ node, ...p }) => <blockquote className="my-3 border-l-2 border-primary/40 bg-surface-2 py-1 pl-4 text-muted" {...p} />,
          hr: () => <hr className="my-5 border-border" />,
          strong: ({ node, ...p }) => <strong className="font-semibold text-foreground" {...p} />,
          code: ({ node, className: c, children, ...p }) => {
            const isBlock = /language-/.test(c ?? "") || String(children).includes("\n");
            if (isBlock) {
              return (
                <code className={cn("block whitespace-pre font-mono text-[12.5px] leading-relaxed", c)} {...p}>
                  {children}
                </code>
              );
            }
            return (
              <code className="rounded-[5px] border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[12.5px] text-foreground [overflow-wrap:anywhere]" {...p}>
                {children}
              </code>
            );
          },
          // Blocks keep their line structure and scroll sideways inside the card instead of pushing it;
          // a right-edge fade signals more content when it overflows.
          pre: ({ node, ...p }) => (
            <OverflowScroller className="rounded-[var(--radius-control)] border border-border bg-surface-2">
              <pre className="p-3.5" {...p} />
            </OverflowScroller>
          ),
          // Cells wrap at spaces only (never mid-word), so a wide table scrolls in its wrapper rather than
          // collapsing into one-character columns.
          table: ({ node, ...p }) => (
            <OverflowScroller className="rounded-lg border border-border">
              <table className="w-full border-collapse text-[13px] [overflow-wrap:normal]" {...p} />
            </OverflowScroller>
          ),
          th: ({ node, ...p }) => <th className="border-b border-border bg-surface-2 px-3 py-2 text-left font-semibold" {...p} />,
          td: ({ node, ...p }) => <td className="border-b border-border px-3 py-2" {...p} />,
          img: ({ node, ...p }) => <img className="my-3 h-auto max-w-full rounded-lg border border-border" loading="lazy" {...p} />,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
