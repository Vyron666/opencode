import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { subscribeAssistantChunk } from '../../../store/sse/assistant-stream-channel'
import { MarkdownContent } from './MarkdownContent'

export const AssistantMessageBlock = memo(function AssistantMessageBlock({ block }) {
  const textRef = useRef(null)
  const textNodeRef = useRef(null)
  const chunkVersionRef = useRef(0)
  const markdownFrameRef = useRef(0)
  const plainText = block.message || (Array.isArray(block.chunks) && block.chunks.length > 0 ? block.chunks.join('') : block.latestChunk || '')
  const [showMarkdown, setShowMarkdown] = useState(() => !block.streaming)
  const [copied, setCopied] = useState(false)
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

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1200)
    return () => clearTimeout(timer)
  }, [copied])

  const handleCopy = async () => {
    if (!plainText) return
    await navigator.clipboard.writeText(plainText)
    setCopied(true)
  }

  return (
    <div className="group flex min-w-0 items-start gap-3">
      <div className="grid h-[36px] w-[36px] shrink-0 place-items-center rounded-[14px] border border-brand/15 bg-brand/10 text-xs font-bold text-brand">
        AI
      </div>

      <div className="relative grid min-w-0 max-w-[88%] gap-2.5">
        <div className="flex items-center gap-2 text-[11px] text-[var(--text-muted)]">
          <span className="text-xs font-bold tracking-[0.04em] text-brand">Assistant</span>
          {block.streaming ? <span className="text-[10px] opacity-60">流式输出中...</span> : null}
        </div>

        <div className="pointer-events-none absolute right-0 top-0 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          <button
            type="button"
            onClick={() => void handleCopy()}
            className="pointer-events-auto rounded-full border border-[var(--line)] bg-white px-2.5 py-1 text-[11px] text-[var(--text-dim)] transition-colors hover:bg-[var(--surface-muted)]"
            aria-label="复制 AI 消息"
            title="复制"
          >
            {copied ? '已复制' : '复制'}
          </button>
        </div>

        <div
          className="markdown-body min-w-0 max-w-full break-words rounded-[22px] border border-[var(--line)] bg-white px-4.5 py-3.5 text-sm leading-relaxed shadow-[0_14px_34px_rgba(15,23,42,0.08)]"
          data-assistant-block-key={block.key}
          data-assistant-render-mode={renderPlainText ? 'plain' : 'markdown'}
          style={{ borderTopLeftRadius: '6px' }}
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
