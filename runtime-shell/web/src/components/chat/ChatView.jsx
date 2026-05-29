import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../../store'
import { buildConversationBlocks } from './conversation-blocks'
import { ChatBlockItem } from './chat-blocks'
import { deriveConversationPhase } from '../../store/runtime-phase'
import { subscribeAssistantStreamActivity } from '../../store/sse/assistant-stream-channel'
import { Field, Select, secondaryButtonClassName, useSessionCapabilities, useViewerContext } from '../sidebar/sidebar-support'

export default function ChatView() {
  const currentSessionId = useStore((state) => state.currentSessionId)
  const flash = useStore((state) => state.flash)
  const sessionTitle = useStore((state) => state.sessionDetail?.session?.title || '')
  const [showDebug, setShowDebug] = useState(false)

  return (
    <main className="chat-shell min-h-0 h-[calc(100dvh-28px)] flex flex-col gap-2.5 overflow-hidden max-[1100px]:order-3 max-[1100px]:h-auto">
      <ConversationHeader currentSessionId={currentSessionId} sessionTitle={sessionTitle} />
      {flash ? (
        <div className="shrink-0 rounded-[14px] px-3.5 py-2 bg-brand/10 border border-[var(--line)] text-xs text-[var(--text-dim)] animate-slide-down">
          {flash}
        </div>
      ) : null}
      <ConversationPhaseBanner currentSessionId={currentSessionId} />
      <ConversationSection currentSessionId={currentSessionId} showDebug={showDebug} />
      <ComposerSection currentSessionId={currentSessionId} showDebug={showDebug} setShowDebug={setShowDebug} />
    </main>
  )
}

const ConversationHeader = memo(function ConversationHeader({ currentSessionId, sessionTitle }) {
  const connectSSE = useStore((state) => state.connectSSE)
  const cancelPrompt = useStore((state) => state.cancelPrompt)
  const phase = useConversationPhase()

  return (
    <header className="shrink-0 flex items-start justify-between gap-4 px-4 py-3 rounded-[20px] border border-[var(--line)] bg-[var(--surface)] shadow-md backdrop-blur-2xl">
      <div className="min-w-0">
        <span className="text-[10px] font-semibold tracking-[0.14em] uppercase text-brand">Conversation</span>
        <h1 className="text-base font-bold mt-0.5 truncate">{sessionTitle || '\u672a\u9009\u62e9\u4f1a\u8bdd'}</h1>
        <p className="text-xs text-[var(--text-muted)] mt-1 truncate">
          {currentSessionId ? `\u4f1a\u8bdd ID\uff1a${currentSessionId}` : '\u8bf7\u5148\u5728\u5de6\u4fa7\u9009\u62e9\u4f1a\u8bdd\uff0c\u6216\u5728\u53f3\u4fa7\u521b\u5efa\u4e00\u4e2a\u65b0\u4f1a\u8bdd\u3002'}
        </p>
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          <span className="rounded-full border border-[var(--line)] bg-black/25 px-2.5 py-1 text-[11px] font-semibold text-[var(--text-dim)]">
            {'\u72b6\u6001\uff1a'}{phase.label}
          </span>
          {currentSessionId ? <span className="text-[11px] text-[var(--text-muted)]">{phase.detail}</span> : null}
        </div>
      </div>
      <div className="flex gap-2 flex-wrap justify-end shrink-0">
        <button
          onClick={() => connectSSE()}
          aria-label={'\u91cd\u65b0\u8fde\u63a5\u4e8b\u4ef6\u6d41'}
          className="text-xs px-3 py-1.5 rounded-[8px] bg-brand/10 text-brand-text border border-[var(--line)] hover:bg-brand/20 transition-colors focus-visible:ring-2 focus-visible:ring-brand"
        >
          {'\u91cd\u65b0\u8fde\u63a5\u4e8b\u4ef6\u6d41'}
        </button>
        <button
          onClick={() => cancelPrompt()}
          disabled={!phase.canCancel || !currentSessionId}
          aria-label={'\u6682\u505c\u5f53\u524d\u751f\u6210'}
          className="text-xs px-3 py-1.5 rounded-[8px] bg-danger/10 text-danger border border-danger/20 hover:bg-danger/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {phase.id === 'cancelling'
            ? '\u53d6\u6d88\u4e2d...'
            : phase.canCancel
              ? '\u6682\u505c\u751f\u6210'
              : phase.id === 'waiting_permission'
                ? '\u7b49\u5f85\u5ba1\u6279\u4e2d'
                : phase.id === 'waiting_question'
                  ? '\u7b49\u5f85\u56de\u7b54\u4e2d'
                  : '\u6682\u505c\u751f\u6210'}
        </button>
      </div>
    </header>
  )
})

const ConversationPhaseBanner = memo(function ConversationPhaseBanner({ currentSessionId }) {
  const phase = useConversationPhase()
  if (!currentSessionId || phase.id === 'idle') return null

  return (
    <div className="shrink-0 rounded-[14px] px-3.5 py-2 border border-[var(--line)] bg-black/30 text-xs text-[var(--text-dim)]">
      {phase.detail}
    </div>
  )
})

const ConversationSection = memo(function ConversationSection({ currentSessionId, showDebug }) {
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
    <section className="flex-1 min-h-0 rounded-[20px] border border-[var(--line)] bg-[var(--surface)] shadow-md overflow-hidden">
      <div
        ref={timelineRef}
        onScroll={handleScroll}
        className="relative h-full overflow-y-auto overflow-x-hidden px-4 py-4"
        style={{ background: 'linear-gradient(180deg, rgba(20,16,13,0.3), rgba(20,16,13,0.55))' }}
      >
        {showDebug ? <DebugConversationTimeline /> : <ConversationTimeline blocks={blocks} currentSessionId={currentSessionId} />}

        {!showDebug && !autoScroll && blocks.length > 0 ? (
          <button
            onClick={scrollToBottom}
            className="absolute right-4 bottom-4 z-10 rounded-full px-4 py-2 text-xs font-semibold"
            style={{ background: 'rgba(212,160,90,0.92)', color: '#14100d', boxShadow: '0 8px 24px rgba(212,160,90,0.25)' }}
          >
            {'\u56de\u5230\u5e95\u90e8'}
          </button>
        ) : null}
      </div>
    </section>
  )
})

const ComposerSection = memo(function ComposerSection({ currentSessionId, showDebug, setShowDebug }) {
  const sendPrompt = useStore((state) => state.sendPrompt)
  const updateMode = useStore((state) => state.updateMode)
  const pendingSettingsAction = useStore((state) => state.pendingSettingsAction)
  const phase = useConversationPhase()
  const capabilities = useSessionCapabilities()
  const { canUpdateMode, isSharedSession } = useViewerContext()
  const [attachments, setAttachments] = useState([])
  const [promptText, setPromptText] = useState('')
  const [selectedMode, setSelectedMode] = useState('')
  const sendDisabled = !currentSessionId || phase.isBusy

  useEffect(() => {
    setSelectedMode(capabilities.modeId || capabilities.modes?.[0]?.id || '')
  }, [capabilities.modeId, capabilities.modes, currentSessionId])

  const handleSend = useCallback(
    async (event) => {
      event.preventDefault()
      if (!promptText.trim()) return
      if (canUpdateMode && selectedMode && selectedMode !== capabilities.modeId) {
        await updateMode(selectedMode)
      }
      const sent = await sendPrompt(promptText, attachments)
      if (!sent) return
      setPromptText('')
      setAttachments([])
    },
    [attachments, capabilities.modeId, canUpdateMode, promptText, selectedMode, sendPrompt, updateMode],
  )

  const handleDrop = useCallback((event) => {
    event.preventDefault()
    event.currentTarget.classList.remove('is-dragover')
    const files = Array.from(event.dataTransfer.files || [])
    if (!files.length) return
    setAttachments((current) => [...current, ...files])
  }, [])

  const handleFileChange = useCallback((event) => {
    const files = Array.from(event.target.files || [])
    if (!files.length) return
    setAttachments((current) => [...current, ...files])
    event.target.value = ''
  }, [])

  const removeAttachment = useCallback((index) => {
    setAttachments((current) => current.filter((_, currentIndex) => currentIndex !== index))
  }, [])

  return (
    <section className="shrink-0 rounded-[20px] border border-[var(--line)] bg-[var(--surface)] shadow-md backdrop-blur-2xl p-3">
      {attachments.length > 0 ? (
        <div className="flex flex-wrap gap-2 pb-3">
          {attachments.map((file, index) => (
            <div
              key={`${file.name}-${index}`}
              className="inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-black/30 px-3 py-1 text-xs text-[var(--text-dim)]"
            >
              <span className="max-w-[220px] truncate">{file.name}</span>
              <button
                type="button"
                onClick={() => removeAttachment(index)}
                className="text-[var(--text-muted)] hover:text-danger transition-colors"
                aria-label={`\u79fb\u9664\u9644\u4ef6 ${file.name}`}
              >
                {'\u00d7'}
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <form onSubmit={handleSend} className="grid gap-2.5">
        <textarea
          value={promptText}
          onChange={(event) => setPromptText(event.target.value)}
          rows={3}
          placeholder={currentSessionId ? '\u8f93\u5165\u6d88\u606f...' : '\u8bf7\u5148\u6253\u5f00\u4e00\u4e2a\u4f1a\u8bdd'}
          className="w-full min-h-[88px] max-h-[220px] rounded-[12px] border border-[var(--line-strong)] px-3 py-2 bg-black/55 text-sm outline-none resize-y focus:border-[rgba(212,160,90,0.28)] placeholder:text-[var(--text-muted)]"
          style={{ lineHeight: '22px' }}
          onDragOver={(event) => {
            event.preventDefault()
            event.currentTarget.classList.add('is-dragover')
          }}
          onDragLeave={(event) => {
            event.currentTarget.classList.remove('is-dragover')
          }}
          onDrop={handleDrop}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.shiftKey) return
            event.preventDefault()
            if (!sendDisabled) void handleSend(event)
          }}
        />

        {currentSessionId ? (
          <div className="grid gap-2 rounded-[12px] border border-[var(--line)] bg-black/25 px-3 py-2.5">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <span className="text-[11px] font-semibold tracking-[0.12em] uppercase text-brand">Prompt Mode</span>
              {isSharedSession ? <span className="text-[11px] text-[var(--text-muted)]">{'\u5171\u4eab\u5de5\u4f5c\u533a\u4f1a\u8bdd\u4e0d\u5141\u8bb8\u5207\u6362\u6a21\u5f0f'}</span> : null}
            </div>
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
              <Field label={'\u6a21\u5f0f'}>
                <Select value={selectedMode} onChange={setSelectedMode} options={capabilities.modes} emptyLabel={'\u5f53\u524d\u4f1a\u8bdd\u6ca1\u6709\u53ef\u9009\u6a21\u5f0f'} />
              </Field>
              <button
                type="button"
                disabled={!selectedMode || !currentSessionId || Boolean(pendingSettingsAction) || !canUpdateMode}
                onClick={() => void updateMode(selectedMode)}
                className={secondaryButtonClassName}
              >
                {pendingSettingsAction === 'mode' ? '\u5207\u6362\u4e2d...' : '\u5207\u6362\u6a21\u5f0f'}
              </button>
            </div>
          </div>
        ) : null}

        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 flex-wrap">
            <label className="hidden sm:flex items-center gap-1 text-[11px] text-[var(--text-muted)] cursor-pointer shrink-0">
              <input
                type="checkbox"
                checked={showDebug}
                onChange={(event) => setShowDebug(event.target.checked)}
                className="w-3.5 h-3.5 accent-brand"
              />
              <span>{'\u8c03\u8bd5\u4e8b\u4ef6'}</span>
            </label>

            <label className="text-[11px] px-2.5 py-1.5 rounded-[8px] bg-brand/10 text-brand-text border border-[var(--line)] hover:bg-brand/20 transition-colors cursor-pointer shrink-0 relative overflow-hidden">
              {'\u6dfb\u52a0\u9644\u4ef6'}
              <input type="file" multiple onChange={handleFileChange} className="absolute inset-0 opacity-0 cursor-pointer" />
            </label>
          </div>

          <button
            type="submit"
            disabled={sendDisabled}
            className="rounded-[10px] py-2 px-4 font-semibold text-sm bg-brand text-[#14100d] hover:brightness-110 active:scale-[0.985] transition-all shadow-glow disabled:opacity-50 disabled:cursor-not-allowed shrink-0 min-w-[84px]"
          >
            {phase.id === 'submitting'
              ? '\u53d1\u9001\u4e2d...'
              : phase.id === 'cancelling'
                ? '\u53d6\u6d88\u4e2d...'
                : phase.id === 'running'
                  ? '\u6a21\u578b\u751f\u6210\u4e2d...'
                  : phase.id === 'waiting_permission'
                    ? '\u7b49\u5f85\u5ba1\u6279\u4e2d...'
                    : phase.id === 'waiting_question'
                      ? '\u7b49\u5f85\u56de\u7b54\u4e2d...'
                      : '\u53d1\u9001'}
          </button>
        </div>
      </form>
    </section>
  )
})

function ConversationTimeline({ blocks, currentSessionId }) {
  if (blocks.length === 0) return <EmptyConversation currentSessionId={currentSessionId} />

  return (
    <div className="grid min-w-0 content-start gap-4 pb-4">
      {blocks.map((block) => (
        <ConversationBlockRow key={block.key} block={block} />
      ))}
    </div>
  )
}

function DebugConversationTimeline() {
  const eventBuffer = useStore((state) => state.eventBuffer)
  const eventBufferVersion = useStore((state) => state.eventBufferVersion)
  const isRunning = useStore((state) => state.isRunning)
  const blocks = useMemo(() => buildConversationBlocks(eventBuffer, true, isRunning), [eventBuffer, eventBufferVersion, isRunning])

  if (blocks.length === 0) return <EmptyConversation currentSessionId={useStore.getState().currentSessionId} />

  // 中文/English: keep expensive raw-event replay inside debug mode only.
  return (
    <div className="grid min-w-0 content-start gap-4 pb-4">
      {blocks.map((block) => (
        <ConversationBlockRow key={block.key} block={block} />
      ))}
    </div>
  )
}

const ConversationBlockRow = memo(function ConversationBlockRow({ block }) {
  return (
    <div className="min-w-0">
      <ChatBlockItem block={block} />
    </div>
  )
})

function EmptyConversation({ currentSessionId }) {
  return (
    <div className="h-full grid place-items-center px-6 text-center">
      <div className="max-w-md grid gap-3">
        <div className="text-base font-bold text-[var(--text)]">{currentSessionId ? '\u5f00\u59cb\u65b0\u7684\u5bf9\u8bdd' : '\u8bf7\u9009\u62e9\u4e00\u4e2a\u4f1a\u8bdd'}</div>
        <div className="text-sm text-[var(--text-muted)] leading-relaxed">
          {currentSessionId
            ? '\u53d1\u9001\u4e00\u6761\u6d88\u606f\u540e\uff0c\u8fd9\u91cc\u4f1a\u5b9e\u65f6\u663e\u793a\u4e0a\u6e38 ACP \u7684\u4e8b\u4ef6\u3001\u56de\u590d\u3001\u5de5\u5177\u8c03\u7528\u548c\u4ea4\u4e92\u8bf7\u6c42\u3002'
            : '\u5de6\u4fa7\u9009\u62e9\u5df2\u6709\u4f1a\u8bdd\uff0c\u6216\u5148\u521b\u5efa\u4e00\u4e2a\u65b0\u4f1a\u8bdd\u540e\u518d\u5f00\u59cb\u4ea4\u4e92\u3002'}
        </div>
      </div>
    </div>
  )
}

function useConversationPhase() {
  const isSubmitting = useStore((state) => state.isSubmitting)
  const isRunning = useStore((state) => state.isRunning)
  const isCancelling = useStore((state) => state.isCancelling)
  const pendingPermissions = useStore((state) => state.pendingPermissions.length)
  const pendingQuestions = useStore((state) => state.pendingQuestions.length)
  const respondingPermissions = useStore((state) => state.respondingPermissionIds.size)
  const respondingQuestions = useStore((state) => state.respondingQuestionIds.size)

  return useMemo(
    () =>
      deriveConversationPhase({
        isSubmitting,
        isRunning,
        isCancelling,
        pendingPermissions,
        pendingQuestions,
        respondingPermissions,
        respondingQuestions,
      }),
    [isSubmitting, isRunning, isCancelling, pendingPermissions, pendingQuestions, respondingPermissions, respondingQuestions],
  )
}
