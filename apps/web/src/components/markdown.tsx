import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { cn } from "@/lib/cn";

/** Sanitized markdown renderer (README / SKILL.md / notes). Never uses dangerouslySetInnerHTML. */
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn("kosh-md text-[14px] leading-relaxed text-foreground", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={{
          h1: ({ node, ...p }) => <h1 className="mt-6 mb-3 font-display text-xl font-semibold first:mt-0" {...p} />,
          h2: ({ node, ...p }) => <h2 className="mt-6 mb-2.5 font-display text-lg font-semibold first:mt-0" {...p} />,
          h3: ({ node, ...p }) => <h3 className="mt-5 mb-2 font-display text-base font-semibold first:mt-0" {...p} />,
          p: ({ node, ...p }) => <p className="my-3 first:mt-0" {...p} />,
          a: ({ node, ...p }) => <a className="font-medium text-primary underline decoration-primary/30 underline-offset-2 hover:decoration-primary" target="_blank" rel="noreferrer noopener" {...p} />,
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
                <code className={cn("block font-mono text-[12.5px] leading-relaxed", c)} {...p}>
                  {children}
                </code>
              );
            }
            return (
              <code className="rounded-[5px] border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[12.5px] text-foreground" {...p}>
                {children}
              </code>
            );
          },
          pre: ({ node, ...p }) => (
            <pre className="my-3 overflow-x-auto rounded-[var(--radius-control)] border border-border bg-surface-2 p-3.5" {...p} />
          ),
          table: ({ node, ...p }) => (
            <div className="my-3 overflow-x-auto rounded-lg border border-border">
              <table className="w-full border-collapse text-[13px]" {...p} />
            </div>
          ),
          th: ({ node, ...p }) => <th className="border-b border-border bg-surface-2 px-3 py-2 text-left font-semibold" {...p} />,
          td: ({ node, ...p }) => <td className="border-b border-border px-3 py-2" {...p} />,
          img: ({ node, ...p }) => <img className="my-3 max-w-full rounded-lg border border-border" loading="lazy" {...p} />,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
