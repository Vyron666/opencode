import { useEffect, useState } from 'react'
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
            <code
              {...props}
              className={`break-all rounded border border-[var(--line)] bg-[var(--surface-muted)] px-1 py-0.5 text-[0.9em] ${className || ''}`.trim()}
            >
              {children}
            </code>
          ) : (
            <code {...props} className={className}>
              {children}
            </code>
          ),
        pre: ({ node, children, ...props }) => <CodeBlock {...props}>{children}</CodeBlock>,
        table: ({ node, ...props }) => (
          <div className="my-3 max-w-full overflow-x-auto">
            <table {...props} className="min-w-full border-collapse text-left text-xs" />
          </div>
        ),
        th: ({ node, ...props }) => <th {...props} className="border border-[var(--line)] bg-[var(--surface-muted)] px-2 py-1" />,
        td: ({ node, ...props }) => <td {...props} className="border border-[var(--line)] bg-white px-2 py-1 align-top" />,
        ul: ({ node, ...props }) => <ul {...props} className="my-2 list-disc space-y-1 pl-5" />,
        ol: ({ node, ...props }) => <ol {...props} className="my-2 list-decimal space-y-1 pl-5" />,
        p: ({ node, ...props }) => <p {...props} className="my-2 first:mt-0 last:mb-0" />,
        blockquote: ({ node, ...props }) => <blockquote {...props} className="my-3 border-l-2 border-brand/50 pl-3 text-[var(--text-dim)]" />,
      }}
    >
      {content}
    </ReactMarkdown>
  )
}

function CodeBlock({ children, ...props }) {
  const [copied, setCopied] = useState(false)
  const codeElement = Array.isArray(children) ? children.find((child) => child?.props?.className) || children[0] : children
  const className = codeElement?.props?.className || ''
  const language = readCodeLanguage(className)
  const codeText = readCodeText(codeElement?.props?.children ?? children)

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1200)
    return () => clearTimeout(timer)
  }, [copied])

  return (
    <div className="my-3 overflow-hidden rounded-[14px] border border-[var(--line)] bg-white shadow-[0_10px_28px_rgba(15,23,42,0.06)]">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] bg-[var(--surface-muted)] px-3.5 py-2.5 text-[11px]">
        <span className="font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">{language}</span>
        <button
          type="button"
          onClick={async () => {
            if (!codeText) return
            await navigator.clipboard.writeText(codeText)
            setCopied(true)
          }}
          className="rounded-full border border-[var(--line)] bg-white px-2.5 py-1 text-[var(--text-dim)] transition-colors hover:bg-[var(--bg-strong)]"
        >
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      <pre {...props} className="max-w-full overflow-x-auto px-3.5 py-3 text-sm">
        {children}
      </pre>
    </div>
  )
}

function readCodeLanguage(className) {
  const match = String(className || '').match(/language-([\w-]+)/)
  return match?.[1] || 'text'
}

function readCodeText(value) {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(readCodeText).join('')
  return ''
}
