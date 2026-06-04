import { useState } from 'react'
import { useStore } from '../../store'
import SettingsDrawer from '../sidebar/SettingsDrawer.jsx'
import { ConversationHeader } from './view/ConversationHeader'
import { ConversationPhaseBanner } from './view/ConversationPhaseBanner'
import { ConversationSection } from './view/ConversationSection'
import { ComposerSection } from './view/ComposerSection'

export default function ChatView({ settingsOpen, onOpenSettings, onCloseSettings }) {
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

  return (
    <main className="chat-shell min-h-0 h-full flex flex-col gap-4 overflow-hidden max-[1024px]:order-3 max-[1024px]:h-auto">
      <ConversationHeader currentSessionId={currentSessionId} sessionTitle={sessionTitle} onOpenSettings={onOpenSettings} />
      {flash ? (
        <div className="shrink-0 rounded-[16px] border border-brand/15 bg-brand/10 px-4 py-3 text-xs text-[var(--text-dim)] animate-slide-down">
          {flash}
        </div>
      ) : null}
      <ConversationPhaseBanner currentSessionId={currentSessionId} />
      {currentSessionId ? (
        <ConversationSection currentSessionId={currentSessionId} showDebug={showDebug} />
      ) : (
        <section className="flex-1 min-h-0 overflow-hidden rounded-[28px] border border-[var(--line)] bg-white shadow-[0_16px_38px_rgba(15,23,42,0.07)]">
          <div className="flex h-full items-center justify-center bg-[linear-gradient(180deg,#ffffff,#f8fbff)] px-6 py-8">
            <div className="grid max-w-[520px] gap-4 text-center">
              <div className="mx-auto inline-flex h-16 w-16 items-center justify-center rounded-[20px] bg-brand text-xl font-bold text-white shadow-glow">
                RS
              </div>
              <div className="grid gap-2">
                <h2 className="text-2xl font-bold text-[var(--text)]">开始一段新对话</h2>
                <p className="text-sm leading-relaxed text-[var(--text-muted)]">
                  先从左侧创建或选择一个会话。设置、模型和运行时配置都收拢到了右上角抽屉里，不会再打断主对话区域。
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={onOpenSettings}
                  className="rounded-[14px] bg-brand px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[var(--brand-strong)]"
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
        onOpenSettings={onOpenSettings}
      />
      <SettingsDrawer open={settingsOpen} onClose={onCloseSettings} />
    </main>
  )
}
