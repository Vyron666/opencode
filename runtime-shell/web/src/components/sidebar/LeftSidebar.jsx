import { useState } from 'react'
import { useStore } from '../../store'
import ConfirmDialog from '../ConfirmDialog.jsx'
import { roleLabel, useViewerContext } from './sidebar-support.jsx'

export default function LeftSidebar() {
  const user = useStore((state) => state.user)
  const sessions = useStore((state) => state.sessions)
  const currentSessionId = useStore((state) => state.currentSessionId)
  const logout = useStore((state) => state.logout)
  const openSession = useStore((state) => state.openSession)
  const loadHistory = useStore((state) => state.loadHistory)
  const resumeSession = useStore((state) => state.resumeSession)
  const closeSession = useStore((state) => state.closeSession)
  const loadSessions = useStore((state) => state.loadSessions)
  const setCurrentSession = useStore((state) => state.setCurrentSession)
  const pendingSessionAction = useStore((state) => state.pendingSessionAction)
  const { canManageSession, canOpenSession, canLoadSession, canResumeSession, isSharedSession, owner } = useViewerContext()
  const [confirmLogout, setConfirmLogout] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)
  const hasCurrentSession = Boolean(currentSessionId)

  return (
    <aside className="min-h-0 h-[calc(100dvh-28px)] grid gap-2.5 content-start overflow-y-auto overflow-x-hidden">
      <div className="rounded-[20px] border border-[var(--line)] bg-[var(--surface)] shadow-md backdrop-blur-2xl p-4">
        <div className="flex gap-3 items-start">
          <div
            className="w-12 h-12 rounded-[14px] grid place-items-center shrink-0 font-extrabold text-sm text-[#14100d]"
            style={{ background: 'linear-gradient(135deg, #d4a05a, #9c6e38)', boxShadow: '0 0 0 1px rgba(212,160,90,0.14), 0 4px 20px rgba(212,160,90,0.08)' }}
            aria-hidden="true"
          >
            RS
          </div>
          <div>
            <span className="text-[10px] font-semibold tracking-[0.14em] uppercase text-brand">Runtime Workspace</span>
            <h2 className="mt-0.5 text-sm font-bold">{'\u4f1a\u8bdd\u5bfc\u822a'}</h2>
            <p className="text-xs text-[var(--text-muted)] leading-relaxed">{'\u9009\u62e9\u4f1a\u8bdd\u3001\u521b\u5efa\u65b0\u4f1a\u8bdd\uff0c\u6216\u7ee7\u7eed\u5386\u53f2\u4e0a\u4e0b\u6587\u3002'}</p>
          </div>
        </div>
      </div>

      {user ? (
        <div className="rounded-[20px] border border-[var(--line)] bg-[var(--surface)] shadow-md backdrop-blur-2xl p-4">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div>
              <span className="text-[10px] font-semibold tracking-[0.14em] uppercase text-brand">Account</span>
              <h3 className="text-sm font-bold mt-0.5">{'\u5f53\u524d\u767b\u5f55'}</h3>
            </div>
            <button
              onClick={() => setConfirmLogout(true)}
              aria-label={'\u9000\u51fa\u767b\u5f55'}
              className="text-xs px-3 py-1.5 rounded-[8px] bg-brand/10 text-brand-text border border-[var(--line)] hover:bg-brand/20 transition-colors focus-visible:ring-2 focus-visible:ring-brand"
            >
              {'\u9000\u51fa'}
            </button>
          </div>
          <div className="grid gap-1">
            <div className="font-bold text-sm">{user.displayName}</div>
            <div className="text-xs text-[var(--text-muted)]">{roleLabel(user.role)}</div>
          </div>
        </div>
      ) : null}

      <div className="rounded-[20px] border border-[var(--line)] bg-[var(--surface)] shadow-md backdrop-blur-2xl p-4">
        <div className="mb-3">
          <span className="text-[10px] font-semibold tracking-[0.14em] uppercase text-brand">Actions</span>
          <h3 className="text-sm font-bold mt-0.5">{'\u4f1a\u8bdd\u64cd\u4f5c'}</h3>
        </div>
        <div className="grid gap-2">
          <button
            onClick={() => openSession()}
            aria-label={'\u6253\u5f00\u5f53\u524d\u9009\u4e2d\u4f1a\u8bdd'}
            disabled={Boolean(pendingSessionAction) || !hasCurrentSession || !canOpenSession}
            className="rounded-[10px] py-2.5 px-4 font-semibold text-sm bg-brand text-[#14100d] hover:brightness-110 active:scale-[0.985] transition-all shadow-glow focus-visible:ring-2 focus-visible:ring-brand"
          >
            {pendingSessionAction === 'open' ? '\u6253\u5f00\u4e2d...' : '\u6253\u5f00\u5f53\u524d\u4f1a\u8bdd'}
          </button>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => loadHistory()}
              aria-label={'\u52a0\u8f7d\u4f1a\u8bdd\u5386\u53f2'}
              disabled={Boolean(pendingSessionAction) || !hasCurrentSession || !canLoadSession}
              className="text-xs px-3 py-1.5 rounded-[8px] bg-brand/10 text-brand-text border border-[var(--line)] hover:bg-brand/20 transition-colors focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {pendingSessionAction === 'load' ? '\u52a0\u8f7d\u4e2d...' : '\u52a0\u8f7d\u5386\u53f2'}
            </button>
            <button
              onClick={() => resumeSession()}
              aria-label={'\u6062\u590d\u4f1a\u8bdd'}
              disabled={Boolean(pendingSessionAction) || !hasCurrentSession || !canResumeSession}
              className="text-xs px-3 py-1.5 rounded-[8px] bg-brand/10 text-brand-text border border-[var(--line)] hover:bg-brand/20 transition-colors focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {pendingSessionAction === 'resume' ? '\u6062\u590d\u4e2d...' : '\u6062\u590d\u4f1a\u8bdd'}
            </button>
          </div>
          <button
            onClick={() => setConfirmClose(true)}
            aria-label={'\u5173\u95ed\u5f53\u524d\u4f1a\u8bdd'}
            disabled={Boolean(pendingSessionAction) || !canManageSession}
            className="text-xs px-3 py-1.5 rounded-[8px] bg-danger/10 text-[#e88a7a] border border-danger/20 hover:bg-danger/20 transition-colors focus-visible:ring-2 focus-visible:ring-danger disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {pendingSessionAction === 'close' ? '\u5173\u95ed\u4e2d...' : '\u5173\u95ed\u5f53\u524d\u4f1a\u8bdd'}
          </button>
          {isSharedSession ? (
            <div className="text-[11px] text-[var(--text-muted)] leading-relaxed">
              {`\u5f53\u524d\u4f1a\u8bdd\u6765\u81ea\u5171\u4eab\u5de5\u4f5c\u533a\u534f\u4f5c${owner?.displayName ? `\uff0c\u5171\u4eab\u4eba\uff1a${owner.displayName}` : ''}\u3002\u4f60\u53ef\u4ee5\u7ee7\u7eed\u5bf9\u8bdd\u548c\u5904\u7406\u4ea4\u4e92\uff0c\u4f46\u4e0d\u80fd\u5173\u95ed\u8be5\u4f1a\u8bdd\u3002`}
            </div>
          ) : !hasCurrentSession ? (
            <div className="text-[11px] text-[var(--text-muted)] leading-relaxed">
              {'\u8bf7\u5148\u4ece\u4e0b\u65b9\u4f1a\u8bdd\u5217\u8868\u4e2d\u9009\u62e9\u4e00\u4e2a\u4f1a\u8bdd\uff0c\u518d\u6267\u884c\u6253\u5f00\u3001\u52a0\u8f7d\u5386\u53f2\u6216\u6062\u590d\u64cd\u4f5c\u3002'}
            </div>
          ) : null}
        </div>
      </div>

      <div className="rounded-[20px] border border-[var(--line)] bg-[var(--surface)] shadow-md backdrop-blur-2xl p-4">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <span className="text-[10px] font-semibold tracking-[0.14em] uppercase text-brand">Sessions</span>
            <h3 className="text-sm font-bold mt-0.5">{'\u6700\u8fd1\u6d3b\u52a8'}</h3>
          </div>
          <button
            onClick={() => loadSessions()}
            aria-label={'\u5237\u65b0\u4f1a\u8bdd\u5217\u8868'}
            disabled={Boolean(pendingSessionAction)}
            className="text-xs px-3 py-1.5 rounded-[8px] bg-brand/10 text-brand-text border border-[var(--line)] hover:bg-brand/20 transition-colors focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {'\u5237\u65b0'}
          </button>
        </div>
        <div className="grid gap-2 max-h-[300px] overflow-y-auto">
          {sessions.length === 0 ? (
            <div className="text-xs text-[var(--text-muted)] text-center py-4 border border-dashed border-[var(--line-strong)] rounded-[14px]">
              {'\u6682\u65e0\u4f1a\u8bdd\uff0c\u8bf7\u5148\u521b\u5efa\u3002'}
            </div>
          ) : null}
          {sessions.map((session) => {
            const isActive = currentSessionId === session.id
            const dotColor =
              session.status === 'active' || session.status === 'running'
                ? '#5a9e7c'
                : session.status === 'pending' || session.status === 'created'
                  ? '#d4a05a'
                  : session.status === 'completed' || session.status === 'closed'
                    ? '#7a6e60'
                    : '#c44a3a'

            return (
              <button
                key={session.id}
                onClick={() => setCurrentSession(session.id)}
                disabled={Boolean(pendingSessionAction)}
                aria-label={`\u9009\u62e9\u4f1a\u8bdd: ${session.title}`}
                aria-current={isActive ? 'true' : undefined}
                className={`w-full text-left p-3 rounded-[14px] border text-sm transition-all ${
                  isActive ? 'border-brand bg-brand/10 shadow-glow' : 'border-[var(--line)] bg-black/30 hover:bg-black/50 hover:border-[var(--line-strong)]'
                } disabled:opacity-60 disabled:cursor-not-allowed`}
              >
                <div className="font-semibold text-sm">{session.title}</div>
                <div className="mt-1.5 text-xs text-[var(--text-muted)] flex items-center gap-1.5">
                  <span className="inline-block w-1.5 h-1.5 rounded-full shrink-0" style={{ background: dotColor }} aria-hidden="true"></span>
                  <span>{session.status}</span>
                  <span aria-hidden="true">/</span>
                  <span>{session.binding?.transport || 'unbound'}</span>
                  <span aria-hidden="true">/</span>
                  <span>{`${session.eventCount || 0} \u4e8b\u4ef6`}</span>
                  {session.visibility === 'workspace_share' ? (
                    <>
                      <span aria-hidden="true">/</span>
                      <span>{'\u5171\u4eab\u5de5\u4f5c\u533a'}</span>
                    </>
                  ) : null}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      <ConfirmDialog
        open={confirmLogout}
        title={'\u9000\u51fa\u767b\u5f55'}
        message={'\u786e\u5b9a\u8981\u9000\u51fa\u5f53\u524d\u8d26\u53f7\u5417\uff1f'}
        confirmLabel={'\u9000\u51fa'}
        onConfirm={() => {
          setConfirmLogout(false)
          logout()
        }}
        onCancel={() => setConfirmLogout(false)}
        danger
      />
      <ConfirmDialog
        open={confirmClose}
        title={'\u5173\u95ed\u4f1a\u8bdd'}
        message={'\u786e\u5b9a\u8981\u5173\u95ed\u5f53\u524d\u4f1a\u8bdd\u5417\uff1f\u6b64\u64cd\u4f5c\u4e0d\u53ef\u64a4\u9500\u3002'}
        confirmLabel={'\u5173\u95ed'}
        onConfirm={() => {
          setConfirmClose(false)
          closeSession()
        }}
        onCancel={() => setConfirmClose(false)}
        danger
      />
    </aside>
  )
}
