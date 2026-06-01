import { memo, useCallback, useEffect, useState } from 'react'
import { useStore } from '../../../store'
import { Field, Select, secondaryButtonClassName, useSessionCapabilities, useViewerContext } from '../../sidebar/sidebar-support'
import { useConversationPhase } from './useConversationPhase'

export const ComposerSection = memo(function ComposerSection({ currentSessionId, showDebug, setShowDebug }) {
  const sendPrompt = useStore((state) => state.sendPrompt)
  const updateMode = useStore((state) => state.updateMode)
  const pendingSettingsAction = useStore((state) => state.pendingSettingsAction)
  const pendingSessionAction = useStore((state) => state.pendingSessionAction)
  const phase = useConversationPhase()
  const capabilities = useSessionCapabilities()
  const { canUpdateMode, isSharedSession } = useViewerContext()
  const [attachments, setAttachments] = useState([])
  const [promptText, setPromptText] = useState('')
  const [selectedMode, setSelectedMode] = useState('')
  const sessionPreparing = Boolean(pendingSessionAction)
  const sendDisabled = !currentSessionId || phase.isBusy || sessionPreparing

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
          disabled={sessionPreparing}
          placeholder={
            !currentSessionId
              ? '\u8bf7\u5148\u6253\u5f00\u4e00\u4e2a\u4f1a\u8bdd'
              : sessionPreparing
                ? '\u4f1a\u8bdd\u6b63\u5728\u6253\u5f00\u6216\u6062\u590d\uff0c\u7a0d\u540e\u5373\u53ef\u53d1\u9001'
                : '\u8f93\u5165\u6d88\u606f...'
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
            {sessionPreparing
              ? '\u4f1a\u8bdd\u51c6\u5907\u4e2d...'
              : phase.id === 'submitting'
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
