import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../../../api'
import { useStore } from '../../../store'
import {
  disposeAttachmentPreprocessResources,
  isCancelledError,
  isSupportedAttachment,
  preprocessAttachment,
  readSupportedAttachmentLabel,
  resetAttachmentPreprocessCache,
} from '../../../store/attachment-preprocess'
import { useConversationPhase } from './useConversationPhase'
import { useSessionCapabilities, useViewerContext } from '../../sidebar/sidebar-support'

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
  const [skillStatusLabel, setSkillStatusLabel] = useState('未配置')
  const [mcpStatusLabel, setMcpStatusLabel] = useState('未配置')
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

  useEffect(() => {
    if (pendingSettingsAction) return

    let disposed = false
    void Promise.all([
      api.skillPackage.list().catch(() => ({ items: [] })),
      api.skillConfig.get().catch(() => ({ items: [] })),
      api.mcpConfig.get().catch(() => ({ items: [] })),
    ]).then(([skillPackageData, skillConfigData, mcpConfigData]) => {
      if (disposed) return
      // 中文/English: the composer must reflect real configured runtime resources,
      // not session command counts or builtin templates.
      const skillPackageCount = Array.isArray(skillPackageData.items) ? skillPackageData.items.length : 0
      const skillConfigCount = Array.isArray(skillConfigData.items) ? skillConfigData.items.length : 0
      const skillCount = skillPackageCount > 0 ? skillPackageCount : skillConfigCount
      const mcpCount = Array.isArray(mcpConfigData.items) ? mcpConfigData.items.length : 0
      setSkillStatusLabel(skillCount > 0 ? `${skillCount} 项` : '未配置')
      setMcpStatusLabel(mcpCount > 0 ? `${mcpCount} 项` : '未配置')
    })

    return () => {
      disposed = true
    }
  }, [pendingSettingsAction])

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
    <section className="shrink-0 border-t border-[#eef2ff] bg-white px-4 pb-4 pt-3 max-[1024px]:px-3">
      {attachments.length > 0 ? (
        <div className="flex flex-wrap gap-2 pb-3">
          {attachments.map((attachment) => (
            <div
              key={attachment.id}
              className="inline-flex items-center gap-2 rounded-full border border-[#dbe5f6] bg-[#f6f8fe] px-3 py-1.5 text-xs text-[#61718d]"
            >
              <span className="max-w-[180px] truncate">{attachment.file.name}</span>
              <span className="text-[10px] uppercase tracking-[0.08em] text-[#3566df]">{attachment.label}</span>
              <span className="text-[10px] text-[#8a96ab]">
                {attachment.status === 'pending'
                  ? '待解析'
                  : attachment.status === 'parsing'
                    ? `解析中 ${Math.max(1, Math.round((attachment.progress || 0) * 100))}%`
                    : attachment.status === 'ready'
                      ? '可发送'
                      : '解析失败'}
              </span>
              {attachment.status === 'parsing' || attachment.status === 'ready' ? (
                <span className="max-w-[220px] truncate text-[10px] text-[#8a96ab]">{attachment.progressMessage}</span>
              ) : null}
              {attachment.status === 'failed' && attachment.error ? (
                <span className="max-w-[220px] truncate text-[#cf4040]">{attachment.error}</span>
              ) : null}
              <button
                type="button"
                onClick={() => cancelAttachment(attachment.id)}
                className="text-[#8a96ab] transition-colors hover:text-[#cf4040]"
                aria-label={`移除附件 ${attachment.file.name}`}
              >
                {attachment.status === 'pending' || attachment.status === 'parsing' ? '取消' : '×'}
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <form onSubmit={handleSend} className="grid gap-3">
        {shouldShowProviderHint ? (
          <div className="rounded-[14px] border border-[#dbe5f6] bg-[#f6f8fe] px-4 py-3 text-sm text-[#3566df]">
            请先配置 AI 服务才能开始对话。
            <button
              type="button"
              onClick={() => onOpenSettings('provider')}
              className="ml-2 font-semibold underline transition-opacity hover:opacity-80"
            >
              前往配置
            </button>
          </div>
        ) : null}

        <div className="rounded-[22px] border border-[#dbe6fb] bg-white px-4 py-3 shadow-[0_12px_28px_rgba(15,23,42,0.06)]">
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
            className="min-h-[88px] max-h-[240px] w-full resize-y border-0 bg-transparent px-1 py-1 text-sm leading-6 text-[#18233b] outline-none placeholder:text-[#97a4ba]"
            onDragOver={(event) => event.preventDefault()}
            onDrop={handleDrop}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || event.shiftKey) return
              event.preventDefault()
              if (!sendDisabled) void handleSend(event)
            }}
          />

          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-[#edf1fb] pt-3">
            <div className="flex flex-wrap items-center gap-2">
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
                  className="grid h-10 w-10 place-items-center rounded-[12px] border border-[#dbe6fb] bg-white text-[18px] text-[#61718d] transition-colors hover:bg-[#f5f8ff]"
                  aria-label="添加附件"
                >
                  +
                </button>
              </label>

              {currentSessionId ? (
                <MiniSelect
                  value={currentModeId}
                  onChange={(nextMode) => {
                    if (!nextMode || nextMode === currentModeId || !canUpdateMode || pendingSettingsAction) return
                    void updateMode(nextMode)
                  }}
                  options={capabilities.modes}
                  disabled={!canUpdateMode || Boolean(pendingSettingsAction)}
                />
              ) : null}

              {currentSessionId ? (
                <MiniSelect
                  value={currentModelId}
                  onChange={(nextModel) => {
                    if (!nextModel || nextModel === currentModelId || !canUpdateModel || pendingSettingsAction) return
                    void updateModel(nextModel)
                  }}
                  options={capabilities.models}
                  disabled={!canUpdateModel || Boolean(pendingSettingsAction)}
                />
              ) : null}

              <button
                type="button"
                onClick={() => onOpenSettings('skill')}
                className="inline-flex items-center gap-2 rounded-[12px] border border-[#dbe6fb] bg-[#f8faff] px-3 py-2 text-sm text-[#46546d] transition-colors hover:bg-[#f1f5ff]"
              >
                <span className="font-semibold text-[#18233b]">Skill</span>
                <span className="text-[11px] text-[#8a96ab]">{skillStatusLabel}</span>
              </button>

              <button
                type="button"
                onClick={() => onOpenSettings('mcp')}
                className="inline-flex items-center gap-2 rounded-[12px] border border-[#dbe6fb] bg-[#f8faff] px-3 py-2 text-sm text-[#46546d] transition-colors hover:bg-[#f1f5ff]"
              >
                <span className="font-semibold text-[#18233b]">MCP</span>
                <span className="text-[11px] text-[#8a96ab]">{mcpStatusLabel}</span>
              </button>

              <label className="hidden cursor-pointer items-center gap-1 text-[11px] text-[#8a96ab] sm:flex">
                <input
                  type="checkbox"
                  checked={showDebug}
                  onChange={(event) => setShowDebug(event.target.checked)}
                  className="h-3.5 w-3.5 accent-[#3566df]"
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
                  className="h-10 rounded-[12px] border border-[#efc4c4] bg-[#fff3f3] px-4 text-sm font-semibold text-[#cf4040] transition-colors hover:bg-[#ffeaea] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {phase.id === 'cancelling' ? '取消中...' : '停止'}
                </button>
              ) : null}

              <button
                type="submit"
                disabled={sendDisabled}
                className="h-10 rounded-[12px] bg-[#3566df] px-4 text-sm font-semibold text-white transition-all hover:bg-[#2f5fd7] active:scale-[0.985] disabled:cursor-not-allowed disabled:opacity-50"
              >
                → 发送
              </button>
            </div>
          </div>
        </div>

        {isSharedSession ? (
          <div className="px-1 text-[11px] text-[#8a96ab]">
            共享工作区会话的模式和模型能力受当前权限控制，无法切换时会保持现状。
          </div>
        ) : null}
      </form>
    </section>
  )
})

function MiniSelect({ value, onChange, options, disabled }) {
  if (!Array.isArray(options) || options.length === 0) return null

  return (
    <label className="relative">
      <select
        value={value}
        onChange={(event) => onChange?.(event.target.value)}
        disabled={disabled}
        className="h-10 rounded-[12px] border border-[#dbe6fb] bg-[#f8faff] px-3 pr-8 text-sm text-[#46546d] outline-none transition-colors hover:bg-[#f1f5ff] disabled:cursor-not-allowed disabled:opacity-50"
        style={{ appearance: 'none' }}
      >
        {options.map((option) => (
          <option key={option.id || option.value} value={option.id || option.value}>
            {option.label || option.name || option.id || option.value}
          </option>
        ))}
      </select>
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-[#8a96ab]">▼</span>
    </label>
  )
}
