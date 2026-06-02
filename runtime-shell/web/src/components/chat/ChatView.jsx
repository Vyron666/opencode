import { useState } from 'react'
import { useStore } from '../../store'
import SettingsDrawer from '../sidebar/SettingsDrawer.jsx'
import { ConversationHeader } from './view/ConversationHeader'
import { ConversationPhaseBanner } from './view/ConversationPhaseBanner'
import { ConversationSection } from './view/ConversationSection'
import { ComposerSection } from './view/ComposerSection'

export default function ChatView() {
  const currentSessionId = useStore((state) => state.currentSessionId)
  const flash = useStore((state) => state.flash)
  const sessionTitle = useStore((state) =>
    state.sessionDetail?.session?.title ||
    state.capabilities.sessionInfo?.title ||
    (state.currentSessionId
      ? state.sessions.find((session) => session.id === state.currentSessionId)?.title || ''
      : ''),
  )
  const [showDebug, setShowDebug] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  return (
    <main className="chat-shell min-h-0 h-[calc(100dvh-28px)] flex flex-col gap-2.5 overflow-hidden max-[1024px]:order-3 max-[1024px]:h-auto">
      <ConversationHeader currentSessionId={currentSessionId} sessionTitle={sessionTitle} onOpenSettings={() => setSettingsOpen(true)} />
      {flash ? (
        <div className="shrink-0 rounded-[14px] px-3.5 py-2 bg-brand/10 border border-[var(--line)] text-xs text-[var(--text-dim)] animate-slide-down">
          {flash}
        </div>
      ) : null}
      <ConversationPhaseBanner currentSessionId={currentSessionId} />
      {currentSessionId ? (
        <ConversationSection currentSessionId={currentSessionId} showDebug={showDebug} />
      ) : (
        <section className="flex-1 min-h-0 rounded-[20px] border border-[var(--line)] bg-[var(--surface)] shadow-md overflow-hidden">
          <div className="h-full px-6 py-8 flex items-center justify-center">
            <div className="max-w-[520px] text-center grid gap-4">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-[18px] mx-auto bg-brand/15 text-brand text-xl font-bold">
                RS
              </div>
              <div className="grid gap-2">
                <h2 className="text-2xl font-bold">开始一段新对话</h2>
                <p className="text-sm text-[var(--text-muted)] leading-relaxed">
                  先从左侧创建或选择一个会话。设置、模型和运行时配置都已经收进右上角的设置抽屉，不会再打断主对话区域。
                </p>
              </div>
              <div className="flex items-center justify-center gap-3 flex-wrap">
                <button
                  type="button"
                  onClick={() => setSettingsOpen(true)}
                  className="rounded-[12px] px-4 py-2.5 text-sm font-semibold bg-black/20 text-[var(--text-dim)] border border-[var(--line)] hover:bg-black/35 transition-colors"
                >
                  打开设置
                </button>
              </div>
            </div>
          </div>
        </section>
      )}
      <ComposerSection
        currentSessionId={currentSessionId}
        showDebug={showDebug}
        setShowDebug={setShowDebug}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <SettingsDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </main>
  )
}
