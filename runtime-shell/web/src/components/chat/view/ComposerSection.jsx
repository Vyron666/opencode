import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from '../../../store'
import { Field, Select, secondaryButtonClassName, useSessionCapabilities, useViewerContext } from '../../sidebar/sidebar-support'
import {
  disposeAttachmentPreprocessResources,
  isCancelledError,
  isSupportedAttachment,
  preprocessAttachment,
  readSupportedAttachmentLabel,
  resetAttachmentPreprocessCache,
} from '../../../store/attachment-preprocess'
import { useConversationPhase } from './useConversationPhase'

export const ComposerSection = memo(function ComposerSection({ currentSessionId, showDebug, setShowDebug }) {
  const sendPrompt = useStore((state) => state.sendPrompt)
  const setFlash = useStore((state) => state.setFlash)
  const updateMode = useStore((state) => state.updateMode)
  const pendingSettingsAction = useStore((state) => state.pendingSettingsAction)
  const pendingSessionAction = useStore((state) => state.pendingSessionAction)
  const phase = useConversationPhase()
  const capabilities = useSessionCapabilities()
  const { canUpdateMode, isSharedSession } = useViewerContext()
  const [attachments, setAttachments] = useState([])
  const attachmentsRef = useRef([])
  const [promptText, setPromptText] = useState('')
  const [selectedMode, setSelectedMode] = useState('')
  const sessionPreparing = Boolean(pendingSessionAction)
  const hasPendingAttachment = attachments.some((item) => item.status === 'pending' || item.status === 'parsing')
  const hasFailedAttachment = attachments.some((item) => item.status === 'failed')
  const sendDisabled = !currentSessionId || phase.isBusy || sessionPreparing || hasPendingAttachment || hasFailedAttachment

  useEffect(() => {
    attachmentsRef.current = attachments
  }, [attachments])

  useEffect(() => {
    setSelectedMode(capabilities.modeId || capabilities.modes?.[0]?.id || '')
  }, [capabilities.modeId, capabilities.modes, currentSessionId])

  const cancelAttachment = useCallback((attachmentId) => {
    setAttachments((current) => {
      const target = current.find((item) => item.id === attachmentId)
      target?.controller?.abort()
      return current.filter((item) => item.id !== attachmentId)
    })
  }, [])

  const startAttachmentPreprocess = useCallback(
    (files) => {
      const supported = []
      const unsupported = []

      files.forEach((file) => {
        if (isSupportedAttachment(file)) {
          supported.push(file)
          return
        }
        unsupported.push(file.name)
      })

      if (unsupported.length > 0) {
        setFlash(`暂不支持这些附件格式：${unsupported.join('、')}。当前仅支持 PDF、Markdown、XLSX、CSV 和图片。`)
      }
      if (supported.length === 0) return

      const entries = supported.map((file) => ({
        id: `${file.name}-${file.size}-${file.lastModified}-${crypto.randomUUID()}`,
        file,
        label: readSupportedAttachmentLabel(file),
        status: 'pending',
        progress: 0,
        progressMessage: '等待解析',
        error: '',
        part: null,
        controller: new AbortController(),
      }))

      setAttachments((current) => [...current, ...entries])

      entries.forEach((entry) => {
        setAttachments((current) =>
          current.map((item) => (item.id === entry.id ? { ...item, status: 'parsing', progress: 0.02, progressMessage: '开始解析' } : item)),
        )

        void preprocessAttachment(
          entry.file,
          entry.controller.signal,
          ({ progress, message }) => {
            setAttachments((current) =>
              current.map((item) =>
                item.id === entry.id
                  ? {
                      ...item,
                      status: 'parsing',
                      progress: typeof progress === 'number' ? progress : item.progress,
                      progressMessage: typeof message === 'string' && message ? message : item.progressMessage,
                    }
                  : item,
              ),
            )
          },
        ).then(
          (result) => {
            setAttachments((current) =>
              current.map((item) =>
                item.id === entry.id
                  ? {
                      ...item,
                      status: 'ready',
                      progress: 1,
                      progressMessage: '解析完成',
                      error: '',
                      part: result.part,
                    }
                  : item,
              ),
            )
          },
          (error) => {
            if (isCancelledError(error)) {
              setAttachments((current) => current.filter((item) => item.id !== entry.id))
              return
            }

            setAttachments((current) =>
              current.map((item) =>
                item.id === entry.id
                  ? {
                      ...item,
                      status: 'failed',
                      progressMessage: '解析失败',
                      error: error instanceof Error ? error.message : String(error),
                    }
                  : item,
              ),
            )
          },
        )
      })
    },
    [setFlash],
  )

  const handleSend = useCallback(
    async (event) => {
      event.preventDefault()
      if (!promptText.trim()) return
      if (canUpdateMode && selectedMode && selectedMode !== capabilities.modeId) {
        await updateMode(selectedMode)
      }
      const sent = await sendPrompt(
        promptText,
        attachments
          .filter((item) => item.status === 'ready' && item.part)
          .map((item) => item.part),
      )
      if (!sent) return
      setPromptText('')
      setAttachments((current) => {
        current.forEach((item) => item.controller?.abort())
        return []
      })
    },
    [attachments, capabilities.modeId, canUpdateMode, promptText, selectedMode, sendPrompt, updateMode],
  )

  const handleDrop = useCallback((event) => {
    event.preventDefault()
    event.currentTarget.classList.remove('is-dragover')
    const files = Array.from(event.dataTransfer.files || [])
    if (!files.length) return
    startAttachmentPreprocess(files)
  }, [startAttachmentPreprocess])

  const handleFileChange = useCallback((event) => {
    const files = Array.from(event.target.files || [])
    if (!files.length) return
    startAttachmentPreprocess(files)
    event.target.value = ''
  }, [startAttachmentPreprocess])

  useEffect(
    () => () => {
      attachmentsRef.current.forEach((item) => item.controller?.abort())
      void disposeAttachmentPreprocessResources()
      resetAttachmentPreprocessCache()
    },
    [],
  )

  return (
    <section className="shrink-0 rounded-[20px] border border-[var(--line)] bg-[var(--surface)] shadow-md backdrop-blur-2xl p-3">
      {attachments.length > 0 ? (
        <div className="flex flex-wrap gap-2 pb-3">
          {attachments.map((attachment) => (
            <div
              key={attachment.id}
              className="inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-black/30 px-3 py-1 text-xs text-[var(--text-dim)]"
            >
              <span className="max-w-[180px] truncate">{attachment.file.name}</span>
              <span className="text-[10px] uppercase tracking-[0.08em] text-brand/90">{attachment.label}</span>
              <span className="text-[10px] text-[var(--text-muted)]">
                {attachment.status === 'pending'
                  ? '待解析'
                  : attachment.status === 'parsing'
                    ? `解析中 ${Math.max(1, Math.round((attachment.progress || 0) * 100))}%`
                    : attachment.status === 'ready'
                      ? '可发送'
                      : '解析失败'}
              </span>
              {attachment.status === 'parsing' || attachment.status === 'ready' ? (
                <span className="max-w-[220px] truncate text-[10px] text-[var(--text-muted)]">{attachment.progressMessage}</span>
              ) : null}
              {attachment.status === 'failed' && attachment.error ? (
                <span className="max-w-[220px] truncate text-danger">{attachment.error}</span>
              ) : null}
              <button
                type="button"
                onClick={() => cancelAttachment(attachment.id)}
                className="text-[var(--text-muted)] hover:text-danger transition-colors"
                aria-label={`移除附件 ${attachment.file.name}`}
              >
                {attachment.status === 'pending' || attachment.status === 'parsing' ? '取消' : '×'}
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
          disabled={sessionPreparing}
          placeholder={
            !currentSessionId
              ? '请先打开一个会话'
              : sessionPreparing
                ? '会话正在打开或恢复，稍后即可发送'
                : '输入消息...'
          }
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
              {isSharedSession ? <span className="text-[11px] text-[var(--text-muted)]">共享工作区会话不允许切换模式</span> : null}
            </div>
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
              <Field label={'模式'}>
                <Select value={selectedMode} onChange={setSelectedMode} options={capabilities.modes} emptyLabel={'当前会话没有可选模式'} />
              </Field>
              <button
                type="button"
                disabled={!selectedMode || !currentSessionId || Boolean(pendingSettingsAction) || !canUpdateMode}
                onClick={() => void updateMode(selectedMode)}
                className={secondaryButtonClassName}
              >
                {pendingSettingsAction === 'mode' ? '切换中...' : '切换模式'}
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
              <span>{'调试事件'}</span>
            </label>

            <label className="text-[11px] px-2.5 py-1.5 rounded-[8px] bg-brand/10 text-brand-text border border-[var(--line)] hover:bg-brand/20 transition-colors cursor-pointer shrink-0 relative overflow-hidden">
              {'添加附件'}
              <input
                type="file"
                multiple
                accept=".pdf,.md,.markdown,.xlsx,.csv,image/*"
                onChange={handleFileChange}
                className="absolute inset-0 opacity-0 cursor-pointer"
              />
            </label>
          </div>

          <button
            type="submit"
            disabled={sendDisabled}
            className="rounded-[10px] py-2 px-4 font-semibold text-sm bg-brand text-[#14100d] hover:brightness-110 active:scale-[0.985] transition-all shadow-glow disabled:opacity-50 disabled:cursor-not-allowed shrink-0 min-w-[84px]"
          >
            {sessionPreparing
              ? '会话准备中...'
              : phase.id === 'submitting'
                ? '发送中...'
                : phase.id === 'cancelling'
                  ? '取消中...'
                  : hasPendingAttachment
                    ? '解析附件中...'
                    : hasFailedAttachment
                      ? '附件需要处理'
                      : phase.id === 'running'
                        ? '模型生成中...'
                        : phase.id === 'waiting_permission'
                          ? '等待审批中...'
                          : phase.id === 'waiting_question'
                            ? '等待回答中...'
                            : '发送'}
          </button>
        </div>
      </form>
    </section>
  )
})
