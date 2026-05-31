import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useStore } from '../../store'
import { subscribeAssistantChunk } from '../../store/sse/assistant-stream-channel'
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
    case 'todo':
      return <TodoBlock block={block} />
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
    <div className="flex min-w-0 gap-3 items-start justify-end">
      <div className="grid min-w-0 gap-2 max-w-[88%] justify-items-end">
        <div className="flex items-center gap-2 text-[11px] text-[var(--text-muted)] justify-end">
          <span className="font-bold text-xs text-accent">You</span>
          <span>刚刚</span>
        </div>
        <div
          className="min-w-0 max-w-full rounded-[20px] px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap break-words"
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

const AssistantMessageBlock = memo(function AssistantMessageBlock({ block }) {
  const textRef = useRef(null)
  const textNodeRef = useRef(null)
  const chunkVersionRef = useRef(0)
  const markdownFrameRef = useRef(0)
  const plainText = block.message || (Array.isArray(block.chunks) && block.chunks.length > 0 ? block.chunks.join('') : block.latestChunk || '')
  const [showMarkdown, setShowMarkdown] = useState(() => !block.streaming)
  const renderPlainText = block.streaming || !showMarkdown

  useEffect(() => {
    if (markdownFrameRef.current) {
      cancelAnimationFrame(markdownFrameRef.current)
      markdownFrameRef.current = 0
    }
    if (block.streaming) {
      setShowMarkdown(false)
      return
    }
    if (!plainText) {
      setShowMarkdown(true)
      return
    }
    // 中文/English: keep the streamed text node visible for one more frame so
    // the final markdown tree can replace it without a blank transition flash.
    markdownFrameRef.current = requestAnimationFrame(() => {
      markdownFrameRef.current = 0
      setShowMarkdown(true)
    })
    return () => {
      if (!markdownFrameRef.current) return
      cancelAnimationFrame(markdownFrameRef.current)
      markdownFrameRef.current = 0
    }
  }, [block.streaming, plainText])

  useLayoutEffect(() => {
    if (!renderPlainText || !textRef.current) return
    if (!textNodeRef.current) {
      textNodeRef.current = document.createTextNode('')
      textRef.current.replaceChildren(textNodeRef.current)
    }
    if (block.streaming && chunkVersionRef.current > block.chunkVersion) {
      textNodeRef.current.nodeValue = ''
      chunkVersionRef.current = 0
    }
    if (block.streaming && chunkVersionRef.current === block.chunkVersion && textNodeRef.current.nodeValue === plainText) return
    const nextText = block.streaming
      ? Array.isArray(block.chunks) && block.chunks.length > 0
        ? block.chunks.join('')
        : block.latestChunk || ''
      : plainText
    if (!nextText) return
    // 中文/English: append only the latest upstream chunk so the DOM path stays
    // incremental end-to-end on a single Text node to avoid node explosion.
    textNodeRef.current.nodeValue = nextText
    if (!block.streaming) return
    chunkVersionRef.current = block.chunkVersion
  }, [block.chunkVersion, block.chunks, block.latestChunk, block.streaming, plainText, renderPlainText])

  useEffect(() => {
    if (!block.streaming || !textRef.current) return
    return subscribeAssistantChunk(block.key, ({ chunk, chunkVersion, publishedAt }) => {
      if (!textRef.current || !chunk) return
      if (!textNodeRef.current) {
        textNodeRef.current = document.createTextNode('')
        textRef.current.replaceChildren(textNodeRef.current)
      }
      if (typeof chunkVersion === 'number' && chunkVersion <= chunkVersionRef.current) return
      textNodeRef.current.nodeValue += chunk
      if (typeof chunkVersion === 'number') chunkVersionRef.current = chunkVersion
      // 中文/English: keep latency measurement on the direct chunk path so we can
      // verify whether streaming delay still happens before or after DOM append.
      if (window.__RUNTIME_SHELL_STREAM_DEBUG__) {
        console.debug('[runtime-shell stream]', {
          blockKey: block.key,
          domAppendDelayMs: Number((performance.now() - publishedAt).toFixed(2)),
          chunkLength: chunk.length,
        })
      }
    })
  }, [block.key, block.streaming])

  useEffect(() => {
    if (renderPlainText) return
    textNodeRef.current = null
    chunkVersionRef.current = 0
  }, [renderPlainText])

  return (
    <div className="flex min-w-0 gap-3 items-start">
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
          className="min-w-0 max-w-full rounded-[20px] px-4 py-3 text-sm leading-relaxed break-words markdown-body"
          data-assistant-block-key={block.key}
          data-assistant-render-mode={renderPlainText ? 'plain' : 'markdown'}
          style={{
            background: '#231e19',
            borderTopLeftRadius: '6px',
            border: '1px solid rgba(181,148,116,0.09)',
            boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
          }}
        >
          {renderPlainText ? (
            <pre ref={textRef} className="max-w-full overflow-x-auto whitespace-pre-wrap break-words font-sans text-sm leading-relaxed" />
          ) : (
            <MarkdownContent content={block.message} />
          )}
        </div>
      </div>
    </div>
  )
})

function ThinkingBlock({ block }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="flex min-w-0 gap-3 items-start">
      <div className="w-[34px] h-[34px] rounded-[14px] grid place-items-center shrink-0 text-xs font-bold bg-brand/10 text-brand-text">
        想
      </div>
      <div className="grid min-w-0 gap-1.5 max-w-[88%] w-full">
        <button
          onClick={() => setExpanded(!expanded)}
          className={`flex min-w-0 items-center gap-2.5 w-full px-3.5 py-2 rounded-[14px] border transition-colors text-left ${
            expanded ? 'border-brand bg-brand/10' : 'border-[var(--line)] bg-black/30 hover:border-[var(--line-strong)]'
          }`}
        >
          <span className="text-[10px] font-bold text-brand tracking-widest uppercase">Thinking</span>
          <span className="min-w-0 text-xs text-[var(--text-dim)] truncate flex-1">{block.message.slice(0, 80)}</span>
          <span className="text-xs text-[var(--text-dim)] font-bold">{expanded ? '收起' : '展开'}</span>
        </button>
        {expanded && (
          <div className="min-w-0 animate-fade-in px-3.5 pt-2">
            <div className="min-w-0 border-t border-[var(--line)] pt-3 text-xs text-[var(--text-dim)] leading-relaxed whitespace-pre-wrap break-words">
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
    <div className="flex min-w-0 gap-3 items-start">
      <div
        className="min-w-0 rounded-[14px] px-3.5 py-2.5 border border-[var(--line)] grid gap-2 max-w-[640px] w-full"
        style={{ background: block.status === 'failed' ? 'rgba(196,74,58,0.08)' : 'rgba(20,16,13,0.35)' }}
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full" style={{ background: statusColor }} />
          <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: statusColor }}>
            {block.status}
          </span>
          {block.kind && <span className="min-w-0 text-[10px] text-[var(--text-muted)] uppercase truncate">{block.kind}</span>}
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

        <div className="min-w-0 text-xs font-semibold text-[var(--text-dim)] break-words">{block.title}</div>

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

function TodoBlock({ block }) {
  const todos = Array.isArray(block.todos) ? block.todos : []
  const showPlaceholder = todos.length === 0

  return (
    <div className="flex min-w-0 gap-3 items-start">
      <div className="min-w-0 rounded-[14px] px-3.5 py-2.5 border border-[var(--line)] bg-black/30 grid gap-2 max-w-[560px] w-full">
        <div className="flex items-center gap-2">
          <div className="text-[10px] font-bold text-brand tracking-widest uppercase">Todo</div>
          <span className="text-[10px] text-[var(--text-muted)] uppercase">{block.status}</span>
        </div>
        {showPlaceholder ? (
          <div className="text-xs text-[var(--text-dim)]">Updating todos...</div>
        ) : (
          <div className="grid gap-1.5">
            {todos.map((todo, index) => (
              <div key={`${todo.content}-${index}`} className="flex items-start gap-2 text-xs text-[var(--text-dim)]">
                <span className={`w-5 shrink-0 font-bold ${todo.status === 'in_progress' ? 'text-brand' : todo.status === 'completed' ? 'text-success' : 'text-[var(--text-muted)]'}`}>
                  {todo.status === 'completed' ? '[✓]' : todo.status === 'in_progress' ? '[•]' : '[ ]'}
                </span>
                <span className="leading-relaxed break-words">{todo.content}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function ToolData({ label, value }) {
  return (
    <div className="grid min-w-0 gap-1">
      <span className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">{label}</span>
      <pre className="max-w-full text-[11px] text-[var(--text-muted)] whitespace-pre-wrap break-words mt-1 bg-black/30 rounded-[10px] p-2 font-mono overflow-x-auto">
        {formatData(value)}
      </pre>
    </div>
  )
}

function PlanBlock({ block }) {
  const [expanded, setExpanded] = useState(false)
  const entries = Array.isArray(block.entries) ? block.entries : []
  const preview = block.message || entries.map((item) => `- ${item.text}`).join('\n')

  return (
    <div className="flex min-w-0 gap-3 items-start">
      <div className="min-w-0 rounded-[14px] px-3.5 py-2.5 border border-[var(--line)] bg-black/30 grid gap-1 max-w-[560px] w-full">
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
        {block.message && (
          <div className={`text-xs text-[var(--text-dim)] leading-relaxed whitespace-pre-wrap break-words ${expanded ? '' : 'line-clamp-4'}`}>
            {preview}
          </div>
        )}
        {entries.length > 0 && (
          <div className="grid gap-1.5 pt-1">
            {entries.map((entry, index) => (
              <div key={`${entry.text}-${index}`} className="flex items-start gap-2 text-xs text-[var(--text-dim)]">
                <span className={`w-5 shrink-0 font-bold ${entry.status === 'in_progress' ? 'text-brand' : entry.status === 'completed' ? 'text-success' : 'text-[var(--text-muted)]'}`}>
                  {entry.status === 'completed' ? '[✓]' : entry.status === 'in_progress' ? '[•]' : '[ ]'}
                </span>
                <span className="leading-relaxed break-words">{entry.text}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function PermissionInlineBlock({ block }) {
  const respondPermission = useStore((state) => state.respondPermission)
  const pendingPermissions = useStore((state) => state.pendingPermissions)
  const respondingPermissionIds = useStore((state) => state.respondingPermissionIds)
  const requestId = block.data?.requestId || block.data?.id
  const submitting = requestId ? respondingPermissionIds.has(requestId) : false
  const pending = requestId
    ? pendingPermissions.some((item) => (item.requestId || item.id) === requestId)
    : false
  const resolved = Boolean(requestId) && !pending && !submitting

  return (
    <div className="flex justify-center px-4">
      <div className="min-w-0 rounded-[16px] px-4 py-3 border border-brand/20 bg-brand/5 w-full max-w-[540px] grid gap-2 text-center">
        <div className="text-[10px] font-bold text-brand tracking-widest uppercase">权限请求</div>
        <div className="text-xs font-semibold text-[var(--text)]">{block.data?.toolName || '权限审批'}</div>
        <div className="text-[11px] text-[var(--text-muted)]">当前会话正在等待你处理这个权限请求，处理完成后会继续运行。</div>
        {block.data?.rawInput && (
          <pre className="max-w-full text-xs text-[var(--text-dim)] bg-black/30 rounded-[10px] p-2 whitespace-pre-wrap break-words overflow-x-auto">
            {formatData(block.data.rawInput)}
          </pre>
        )}
        {resolved ? (
          <div className="text-[11px] text-[var(--text-muted)]">
            已处理，等待会话继续。
          </div>
        ) : (
          <div className="flex gap-2 justify-center flex-wrap">
          {(block.data?.options || []).map((option) => (
            <button
              key={option.optionId || option.id}
              onClick={() => respondPermission(requestId, true, option.optionId || option.id)}
              disabled={submitting}
              className="text-xs px-4 py-1.5 rounded-[8px] bg-success/10 text-success border border-success/20 hover:bg-success/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? '提交中...' : `批准：${option.name || option.kind || option.optionId}`}
            </button>
          ))}
          {(!block.data?.options || block.data.options.length === 0) && (
            <button
              onClick={() => respondPermission(requestId, true)}
              disabled={submitting}
              className="text-xs px-4 py-1.5 rounded-[8px] bg-success/10 text-success border border-success/20 hover:bg-success/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? '提交中...' : '批准'}
            </button>
          )}
          <button
            onClick={() => respondPermission(requestId, false)}
            disabled={submitting}
            className="text-xs px-4 py-1.5 rounded-[8px] bg-danger/10 text-danger border border-danger/20 hover:bg-danger/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? '提交中...' : '拒绝'}
          </button>
          </div>
        )}
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

function formatData(value) {
  if (value == null) return ''
  if (typeof value === 'string') return value
  return JSON.stringify(value, null, 2)
}
