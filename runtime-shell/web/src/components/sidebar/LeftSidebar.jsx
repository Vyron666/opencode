import { useState } from 'react'
import { useStore } from '../../store'
import ConfirmDialog from '../ConfirmDialog.jsx'

export default function LeftSidebar() {
  const store = useStore()
  const [confirmLogout, setConfirmLogout] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)

  return (
    <aside className="min-h-0 h-[calc(100dvh-28px)] grid gap-2.5 content-start overflow-y-auto overflow-x-hidden">
      {/* Brand */}
      <div className="rounded-[20px] border border-[var(--line)] bg-[var(--surface)] shadow-md backdrop-blur-2xl p-4">
        <div className="flex gap-3 items-start">
          <div className="w-12 h-12 rounded-[14px] grid place-items-center shrink-0 font-extrabold text-sm text-[#14100d]"
            style={{ background: 'linear-gradient(135deg, #d4a05a, #9c6e38)', boxShadow: '0 0 0 1px rgba(212,160,90,0.14), 0 4px 20px rgba(212,160,90,0.08)' }}
            aria-hidden="true">
            RS
          </div>
          <div>
            <span className="text-[10px] font-semibold tracking-[0.14em] uppercase text-brand">Runtime Workspace</span>
            <h2 className="mt-0.5 text-sm font-bold">会话导航</h2>
            <p className="text-xs text-[var(--text-muted)] leading-relaxed">选择会话、创建新会话，或继续历史上下文。</p>
          </div>
        </div>
      </div>

      {/* Account */}
      {store.user && (
        <div className="rounded-[20px] border border-[var(--line)] bg-[var(--surface)] shadow-md backdrop-blur-2xl p-4">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div>
              <span className="text-[10px] font-semibold tracking-[0.14em] uppercase text-brand">Account</span>
              <h3 className="text-sm font-bold mt-0.5">当前登录</h3>
            </div>
            <button
              onClick={() => setConfirmLogout(true)}
              aria-label="退出登录"
              className="text-xs px-3 py-1.5 rounded-[8px] bg-brand/10 text-brand-text border border-[var(--line)] hover:bg-brand/20 transition-colors focus-visible:ring-2 focus-visible:ring-brand"
            >
              退出
            </button>
          </div>
          <div className="grid gap-1">
            <div className="font-bold text-sm">{store.user.displayName}</div>
            <div className="text-xs text-[var(--text-muted)]">{store.user.username} · {store.user.role}</div>
          </div>
        </div>
      )}

      {/* Session Actions */}
      <div className="rounded-[20px] border border-[var(--line)] bg-[var(--surface)] shadow-md backdrop-blur-2xl p-4">
        <div className="mb-3">
          <span className="text-[10px] font-semibold tracking-[0.14em] uppercase text-brand">Actions</span>
          <h3 className="text-sm font-bold mt-0.5">会话操作</h3>
        </div>
        <div className="grid gap-2">
          <button
            onClick={() => store.openSession()}
            aria-label="打开当前选中会话"
            className="rounded-[10px] py-2.5 px-4 font-semibold text-sm bg-brand text-[#14100d] hover:brightness-110 active:scale-[0.985] transition-all shadow-glow focus-visible:ring-2 focus-visible:ring-brand"
          >
            打开当前会话
          </button>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => store.loadHistory()} aria-label="加载会话历史" className="text-xs px-3 py-1.5 rounded-[8px] bg-brand/10 text-brand-text border border-[var(--line)] hover:bg-brand/20 transition-colors focus-visible:ring-2 focus-visible:ring-brand">
              加载历史
            </button>
            <button onClick={() => store.resumeSession()} aria-label="恢复会话" className="text-xs px-3 py-1.5 rounded-[8px] bg-brand/10 text-brand-text border border-[var(--line)] hover:bg-brand/20 transition-colors focus-visible:ring-2 focus-visible:ring-brand">
              恢复会话
            </button>
          </div>
          <button
            onClick={() => setConfirmClose(true)}
            aria-label="关闭当前会话"
            className="text-xs px-3 py-1.5 rounded-[8px] bg-danger/10 text-[#e88a7a] border border-danger/20 hover:bg-danger/20 transition-colors focus-visible:ring-2 focus-visible:ring-danger"
          >
            关闭当前会话
          </button>
        </div>
      </div>

      {/* Session List */}
      <div className="rounded-[20px] border border-[var(--line)] bg-[var(--surface)] shadow-md backdrop-blur-2xl p-4">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <span className="text-[10px] font-semibold tracking-[0.14em] uppercase text-brand">Sessions</span>
            <h3 className="text-sm font-bold mt-0.5">最近活跃</h3>
          </div>
          <button onClick={() => store.loadSessions()} aria-label="刷新会话列表" className="text-xs px-3 py-1.5 rounded-[8px] bg-brand/10 text-brand-text border border-[var(--line)] hover:bg-brand/20 transition-colors focus-visible:ring-2 focus-visible:ring-brand">
            刷新
          </button>
        </div>
        <div className="grid gap-2 max-h-[300px] overflow-y-auto">
          {store.sessions.length === 0 && (
            <div className="text-xs text-[var(--text-muted)] text-center py-4 border border-dashed border-[var(--line-strong)] rounded-[14px]">
              暂无会话，请先创建。
            </div>
          )}
          {store.sessions.map((s) => {
            const isActive = store.currentSessionId === s.id
            const dotColor = s.status === 'active' || s.status === 'running' ? '#5a9e7c'
              : s.status === 'pending' || s.status === 'created' ? '#d4a05a'
              : s.status === 'completed' || s.status === 'closed' ? '#7a6e60'
              : '#c44a3a'
            return (
              <button
                key={s.id}
                onClick={() => store.setCurrentSession(s.id)}
                aria-label={`选择会话: ${s.title}`}
                aria-current={isActive ? 'true' : undefined}
                className={`w-full text-left p-3 rounded-[14px] border text-sm transition-all ${
                  isActive
                    ? 'border-brand bg-brand/10 shadow-glow'
                    : 'border-[var(--line)] bg-black/30 hover:bg-black/50 hover:border-[var(--line-strong)]'
                }`}
              >
                <div className="font-semibold text-sm">{s.title}</div>
                <div className="mt-1.5 text-xs text-[var(--text-muted)] flex items-center gap-1.5">
                  <span className="inline-block w-1.5 h-1.5 rounded-full shrink-0" style={{ background: dotColor }} aria-hidden="true"></span>
                  <span>{s.status}</span>
                  <span aria-hidden="true">·</span>
                  <span>{s.binding?.transport || 'unbound'}</span>
                  <span aria-hidden="true">·</span>
                  <span>{s.eventCount || 0} 事件</span>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Confirm Dialogs */}
      <ConfirmDialog
        open={confirmLogout}
        title="退出登录"
        message="确定要退出当前账号吗？"
        confirmLabel="退出"
        onConfirm={() => { setConfirmLogout(false); store.logout() }}
        onCancel={() => setConfirmLogout(false)}
        danger
      />
      <ConfirmDialog
        open={confirmClose}
        title="关闭会话"
        message="确定要关闭当前会话吗？此操作不可撤销。"
        confirmLabel="关闭"
        onConfirm={() => { setConfirmClose(false); store.closeSession() }}
        onCancel={() => setConfirmClose(false)}
        danger
      />
    </aside>
  )
}
