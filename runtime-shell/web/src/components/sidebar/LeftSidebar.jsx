import { useMemo, useState } from 'react'
import { useStore } from '../../store'
import ConfirmDialog from '../ConfirmDialog.jsx'
import { roleLabel, secondaryButtonClassName, useViewerContext } from './sidebar-support.jsx'

export default function LeftSidebar({ onOpenSettings }) {
  const user = useStore((state) => state.user)
  const sessions = useStore((state) => state.sessions)
  const workspaces = useStore((state) => state.workspaces)
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
    <aside className="min-h-0 h-full min-w-0 flex flex-col gap-4 overflow-visible max-[1024px]:order-1 max-[1024px]:h-auto">
      <div className="relative z-20 grid gap-4 rounded-[28px] border border-[var(--line)] bg-[linear-gradient(180deg,#f8fbff,#f1f6ff)] p-5 shadow-[0_16px_38px_rgba(15,23,42,0.07)]">
        <div className="grid gap-3">
          <div className="flex items-start gap-3">
            <div
              className="grid h-12 w-12 place-items-center rounded-[14px] text-sm font-extrabold text-white"
              style={{ background: 'linear-gradient(135deg, #2563eb, #1d4ed8)', boxShadow: '0 12px 24px rgba(37,99,235,0.18)' }}
              aria-hidden="true"
            >
              RS
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-semibold tracking-[0.14em] uppercase text-brand">Runtime Shell</div>
              <div className="mt-1 text-[18px] font-bold leading-tight text-[var(--text)]">会话中心</div>
              <div className="mt-1 text-[12px] text-[var(--text-muted)]">统一管理会话、工作区与运行入口</div>
            </div>
          </div>

          {user ? (
            <div className="flex items-start justify-between gap-3 rounded-[20px] border border-[var(--line)] bg-white/80 px-4 py-3.5">
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-semibold tracking-[0.12em] uppercase text-brand/80">当前账号</div>
                <div className="mt-1 text-sm font-semibold leading-tight text-[var(--text)] break-words">{user.displayName}</div>
                <div className="mt-1 text-[11px] text-[var(--text-muted)]">{roleLabel(user.role)}</div>
              </div>
              <button
                type="button"
                onClick={() => setConfirmLogout(true)}
                aria-label="退出登录"
                className="mt-0.5 shrink-0 rounded-[10px] border border-[var(--line)] bg-[var(--surface-muted)] px-3 py-1.5 text-xs font-semibold text-[var(--text-dim)] transition-colors hover:bg-[var(--bg-strong)]"
              >
                退出
              </button>
            </div>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void createQuickSession()}
            disabled={Boolean(pendingSessionAction)}
            className="flex-1 min-w-0 rounded-[14px] bg-brand px-4 py-3 text-sm font-semibold text-white transition-all hover:bg-[var(--brand-strong)] active:scale-[0.985] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pendingSessionAction === 'create' ? '创建中...' : '新建会话'}
          </button>

          <button
            type="button"
            onClick={onOpenSettings}
            className="shrink-0 rounded-[14px] border border-[var(--line)] bg-white px-3.5 py-3 text-xs font-semibold text-[var(--text-dim)] transition-colors hover:bg-[var(--surface-muted)]"
          >
            设置
          </button>

          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => setActionsOpen((current) => !current)}
              className="h-[46px] w-[46px] rounded-[14px] border border-[var(--line)] bg-white text-[var(--text-dim)] transition-colors hover:bg-[var(--surface-muted)]"
              aria-label="打开会话操作"
            >
              ...
            </button>

            {actionsOpen ? (
              <div className="absolute right-0 top-[52px] z-40 grid w-48 gap-1 rounded-[18px] border border-[var(--line)] bg-white p-2 shadow-[0_20px_48px_rgba(15,23,42,0.16)]">
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
                  className="w-full rounded-[10px] border border-danger/20 bg-danger/10 px-3 py-2 text-left text-xs font-semibold text-danger transition-colors hover:bg-danger/15 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {pendingSessionAction === 'close' ? '关闭中...' : '关闭当前会话'}
                </button>
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 rounded-[18px] border border-[var(--line)] bg-white/75 px-4 py-3">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold text-[var(--text-dim)]">工作区</div>
            <div className="mt-1 text-[11px] text-[var(--text-muted)]">
              {workspaces.length > 0 ? `已配置 ${workspaces.length} 个工作区，可以继续创建或切换会话。` : '还没有工作区，先创建一个再开始对话。'}
            </div>
          </div>
          <button type="button" onClick={onOpenSettings} className={secondaryButtonClassName}>
            新建
          </button>
        </div>

        {isSharedSession ? (
          <div className="text-[11px] leading-relaxed text-[var(--text-muted)]">
            {`当前会话来自共享工作区${owner?.displayName ? `，共享人：${owner.displayName}` : ''}。你可以继续对话和处理交互，但不能关闭该会话。`}
          </div>
        ) : !hasCurrentSession ? (
          <div className="text-[11px] leading-relaxed text-[var(--text-muted)]">
            先从会话列表里选择一个会话，再执行加载历史或恢复操作。
          </div>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 rounded-[28px] border border-[var(--line)] bg-white p-5 shadow-[0_16px_38px_rgba(15,23,42,0.07)]">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <span className="text-[10px] font-semibold tracking-[0.14em] uppercase text-brand">Sessions</span>
            <h3 className="mt-1 text-[18px] font-bold text-[var(--text)]">最近活动</h3>
          </div>
          <button
            type="button"
            onClick={() => void loadSessions()}
            aria-label="刷新会话列表"
            className="rounded-[10px] border border-[var(--line)] bg-white px-3 py-1.5 text-xs font-semibold text-brand transition-colors hover:bg-[var(--surface-muted)]"
          >
            刷新
          </button>
        </div>

        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索会话..."
          className="w-full rounded-[14px] border border-[var(--line)] bg-[var(--surface-muted)] px-3.5 py-3 text-sm text-[var(--text)] outline-none transition-colors focus:border-[var(--brand)] focus:shadow-[0_0_0_3px_rgba(37,99,235,0.10)] placeholder:text-[var(--text-muted)]"
        />

        <div className="mt-4 grid min-h-0 flex-1 gap-2 overflow-y-auto overflow-x-hidden pr-1">
          {filteredSessions.length === 0 ? (
            <div className="rounded-[18px] border border-dashed border-[var(--line-strong)] bg-[var(--surface-muted)] py-5 text-center text-xs text-[var(--text-muted)]">
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
                ? '#059669'
                : session.status === 'opening' || session.status === 'created'
                  ? '#2563eb'
                  : session.status === 'completed'
                    ? '#94a3b8'
                    : '#dc2626'
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
                className={`w-full rounded-[18px] border px-3.5 py-3 text-left text-sm transition-all ${
                  isActive
                    ? 'border-brand bg-brand/10 shadow-[0_12px_32px_rgba(37,99,235,0.12)]'
                    : 'border-[var(--line)] bg-[var(--surface-muted)] hover:border-[var(--line-strong)] hover:bg-white'
                }`}
              >
                <div className="flex items-start gap-2">
                  <span
                    className="mt-1 inline-block h-2 w-2 shrink-0 rounded-full"
                    style={{ background: dotColor, boxShadow: `0 0 0 4px ${isActive ? 'rgba(37,99,235,0.08)' : 'rgba(148,163,184,0.08)'}` }}
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="break-words text-[13px] font-semibold leading-tight text-[var(--text)]">{title}</div>
                    <div className="mt-1.5 line-clamp-2 text-[11px] leading-relaxed text-[var(--text-muted)]">{preview}</div>
                  </div>
                  <span className="shrink-0 rounded-full border border-[var(--line)] bg-white px-2 py-1 text-[10px] text-[var(--text-muted)]">
                    {statusLabel}
                  </span>
                </div>
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
