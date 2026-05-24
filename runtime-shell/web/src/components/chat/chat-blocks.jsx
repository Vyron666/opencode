import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useStore } from '../../store'
import { QuestionInlineBlock } from './question-form'

export function ChatBlockItem({ block }) {
  switch (block.type) {
    case 'user':
      return <UserMessageBlock block={block} />
    case 'assistant':
      return <AssistantMessageBlock block={block} />
    case 'thinking':
      return <ThinkingBlock block={block} />
    case 'tool':
      return <ToolBlock block={block} />
    case 'plan':
      return <PlanBlock block={block} />
    case 'permission':
      return <PermissionInlineBlock block={block} />
    case 'question':
      return <QuestionInlineBlock block={block} />
    case 'status':
      return <StatusBlock block={block} />
    case 'error':
      return <ErrorBlock block={block} />
    default:
      return null
  }
}

function UserMessageBlock({ block }) {
  return (
    <div className="flex gap-3 items-start justify-end">
      <div className="grid gap-2 max-w-[88%] justify-items-end">
        <div className="flex items-center gap-2 text-[11px] text-[var(--text-muted)] justify-end">
          <span className="font-bold text-xs text-accent">You</span>
          <span>刚刚</span>
        </div>
        <div
          className="rounded-[20px] px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap break-words"
          style={{
            background: 'linear-gradient(135deg, #d4a05a, #c1873e)',
            color: '#14100d',
            borderTopRightRadius: '6px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.14)',
          }}
        >
          {block.message}
        </div>
      </div>
      <div
        className="w-[34px] h-[34px] rounded-[14px] grid place-items-center shrink-0 text-xs font-bold"
        style={{ background: 'linear-gradient(135deg, rgba(212,120,92,0.25), rgba(212,120,92,0.1))', color: '#d4785c' }}
      >
        U
      </div>
    </div>
  )
}

function AssistantMessageBlock({ block }) {
  return (
    <div className="flex gap-3 items-start">
      <div
        className="w-[34px] h-[34px] rounded-[14px] grid place-items-center shrink-0 text-xs font-bold"
        style={{ background: 'linear-gradient(135deg, rgba(212,160,90,0.25), rgba(212,160,90,0.1))', color: '#f0d6a4' }}
      >
        AI
      </div>
      <div className="grid gap-2 max-w-[88%] min-w-0">
        <div className="flex items-center gap-2 text-[11px] text-[var(--text-muted)]">
          <span className="font-bold text-xs text-brand">Assistant</span>
          {block.streaming && <span className="text-[10px] opacity-60">流式输出中...</span>}
        </div>
        <div
          className="rounded-[20px] px-4 py-3 text-sm leading-relaxed break-words markdown-body"
          style={{
            background: '#231e19',
            borderTopLeftRadius: '6px',
            border: '1px solid rgba(181,148,116,0.09)',
            boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
          }}
        >
          {block.streaming ? (
            <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed">{block.message}</pre>
          ) : (
            <MarkdownContent content={block.message} />
          )}
        </div>
      </div>
    </div>
  )
}

function ThinkingBlock({ block }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="flex gap-3 items-start">
      <div className="w-[34px] h-[34px] rounded-[14px] grid place-items-center shrink-0 text-xs font-bold bg-brand/10 text-brand-text">
        想
      </div>
      <div className="grid gap-1.5 max-w-[88%] w-full">
        <button
          onClick={() => setExpanded(!expanded)}
          className={`flex items-center gap-2.5 w-full px-3.5 py-2 rounded-[14px] border transition-colors text-left ${
            expanded ? 'border-brand bg-brand/10' : 'border-[var(--line)] bg-black/30 hover:border-[var(--line-strong)]'
          }`}
        >
          <span className="text-[10px] font-bold text-brand tracking-widest uppercase">Thinking</span>
          <span className="text-xs text-[var(--text-dim)] truncate flex-1">{block.message.slice(0, 80)}</span>
          <span className="text-xs text-[var(--text-dim)] font-bold">{expanded ? '收起' : '展开'}</span>
        </button>
        {expanded && (
          <div className="animate-fade-in px-3.5 pt-2">
            <div className="border-t border-[var(--line)] pt-3 text-xs text-[var(--text-dim)] leading-relaxed whitespace-pre-wrap break-words">
              {block.message}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function ToolBlock({ block }) {
  const statusColor = block.status === 'completed' ? '#5a9e7c' : block.status === 'failed' ? '#c44a3a' : '#d4a05a'
  const [expanded, setExpanded] = useState(false)
  const openByDefault = block.status === 'pending' || block.status === 'failed'
  const hasDetails = Boolean(block.input || block.output || (block.content?.length > 0) || (block.locations?.length > 0))
  const isOpen = openByDefault || expanded

  return (
    <div className="flex gap-3 items-start">
      <div
        className="rounded-[14px] px-3.5 py-2.5 border border-[var(--line)] grid gap-2 max-w-[640px] w-full"
        style={{ background: block.status === 'failed' ? 'rgba(196,74,58,0.08)' : 'rgba(20,16,13,0.35)' }}
      >
        <div className="flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full" style={{ background: statusColor }} />
          <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: statusColor }}>
            {block.status}
          </span>
          {block.kind && <span className="text-[10px] text-[var(--text-muted)] uppercase">{block.kind}</span>}
          {hasDetails && (
            <button
              type="button"
              onClick={() => setExpanded((current) => !current)}
              className="ml-auto text-[10px] px-2 py-1 rounded-full border border-[var(--line)] bg-black/25 text-[var(--text-muted)] hover:bg-black/35 transition-colors"
              aria-label={isOpen ? '收起工具结果' : '展开工具结果'}
            >
              {isOpen ? '收起' : '展开'}
            </button>
          )}
        </div>

        <div className="text-xs font-semibold text-[var(--text-dim)]">{block.title}</div>

        {isOpen && (
          <>
            {block.locations?.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {block.locations.map((location, index) => (
                  <span key={`${location.path}-${index}`} className="text-[10px] px-2 py-1 rounded-full bg-black/30 text-[var(--text-muted)] border border-[var(--line)]">
                    {location.path}
                    {location.line ? `:${location.line}` : ''}
                  </span>
                ))}
              </div>
            )}

            {block.input && <ToolData label="输入" value={block.input} />}
            {block.output && <ToolData label="输出" value={block.output} />}
            {block.content?.length > 0 && <ToolData label="内容" value={block.content} />}
          </>
        )}
      </div>
    </div>
  )
}

function ToolData({ label, value }) {
  return (
    <div className="grid gap-1">
      <span className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">{label}</span>
      <pre className="text-[11px] text-[var(--text-muted)] whitespace-pre-wrap break-words mt-1 bg-black/30 rounded-[10px] p-2 font-mono overflow-x-auto">
        {formatData(value)}
      </pre>
    </div>
  )
}

function PlanBlock({ block }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="flex gap-3 items-start">
      <div className="rounded-[14px] px-3.5 py-2.5 border border-[var(--line)] bg-black/30 grid gap-1 max-w-[520px] w-full">
        <div className="flex items-center gap-2">
          <div className="text-[10px] font-bold text-brand tracking-widest uppercase">Plan</div>
          <button
            type="button"
            onClick={() => setExpanded((current) => !current)}
            className="ml-auto text-[10px] px-2 py-1 rounded-full border border-[var(--line)] bg-black/25 text-[var(--text-muted)] hover:bg-black/35 transition-colors"
          >
            {expanded ? '收起' : '展开'}
          </button>
        </div>
        <div className={`text-xs text-[var(--text-dim)] leading-relaxed whitespace-pre-wrap break-words ${expanded ? '' : 'line-clamp-4'}`}>
          {block.message}
        </div>
      </div>
    </div>
  )
}

function PermissionInlineBlock({ block }) {
  const store = useStore()
  const respondingPermissionIds = useStore((state) => state.respondingPermissionIds)
  const requestId = block.data?.requestId || block.data?.id
  const submitting = requestId ? respondingPermissionIds.has(requestId) : false

  return (
    <div className="flex justify-center px-4">
      <div className="rounded-[16px] px-4 py-3 border border-brand/20 bg-brand/5 w-full max-w-[540px] grid gap-2 text-center">
        <div className="text-[10px] font-bold text-brand tracking-widest uppercase">权限请求</div>
        <div className="text-xs font-semibold text-[var(--text)]">{block.data?.toolName || '权限审批'}</div>
        <div className="text-[11px] text-[var(--text-muted)]">
          当前会话正在等待你处理这个权限请求，处理完成后会继续运行。
        </div>
        {block.data?.rawInput && (
          <pre className="text-xs text-[var(--text-dim)] bg-black/30 rounded-[10px] p-2 whitespace-pre-wrap break-words overflow-x-auto">
            {formatData(block.data.rawInput)}
          </pre>
        )}
        <div className="flex gap-2 justify-center flex-wrap">
          {(block.data?.options || []).map((option) => (
            <button
              key={option.optionId || option.id}
              onClick={() => store.respondPermission(requestId, true, option.optionId || option.id)}
              disabled={submitting}
              className="text-xs px-4 py-1.5 rounded-[8px] bg-success/10 text-success border border-success/20 hover:bg-success/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? '提交中...' : `批准：${option.name || option.kind || option.optionId}`}
            </button>
          ))}
          {(!block.data?.options || block.data.options.length === 0) && (
            <button
              onClick={() => store.respondPermission(requestId, true)}
              disabled={submitting}
              className="text-xs px-4 py-1.5 rounded-[8px] bg-success/10 text-success border border-success/20 hover:bg-success/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? '提交中...' : '批准'}
            </button>
          )}
          <button
            onClick={() => store.respondPermission(requestId, false)}
            disabled={submitting}
            className="text-xs px-4 py-1.5 rounded-[8px] bg-danger/10 text-danger border border-danger/20 hover:bg-danger/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? '提交中...' : '拒绝'}
          </button>
        </div>
      </div>
    </div>
  )
}

function StatusBlock({ block }) {
  return (
    <div className="flex justify-center px-4">
      <div className="rounded-[14px] px-4 py-2.5 border border-[var(--line)] bg-black/30 text-center max-w-[540px] w-full">
        <div className="text-[11px] text-[var(--text-muted)]">{block.message}</div>
      </div>
    </div>
  )
}

function ErrorBlock({ block }) {
  return (
    <div className="flex justify-center px-4">
      <div className="rounded-[14px] px-4 py-2.5 border border-danger/20 bg-danger/5 text-center max-w-[540px] w-full">
        <div className="text-[11px] text-danger">{block.message}</div>
      </div>
    </div>
  )
}

function MarkdownContent({ content }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ node, ...props }) => <a {...props} className="text-brand underline underline-offset-2" target="_blank" rel="noreferrer" />,
        code: ({ inline, className, children, ...props }) =>
          inline ? (
            <code {...props} className={`rounded bg-black/40 px-1 py-0.5 text-[0.9em] ${className || ''}`.trim()}>
              {children}
            </code>
          ) : (
            <code {...props} className={className}>
              {children}
            </code>
          ),
        pre: ({ node, ...props }) => <pre {...props} className="overflow-x-auto rounded-[12px] bg-black/45 p-3 my-3" />,
        table: ({ node, ...props }) => <table {...props} className="w-full border-collapse text-left text-xs my-3" />,
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

function formatData(value) {
  if (value == null) return ''
  if (typeof value === 'string') return value
  return JSON.stringify(value, null, 2)
}
