import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from '../../../store'
import { subscribeAssistantStreamActivity } from '../../../store/sse/assistant-stream-channel'
import { ConversationTimeline, DebugConversationTimeline } from './ConversationTimeline'

export const ConversationSection = memo(function ConversationSection({ currentSessionId, showDebug }) {
  const conversationVersion = useStore((state) => state.conversationVersion)
  const blocks = useStore((state) => state.conversationBlocks)
  const timelineRef = useRef(null)
  const scrollFrameRef = useRef(0)
  const [autoScroll, setAutoScroll] = useState(true)

  const scheduleAutoScroll = useCallback(() => {
    if (showDebug) return
    if (!autoScroll || !timelineRef.current) return
    cancelAnimationFrame(scrollFrameRef.current)
    // 中文/English: keep auto-scroll synced for both structural updates and
    // direct assistant chunk appends, otherwise the viewport lags behind output.
    scrollFrameRef.current = requestAnimationFrame(() => {
      if (!timelineRef.current) return
      timelineRef.current.scrollTop = timelineRef.current.scrollHeight
    })
  }, [autoScroll, showDebug])

  useEffect(() => {
    scheduleAutoScroll()
  }, [conversationVersion, scheduleAutoScroll])

  useEffect(() => subscribeAssistantStreamActivity(() => scheduleAutoScroll()), [scheduleAutoScroll])
  useEffect(() => () => cancelAnimationFrame(scrollFrameRef.current), [])

  const handleScroll = useCallback(() => {
    const element = timelineRef.current
    if (!element) return
    setAutoScroll(element.scrollHeight - element.scrollTop - element.clientHeight < 80)
  }, [])

  const scrollToBottom = useCallback(() => {
    if (!timelineRef.current) return
    timelineRef.current.scrollTop = timelineRef.current.scrollHeight
    setAutoScroll(true)
  }, [])

  return (
    <section className="flex-1 min-h-0 overflow-hidden bg-[#fcfdff]">
      <div
        ref={timelineRef}
        onScroll={handleScroll}
        className="relative h-full overflow-y-auto overflow-x-hidden px-4 py-4 max-[1024px]:px-3"
        style={{ background: 'linear-gradient(180deg, #ffffff 0%, #fbfcff 100%)' }}
      >
        {showDebug ? <DebugConversationTimeline /> : <ConversationTimeline blocks={blocks} currentSessionId={currentSessionId} />}

        {!showDebug && !autoScroll && blocks.length > 0 ? (
          <button
            type="button"
            onClick={scrollToBottom}
            className="absolute bottom-5 right-5 z-10 h-11 w-11 rounded-full border border-brand/20 bg-brand text-lg font-semibold text-white shadow-[0_12px_28px_rgba(37,99,235,0.24)] transition-colors hover:bg-[var(--brand-strong)]"
            title="回到底部"
            aria-label="回到底部"
          >
            ↓
          </button>
        ) : null}
      </div>
    </section>
  )
})
