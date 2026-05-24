import { memo, useRef, useEffect, useState, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useStore } from '../../store'
import { buildConversationBlocks } from './conversation-blocks'
import { ChatBlockItem } from './chat-blocks'
import { deriveConversationPhase } from '../../store/runtime-phase'

export default function ChatView() {
  const conversationBlocks = useStore((state) => state.conversationBlocks)
  const eventBuffer = useStore((state) => state.eventBuffer)
  const eventBufferVersion = useStore((state) => state.eventBufferVersion)
  const isSubmitting = useStore((state) => state.isSubmitting)
  const isRunning = useStore((state) => state.isRunning)
  const isCancelling = useStore((state) => state.isCancelling)
  const pendingPermissions = useStore((state) => state.pendingPermissions)
  const pendingQuestions = useStore((state) => state.pendingQuestions)
  const respondingPermissionIds = useStore((state) => state.respondingPermissionIds)
  const respondingQuestionIds = useStore((state) => state.respondingQuestionIds)
  const flash = useStore((state) => state.flash)
  const currentSessionId = useStore((state) => state.currentSessionId)
  const sessionDetail = useStore((state) => state.sessionDetail)
  const sendPrompt = useStore((state) => state.sendPrompt)
  const cancelPrompt = useStore((state) => state.cancelPrompt)
  const connectSSE = useStore((state) => state.connectSSE)

  const timelineRef = useRef(null)
  const [autoScroll, setAutoScroll] = useState(true)
  const [showDebug, setShowDebug] = useState(false)
  const [attachments, setAttachments] = useState([])
  const [promptText, setPromptText] = useState('')
  const conversationPhase = useMemo(
    () =>
      deriveConversationPhase({
        isSubmitting,
        isRunning,
        isCancelling,
        pendingPermissions: pendingPermissions.length,
        pendingQuestions: pendingQuestions.length,
        respondingPermissions: respondingPermissionIds.size,
        respondingQuestions: respondingQuestionIds.size,
      }),
    [isSubmitting, isRunning, isCancelling, pendingPermissions.length, pendingQuestions.length, respondingPermissionIds.size, respondingQuestionIds.size],
  )
  const sendDisabled = !currentSessionId || conversationPhase.isBusy
  const blocks = useMemo(
    () => (showDebug ? buildConversationBlocks(eventBuffer, true, isRunning) : conversationBlocks),
    [conversationBlocks, eventBuffer, eventBufferVersion, isRunning, showDebug],
  )

  useEffect(() => {
    if (!autoScroll || !timelineRef.current) return
    timelineRef.current.scrollTop = timelineRef.current.scrollHeight
  }, [blocks, autoScroll])

  const handleScroll = useCallback(() => {
    const element = timelineRef.current
    if (!element) return
    setAutoScroll(element.scrollHeight - element.scrollTop - element.clientHeight < 80)
  }, [])

  const scrollToBottom = () => {
    if (!timelineRef.current) return
    timelineRef.current.scrollTop = timelineRef.current.scrollHeight
    setAutoScroll(true)
  }

  const handleSend = async (event) => {
    event.preventDefault()
    if (!promptText.trim()) return
    const sent = await sendPrompt(promptText, attachments)
    if (!sent) return
    setPromptText('')
    setAttachments([])
  }

  const handleDrop = (event) => {
    event.preventDefault()
    event.currentTarget.classList.remove('is-dragover')
    const files = Array.from(event.dataTransfer.files || [])
    if (!files.length) return
    setAttachments((current) => [...current, ...files])
  }

  const handleFileChange = (event) => {
    const files = Array.from(event.target.files || [])
    if (!files.length) return
    setAttachments((current) => [...current, ...files])
    event.target.value = ''
  }

  const removeAttachment = (index) => {
    setAttachments((current) => current.filter((_, currentIndex) => currentIndex !== index))
  }

  return (
    <main className="chat-shell min-h-0 h-[calc(100dvh-28px)] flex flex-col gap-2.5 overflow-hidden">
      <header className="shrink-0 flex items-start justify-between gap-4 px-4 py-3 rounded-[20px] border border-[var(--line)] bg-[var(--surface)] shadow-md backdrop-blur-2xl">
        <div className="min-w-0">
          <span className="text-[10px] font-semibold tracking-[0.14em] uppercase text-brand">Conversation</span>
          <h1 className="text-base font-bold mt-0.5 truncate">{sessionDetail?.session?.title || '未选择会话'}</h1>
          <p className="text-xs text-[var(--text-muted)] mt-1 truncate">
            {currentSessionId ? `会话 ID：${currentSessionId}` : '请先在左侧选择会话，或在右侧创建一个新会话。'}
          </p>
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            <span className="rounded-full border border-[var(--line)] bg-black/25 px-2.5 py-1 text-[11px] font-semibold text-[var(--text-dim)]">
              状态：{conversationPhase.label}
            </span>
            {currentSessionId && <span className="text-[11px] text-[var(--text-muted)]">{conversationPhase.detail}</span>}
          </div>
        </div>
        <div className="flex gap-2 flex-wrap justify-end shrink-0">
          <button
            onClick={() => connectSSE()}
            aria-label="重新连接事件流"
            className="text-xs px-3 py-1.5 rounded-[8px] bg-brand/10 text-brand-text border border-[var(--line)] hover:bg-brand/20 transition-colors focus-visible:ring-2 focus-visible:ring-brand"
          >
            重新连接事件流
          </button>
          <button
            onClick={() => cancelPrompt()}
            disabled={!conversationPhase.canCancel || !currentSessionId}
            aria-label="暂停当前生成"
            className="text-xs px-3 py-1.5 rounded-[8px] bg-danger/10 text-danger border border-danger/20 hover:bg-danger/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {conversationPhase.id === 'cancelling'
              ? '取消中...'
              : conversationPhase.canCancel
                ? '暂停生成'
                : conversationPhase.id === 'waiting_permission'
                  ? '等待审批中'
                  : conversationPhase.id === 'waiting_question'
                    ? '等待回答中'
                    : '暂停生成'}
          </button>
        </div>
      </header>

      {flash && (
        <div className="shrink-0 rounded-[14px] px-3.5 py-2 bg-brand/10 border border-[var(--line)] text-xs text-[var(--text-dim)] animate-slide-down">
          {flash}
        </div>
      )}

      {currentSessionId && conversationPhase.id !== 'idle' && (
        <div className="shrink-0 rounded-[14px] px-3.5 py-2 border border-[var(--line)] bg-black/30 text-xs text-[var(--text-dim)]">
          {conversationPhase.detail}
        </div>
      )}

      <section className="flex-1 min-h-0 rounded-[20px] border border-[var(--line)] bg-[var(--surface)] shadow-md overflow-hidden">
        <div
          ref={timelineRef}
          onScroll={handleScroll}
          className="relative h-full overflow-y-auto px-4 py-4"
          style={{ background: 'linear-gradient(180deg, rgba(20,16,13,0.3), rgba(20,16,13,0.55))' }}
        >
          {blocks.length === 0 ? (
            <EmptyConversation currentSessionId={currentSessionId} />
          ) : (
            <div className="grid content-start gap-4 pb-4">
              <AnimatePresence initial={false}>
                {blocks.map((block) => (
                  <ConversationBlockRow key={block.key} block={block} />
                ))}
              </AnimatePresence>
            </div>
          )}

          <AnimatePresence>
            {!autoScroll && blocks.length > 0 && (
              <motion.button
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                onClick={scrollToBottom}
                className="absolute right-4 bottom-4 z-10 rounded-full px-4 py-2 text-xs font-semibold"
                style={{ background: 'rgba(212,160,90,0.92)', color: '#14100d', boxShadow: '0 8px 24px rgba(212,160,90,0.25)' }}
              >
                回到底部
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      </section>

      <section className="shrink-0 rounded-[20px] border border-[var(--line)] bg-[var(--surface)] shadow-md backdrop-blur-2xl p-3">
        {attachments.length > 0 && (
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
                  aria-label={`移除附件 ${file.name}`}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        <form onSubmit={handleSend} className="grid gap-2.5">
          <textarea
            value={promptText}
            onChange={(event) => setPromptText(event.target.value)}
            rows={3}
            placeholder={currentSessionId ? '输入消息...' : '请先打开一个会话'}
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

          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3 flex-wrap">
              <label className="hidden sm:flex items-center gap-1 text-[11px] text-[var(--text-muted)] cursor-pointer shrink-0">
                <input
                  type="checkbox"
                  checked={showDebug}
                  onChange={(event) => setShowDebug(event.target.checked)}
                  className="w-3.5 h-3.5 accent-brand"
                />
                <span>调试事件</span>
              </label>

              <label className="text-[11px] px-2.5 py-1.5 rounded-[8px] bg-brand/10 text-brand-text border border-[var(--line)] hover:bg-brand/20 transition-colors cursor-pointer shrink-0 relative overflow-hidden">
                添加附件
                <input type="file" multiple onChange={handleFileChange} className="absolute inset-0 opacity-0 cursor-pointer" />
              </label>
            </div>

            <button
              type="submit"
              disabled={sendDisabled}
              className="rounded-[10px] py-2 px-4 font-semibold text-sm bg-brand text-[#14100d] hover:brightness-110 active:scale-[0.985] transition-all shadow-glow disabled:opacity-50 disabled:cursor-not-allowed shrink-0 min-w-[84px]"
            >
              {conversationPhase.id === 'submitting'
                ? '发送中...'
                : conversationPhase.id === 'cancelling'
                  ? '取消中...'
                  : conversationPhase.id === 'running'
                    ? '模型生成中...'
                    : conversationPhase.id === 'waiting_permission'
                      ? '等待审批中...'
                      : conversationPhase.id === 'waiting_question'
                        ? '等待回答中...'
                        : '发送'}
            </button>
          </div>
        </form>
      </section>
    </main>
  )
}

const ConversationBlockRow = memo(function ConversationBlockRow({ block }) {
  ////////////// runtime-shell customization start //////////////
  // 中文/English: memoized rows keep unchanged blocks out of the hot streaming
  // render path so the latest chunk can appear almost immediately.
  ////////////// runtime-shell customization end //////////////
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}>
      <ChatBlockItem block={block} />
    </motion.div>
  )
})

function EmptyConversation({ currentSessionId }) {
  return (
    <div className="h-full grid place-items-center px-6 text-center">
      <div className="max-w-md grid gap-3">
        <div className="text-base font-bold text-[var(--text)]">{currentSessionId ? '开始新的对话' : '请选择一个会话'}</div>
        <div className="text-sm text-[var(--text-muted)] leading-relaxed">
          {currentSessionId
            ? '发送一条消息后，这里会实时显示上游 ACP 的事件、回复、工具调用和交互请求。'
            : '左侧选择已有会话，或先创建一个新会话后再开始交互。'}
        </div>
      </div>
    </div>
  )
}
