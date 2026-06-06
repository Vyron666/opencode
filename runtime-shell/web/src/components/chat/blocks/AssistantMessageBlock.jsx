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
    // 中文/English: keep the streamed text visible for one more frame so
    // markdown can replace it without a blank flash when streaming ends.
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
    <div className="group flex min-w-0">
      <div className="relative grid min-w-0 max-w-[82%] gap-2">
        <div className="flex items-center gap-2 text-[11px] text-[#8a96ab]">
          <span className="text-xs font-bold tracking-[0.04em] text-[#3566df]">Assistant</span>
          {block.streaming ? <span className="text-[10px] opacity-70">流式输出中...</span> : null}
        </div>

        <div className="pointer-events-none absolute right-0 top-0 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          <button
            type="button"
            onClick={() => void handleCopy()}
            className="pointer-events-auto rounded-full border border-[#dbe5f6] bg-white px-2.5 py-1 text-[11px] text-[#61718d] transition-colors hover:bg-[#f6f8fe]"
            aria-label="复制 AI 消息"
            title="复制"
          >
            {copied ? '已复制' : '复制'}
          </button>
        </div>

        <div
          className="markdown-body min-w-0 max-w-full break-words rounded-[18px] border border-[#dce6f8] bg-[#f7f9fe] px-5 py-4 text-sm leading-7 text-[#24324a] shadow-[0_10px_24px_rgba(15,23,42,0.04)]"
          data-assistant-block-key={block.key}
          data-assistant-render-mode={renderPlainText ? 'plain' : 'markdown'}
          style={{ borderTopLeftRadius: '8px' }}
        >
          {renderPlainText ? (
            <pre ref={textRef} className="max-w-full overflow-x-auto whitespace-pre-wrap break-words font-sans text-sm leading-7 text-[#24324a]" />
          ) : (
            <MarkdownContent content={block.message} />
          )}
        </div>
      </div>
    </div>
  )
})
