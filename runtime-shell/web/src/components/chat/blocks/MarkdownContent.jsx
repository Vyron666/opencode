import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

export function MarkdownContent({ content }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ node, ...props }) => <a {...props} className="text-brand underline underline-offset-2" target="_blank" rel="noreferrer" />,
        code: ({ inline, className, children, ...props }) =>
          inline ? (
            <code {...props} className={`rounded bg-black/40 px-1 py-0.5 text-[0.9em] break-all ${className || ''}`.trim()}>
              {children}
            </code>
          ) : (
            <code {...props} className={className}>
              {children}
            </code>
          ),
        pre: ({ node, ...props }) => <pre {...props} className="max-w-full overflow-x-auto rounded-[12px] bg-black/45 p-3 my-3" />,
        table: ({ node, ...props }) => (
          <div className="my-3 max-w-full overflow-x-auto">
            {/* 中文/English: keep wide tables scrollable inside the message card instead of widening the whole timeline. */}
            <table {...props} className="min-w-full border-collapse text-left text-xs" />
          </div>
        ),
        th: ({ node, ...props }) => <th {...props} className="border border-[var(--line)] px-2 py-1 bg-black/30" />,
        td: ({ node, ...props }) => <td {...props} className="border border-[var(--line)] px-2 py-1 align-top" />,
        ul: ({ node, ...props }) => <ul {...props} className="list-disc pl-5 my-2 space-y-1" />,
        ol: ({ node, ...props }) => <ol {...props} className="list-decimal pl-5 my-2 space-y-1" />,
        p: ({ node, ...props }) => <p {...props} className="my-2 first:mt-0 last:mb-0" />,
        blockquote: ({ node, ...props }) => <blockquote {...props} className="border-l-2 border-brand/50 pl-3 my-3 text-[var(--text-dim)]" />,
      }}
    >
      {content}
    </ReactMarkdown>
  )
}
