import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from '../../../store'
import { Select, useSessionCapabilities, useViewerContext } from '../../sidebar/sidebar-support'
import {
  disposeAttachmentPreprocessResources,
  isCancelledError,
  isSupportedAttachment,
  preprocessAttachment,
  readSupportedAttachmentLabel,
  resetAttachmentPreprocessCache,
} from '../../../store/attachment-preprocess'
import { useConversationPhase } from './useConversationPhase'

export const ComposerSection = memo(function ComposerSection({ currentSessionId, showDebug, setShowDebug, onOpenSettings }) {
  const sendPrompt = useStore((state) => state.sendPrompt)
  const cancelPrompt = useStore((state) => state.cancelPrompt)
  const setFlash = useStore((state) => state.setFlash)
  const updateMode = useStore((state) => state.updateMode)
  const updateModel = useStore((state) => state.updateModel)
  const pendingSettingsAction = useStore((state) => state.pendingSettingsAction)
  const pendingSessionAction = useStore((state) => state.pendingSessionAction)
  const phase = useConversationPhase()
  const capabilities = useSessionCapabilities()
  const { canUpdateMode, canUpdateModel, isSharedSession } = useViewerContext()
  const [attachments, setAttachments] = useState([])
  const attachmentsRef = useRef([])
  const fileInputRef = useRef(null)
  const [promptText, setPromptText] = useState('')
  const sessionPreparing = Boolean(pendingSessionAction)
  const settingsUpdating = Boolean(pendingSettingsAction)
  const hasPendingAttachment = attachments.some((item) => item.status === 'pending' || item.status === 'parsing')
  const hasFailedAttachment = attachments.some((item) => item.status === 'failed')
  const sendDisabled = !currentSessionId || phase.isBusy || sessionPreparing || settingsUpdating || hasPendingAttachment || hasFailedAttachment
  const currentModeId = capabilities.modeId || capabilities.modes?.[0]?.id || ''
  const currentModelId = capabilities.modelId || capabilities.models?.[0]?.id || ''
  const hasProviderConfigured = capabilities.models?.length > 0 || capabilities.availableCommands?.length > 0
  const shouldShowProviderHint = Boolean(currentSessionId) && !sessionPreparing && !settingsUpdating && !hasProviderConfigured

  useEffect(() => {
    attachmentsRef.current = attachments
  }, [attachments])

  const cancelAttachment = useCallback((attachmentId) => {
    setAttachments((current) => {
      const target = current.find((item) => item.id === attachmentId)
      target?.controller?.abort()
      return current.filter((item) => item.id !== attachmentId)
    })
  }, [])

  const startAttachmentPreprocess = useCallback((files) => {
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
  }, [setFlash])

  const handleSend = useCallback(async (event) => {
    event.preventDefault()
    if (!promptText.trim()) return

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
  }, [attachments, promptText, sendPrompt])

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
    <section className="shrink-0 rounded-[28px] border border-[var(--line)] bg-white p-4 shadow-[0_16px_38px_rgba(15,23,42,0.07)]">
      {attachments.length > 0 ? (
        <div className="flex flex-wrap gap-2 pb-3">
          {attachments.map((attachment) => (
            <div
              key={attachment.id}
              className="inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--surface-muted)] px-3 py-1 text-xs text-[var(--text-dim)]"
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
                className="text-[var(--text-muted)] transition-colors hover:text-danger"
                aria-label={`移除附件 ${attachment.file.name}`}
              >
                {attachment.status === 'pending' || attachment.status === 'parsing' ? '取消' : 'x'}
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <form onSubmit={handleSend} className="grid gap-3">
        {shouldShowProviderHint ? (
          <div className="rounded-[16px] border border-brand/20 bg-brand/5 px-4 py-3 text-sm text-brand">
            请先配置 AI 服务才能开始对话。
            <button
              type="button"
              onClick={onOpenSettings}
              className="ml-2 font-semibold underline transition-opacity hover:opacity-80"
            >
              前往配置
            </button>
          </div>
        ) : null}

        <textarea
          value={promptText}
          onChange={(event) => setPromptText(event.target.value)}
          rows={2}
          disabled={sessionPreparing}
          placeholder={
            !currentSessionId
              ? '请先打开一个会话'
              : sessionPreparing
                ? '会话正在打开或恢复，稍后即可发送'
                : '输入消息...'
          }
          className="w-full min-h-[72px] max-h-[220px] resize-y rounded-[18px] border border-[var(--line)] bg-[var(--surface-muted)] px-4 py-3 text-sm text-[var(--text)] outline-none transition-colors focus:border-[var(--brand)] focus:shadow-[0_0_0_3px_rgba(37,99,235,0.10)] placeholder:text-[var(--text-muted)]"
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

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {currentSessionId ? (
              <div className="w-[132px]">
                <Select
                  value={currentModeId}
                  onChange={(nextMode) => {
                    if (!nextMode || nextMode === currentModeId || !canUpdateMode || pendingSettingsAction) return
                    void updateMode(nextMode)
                  }}
                  options={capabilities.modes}
                  emptyLabel="暂无模式"
                  disabled={!canUpdateMode || Boolean(pendingSettingsAction)}
                />
              </div>
            ) : null}

            {currentSessionId ? (
              <div className="w-[188px]">
                <Select
                  value={currentModelId}
                  onChange={(nextModel) => {
                    if (!nextModel || nextModel === currentModelId || !canUpdateModel || pendingSettingsAction) return
                    void updateModel(nextModel)
                  }}
                  options={capabilities.models}
                  emptyLabel="暂无模型"
                  disabled={!canUpdateModel || Boolean(pendingSettingsAction)}
                />
              </div>
            ) : null}

            <label className="relative">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf,.md,.markdown,.xlsx,.csv,image/*"
                onChange={handleFileChange}
                className="sr-only"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="h-10 w-10 rounded-full border border-[var(--line)] bg-[var(--surface-muted)] text-[var(--text-dim)] transition-colors hover:bg-[var(--bg-strong)]"
                aria-label="添加附件"
              >
                +
              </button>
            </label>

            <label className="hidden shrink-0 cursor-pointer items-center gap-1 text-[11px] text-[var(--text-muted)] sm:flex">
              <input
                type="checkbox"
                checked={showDebug}
                onChange={(event) => setShowDebug(event.target.checked)}
                className="h-3.5 w-3.5 accent-brand"
              />
              <span>调试事件</span>
            </label>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {phase.canCancel ? (
              <button
                type="button"
                onClick={() => void cancelPrompt()}
                disabled={!currentSessionId || phase.id === 'cancelling'}
                className="h-10 rounded-full border border-danger/20 bg-danger/10 px-4 text-sm font-semibold text-danger transition-colors hover:bg-danger/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {phase.id === 'cancelling' ? '取消中...' : '停止'}
              </button>
            ) : null}

            <button
              type="submit"
              disabled={sendDisabled}
              aria-label="发送消息"
              className="h-10 w-10 rounded-full bg-brand text-sm font-semibold text-white transition-all hover:bg-[var(--brand-strong)] active:scale-[0.985] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {'->'}
            </button>
          </div>
        </div>

        {isSharedSession ? (
          <div className="px-1 text-[11px] text-[var(--text-muted)]">
            共享工作区会话的模式和模型能力受当前权限控制，无法切换时会保持现状。
          </div>
        ) : null}
      </form>
    </section>
  )
})
