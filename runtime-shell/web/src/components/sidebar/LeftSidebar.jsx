import { useMemo, useState } from 'react'
import { useStore } from '../../store'
import ConfirmDialog from '../ConfirmDialog.jsx'
import { roleLabel, secondaryButtonClassName, useViewerContext } from './sidebar-support.jsx'

export default function LeftSidebar() {
  const user = useStore((state) => state.user)
  const sessions = useStore((state) => state.sessions)
  const currentSessionId = useStore((state) => state.currentSessionId)
  const createQuickSession = useStore((state) => state.createQuickSession)
  const logout = useStore((state) => state.logout)
  const loadHistory = useStore((state) => state.loadHistory)
  const resumeSession = useStore((state) => state.resumeSession)
  const closeSession = useStore((state) => state.closeSession)
  const loadSessions = useStore((state) => state.loadSessions)
  const setCurrentSession = useStore((state) => state.setCurrentSession)
  const pendingSessionAction = useStore((state) => state.pendingSessionAction)
  const { canManageSession, canLoadSession, canResumeSession, isSharedSession, owner } = useViewerContext()
  const [confirmLogout, setConfirmLogout] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)
  const [actionsOpen, setActionsOpen] = useState(false)
  const [query, setQuery] = useState('')
  const hasCurrentSession = Boolean(currentSessionId)
  const filteredSessions = useMemo(() => {
    const trimmedQuery = query.trim().toLowerCase()
    if (!trimmedQuery) return sessions
    return sessions.filter((session) => {
      const title = String(session.title || '').toLowerCase()
      const preview = String(readSessionPreview(session) || '').toLowerCase()
      return title.includes(trimmedQuery) || preview.includes(trimmedQuery)
    })
  }, [query, sessions])

  return (
    <aside className="min-h-0 h-[calc(100dvh-28px)] flex flex-col gap-2.5 overflow-hidden max-[1024px]:order-1 max-[1024px]:h-auto">
      <div className="rounded-[20px] border border-[var(--line)] bg-[var(--surface)] shadow-md backdrop-blur-2xl p-4 grid gap-3">
        <div className="flex items-center gap-3">
          <div
            className="w-11 h-11 rounded-[14px] grid place-items-center shrink-0 font-extrabold text-sm text-[#14100d]"
            style={{ background: 'linear-gradient(135deg, #d4a05a, #9c6e38)', boxShadow: '0 0 0 1px rgba(212,160,90,0.14), 0 4px 20px rgba(212,160,90,0.08)' }}
            aria-hidden="true"
          >
            RS
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-semibold tracking-[0.14em] uppercase text-brand">Runtime Shell</div>
            <div className="text-sm font-bold truncate">会话</div>
          </div>
          {user ? (
            <div className="min-w-0 text-right">
              <div className="text-sm font-semibold truncate">{user.displayName}</div>
              <div className="text-[11px] text-[var(--text-muted)]">{roleLabel(user.role)}</div>
            </div>
          ) : null}
          {user ? (
            <button
              type="button"
              onClick={() => setConfirmLogout(true)}
              aria-label="退出登录"
              className="shrink-0 text-xs px-3 py-1.5 rounded-[8px] bg-brand/10 text-brand-text border border-[var(--line)] hover:bg-brand/20 transition-colors focus-visible:ring-2 focus-visible:ring-brand"
            >
              退出
            </button>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void createQuickSession()}
            disabled={Boolean(pendingSessionAction)}
            className="flex-1 rounded-[14px] px-4 py-3 text-sm font-semibold bg-brand text-[#14100d] hover:brightness-110 active:scale-[0.985] transition-all shadow-glow disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {pendingSessionAction === 'create' ? '创建中...' : '新对话'}
          </button>

          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => setActionsOpen((current) => !current)}
              className="h-[46px] px-3 rounded-[14px] border border-[var(--line)] bg-black/20 text-[var(--text-dim)] hover:bg-black/35 transition-colors"
              aria-label="打开会话操作"
            >
              ...
            </button>

            {actionsOpen ? (
              <div className="absolute right-0 top-[52px] z-20 w-48 rounded-[16px] border border-[var(--line)] bg-[var(--surface)] shadow-2xl p-2 grid gap-1">
                <button
                  type="button"
                  onClick={() => {
                    setActionsOpen(false)
                    void loadHistory()
                  }}
                  disabled={Boolean(pendingSessionAction) || !hasCurrentSession || !canLoadSession}
                  className={`${secondaryButtonClassName} w-full justify-start text-left`}
                >
                  {pendingSessionAction === 'load' ? '加载中...' : '加载历史'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setActionsOpen(false)
                    void resumeSession()
                  }}
                  disabled={Boolean(pendingSessionAction) || !hasCurrentSession || !canResumeSession}
                  className={`${secondaryButtonClassName} w-full justify-start text-left`}
                >
                  {pendingSessionAction === 'resume' ? '恢复中...' : '恢复会话'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setActionsOpen(false)
                    setConfirmClose(true)
                  }}
                  disabled={Boolean(pendingSessionAction) || !canManageSession}
                  className="w-full text-left text-xs px-3 py-1.5 rounded-[8px] bg-danger/10 text-[#e88a7a] border border-danger/20 hover:bg-danger/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {pendingSessionAction === 'close' ? '关闭中...' : '关闭当前会话'}
                </button>
              </div>
            ) : null}
          </div>
        </div>

        {isSharedSession ? (
          <div className="text-[11px] text-[var(--text-muted)] leading-relaxed">
            {`当前会话来自共享工作区协作${owner?.displayName ? `，共享人：${owner.displayName}` : ''}。你可以继续对话和处理交互，但不能关闭该会话。`}
          </div>
        ) : !hasCurrentSession ? (
          <div className="text-[11px] text-[var(--text-muted)] leading-relaxed">
            先从会话列表中选择一个会话，再执行加载历史或恢复操作。
          </div>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 rounded-[20px] border border-[var(--line)] bg-[var(--surface)] shadow-md backdrop-blur-2xl p-4 flex flex-col">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <span className="text-[10px] font-semibold tracking-[0.14em] uppercase text-brand">Sessions</span>
            <h3 className="text-sm font-bold mt-0.5">最近活动</h3>
          </div>
          <button
            type="button"
            onClick={() => void loadSessions()}
            aria-label="刷新会话列表"
            className="text-xs px-3 py-1.5 rounded-[8px] bg-brand/10 text-brand-text border border-[var(--line)] hover:bg-brand/20 transition-colors focus-visible:ring-2 focus-visible:ring-brand"
          >
            刷新
          </button>
        </div>

        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索会话..."
          className="w-full rounded-[12px] border border-[var(--line-strong)] px-3 py-2 bg-black/35 text-sm outline-none focus:border-[rgba(212,160,90,0.28)] placeholder:text-[var(--text-muted)]"
        />

        <div className="grid gap-2 flex-1 min-h-0 overflow-y-auto mt-3">
          {filteredSessions.length === 0 ? (
            <div className="text-xs text-[var(--text-muted)] text-center py-4 border border-dashed border-[var(--line-strong)] rounded-[14px]">
              {sessions.length === 0 ? '暂无会话，请先创建。' : '没有匹配的会话。'}
            </div>
          ) : null}

          {filteredSessions.map((session) => {
            const isActive = currentSessionId === session.id
            const statusLabel =
              session.status === 'active' || session.status === 'waiting_input'
                ? '进行中'
                : session.status === 'cancelling'
                  ? '停止中'
                  : session.status === 'opening' || session.status === 'created'
                    ? '准备中'
                    : session.status === 'completed'
                      ? '已完成'
                      : '异常'
            const dotColor =
              session.status === 'active' || session.status === 'waiting_input' || session.status === 'cancelling'
                ? '#5a9e7c'
                : session.status === 'opening' || session.status === 'created'
                  ? '#d4a05a'
                  : session.status === 'completed'
                    ? '#7a6e60'
                    : '#c44a3a'
            const title = session.title || '新对话'
            const preview = readSessionPreview(session) || (session.visibility === 'workspace_share' ? '共享工作区会话' : '点击继续对话')

            return (
              <button
                key={session.id}
                type="button"
                onClick={() => {
                  setActionsOpen(false)
                  setCurrentSession(session.id)
                }}
                aria-label={`选择会话: ${title}`}
                aria-current={isActive ? 'true' : undefined}
                className={`w-full text-left p-3 rounded-[14px] border text-sm transition-all ${
                  isActive ? 'border-brand bg-brand/10 shadow-glow' : 'border-[var(--line)] bg-black/30 hover:bg-black/50 hover:border-[var(--line-strong)]'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="inline-block w-1.5 h-1.5 rounded-full shrink-0" style={{ background: dotColor }} aria-hidden="true"></span>
                  <div className="font-semibold text-sm truncate flex-1">{title}</div>
                  <span className="text-[10px] text-[var(--text-muted)] shrink-0">{statusLabel}</span>
                </div>
                <div className="mt-1.5 text-xs text-[var(--text-muted)] truncate">{preview}</div>
              </button>
            )
          })}
        </div>
      </div>

      <ConfirmDialog
        open={confirmLogout}
        title="退出登录"
        message="确定要退出当前账号吗？"
        confirmLabel="退出"
        onConfirm={() => {
          setConfirmLogout(false)
          logout()
        }}
        onCancel={() => setConfirmLogout(false)}
        danger
      />
      <ConfirmDialog
        open={confirmClose}
        title="关闭会话"
        message="确定要关闭当前会话吗？此操作不可撤销。"
        confirmLabel="关闭"
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

function readSessionPreview(session) {
  if (typeof session?.lastMessagePreview === 'string' && session.lastMessagePreview) return session.lastMessagePreview
  if (typeof session?.capabilityState?.sessionInfo?.lastMessagePreview === 'string') return session.capabilityState.sessionInfo.lastMessagePreview
  return ''
}
