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
