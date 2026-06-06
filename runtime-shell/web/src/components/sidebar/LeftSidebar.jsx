import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useStore } from '../../store'
import ConfirmDialog from '../ConfirmDialog.jsx'
import { roleLabel, Select, useSessionCapabilities, useViewerContext } from './sidebar-support.jsx'

export default function LeftSidebar({ onOpenSettings }) {
  const user = useStore((state) => state.user)
  const sessions = useStore((state) => state.sessions)
  const workspaces = useStore((state) => state.workspaces)
  const currentSessionId = useStore((state) => state.currentSessionId)
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
  const [createOpen, setCreateOpen] = useState(false)
  const [query, setQuery] = useState('')
  const currentWorkspace = workspaces[0] || null
  const hasCurrentSession = Boolean(currentSessionId)

  const filteredSessions = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return sessions
    return sessions.filter((session) => {
      const title = String(session.title || '').toLowerCase()
      const preview = String(readSessionPreview(session) || '').toLowerCase()
      return title.includes(keyword) || preview.includes(keyword)
    })
  }, [query, sessions])

  return (
    <>
      <aside className="min-h-0 flex h-full min-w-0 flex-col border-r border-[#dbe5f8] bg-[#f7faff]">
        <div className="shrink-0 border-b border-[#e6eefc] px-5 pb-4 pt-5">
          <div className="flex items-center gap-3">
            <div className="grid h-12 w-12 place-items-center rounded-[14px] bg-[#3566df] text-[15px] font-extrabold text-white shadow-[0_12px_24px_rgba(53,102,223,0.22)]">
              RS
            </div>

            <div className="min-w-0 flex-1">
              <div className="truncate text-[15px] font-bold text-[#18233b]">Runtime Shell</div>
              <div className="mt-1 text-[12px] text-[#70809c]">会话工作台</div>
            </div>

            <button
              type="button"
              onClick={() => onOpenSettings('overview')}
              className="grid h-8 w-8 place-items-center rounded-[11px] border border-[#d8e3f7] bg-white text-[13px] text-[#6d7d98] transition-colors hover:bg-[#f3f7ff]"
              aria-label="打开设置"
            >
              ⚙
            </button>
          </div>

          <button
            type="button"
            onClick={() => onOpenSettings('workspace')}
            className="mt-5 flex w-full items-center justify-between rounded-[12px] border border-[#d7e3fb] bg-white px-3.5 py-3 text-left transition-colors hover:bg-[#f5f8ff]"
          >
            <span className="inline-flex items-center gap-2 text-[14px] text-[#18233b]">
              <span className="grid h-5 w-5 place-items-center rounded-[6px] bg-[#3566df] text-[10px] font-bold text-white">■</span>
              {currentWorkspace?.name || 'opencode'}
            </span>
            <span className="text-[12px] text-[#8390a7]">▼</span>
          </button>

          <button
            type="button"
            onClick={() => onOpenSettings('workspace')}
            className="mt-3 w-full rounded-[12px] border border-[#d7e3fb] bg-white px-3.5 py-3 text-left text-[13px] font-medium text-[#3566df] transition-colors hover:bg-[#f5f8ff]"
          >
            + 创建工作区
          </button>

          {user ? (
            <div className="mt-4 rounded-[16px] bg-[#dfe8fa] px-4 py-3.5">
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-full bg-[linear-gradient(135deg,#5f6df4,#7d89ff)] text-sm font-bold text-white">
                  {String(user.displayName || 'R').slice(0, 1)}
                </div>
                <div className="min-w-0">
                  <div className="truncate text-[14px] font-semibold text-[#18233b]">{user.displayName}</div>
                  <div className="mt-1 text-[11px] text-[#6d7d98]">{roleLabel(user.role)}</div>
                </div>
              </div>
            </div>
          ) : null}

          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            disabled={Boolean(pendingSessionAction)}
            className="mt-4 w-full rounded-[13px] bg-[#3566df] px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#2f5fd7] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pendingSessionAction === 'create' ? '创建中...' : '+ 新会话'}
          </button>

          <div className="mt-3 rounded-[12px] border border-[#d7e3fb] bg-white px-3.5 py-2.5 text-[13px] text-[#61718d]">
            工作区 ({currentWorkspace?.name || 'opencode'})
          </div>

          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索会话..."
            className="mt-4 h-10 w-full rounded-[12px] border border-[#d7e3fb] bg-white px-3.5 text-sm text-[#18233b] outline-none transition-colors placeholder:text-[#97a4ba] focus:border-[#3566df] focus:shadow-[0_0_0_3px_rgba(53,102,223,0.10)]"
          />
        </div>

        <div className="min-h-0 flex flex-1 flex-col px-4 pb-4 pt-4">
          <div className="mb-3 flex items-center justify-between gap-3 px-1">
            <div className="text-[12px] font-medium text-[#6d7d98]">会话 ({filteredSessions.length})</div>
            <button
              type="button"
              onClick={() => void loadSessions()}
              className="rounded-[9px] bg-white px-3 py-1.5 text-[12px] font-semibold text-[#3566df] shadow-[inset_0_0_0_1px_#dbe6fb] transition-colors hover:bg-[#f5f8ff]"
            >
              刷新
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pr-1">
            <div className="grid gap-2">
              {filteredSessions.length === 0 ? (
                <div className="rounded-[15px] border border-dashed border-[#cfdbf5] bg-white px-4 py-6 text-center text-xs text-[#7c8aa5]">
                  {sessions.length === 0 ? '暂无会话，请先创建。' : '没有匹配的会话。'}
                </div>
              ) : null}

              {filteredSessions.map((session) => {
                const isActive = currentSessionId === session.id
                const title = session.title || '新对话'
                const preview = readSessionPreview(session) || (session.visibility === 'workspace_share' ? '共享工作区会话' : '点击继续对话')
                const dotColor =
                  session.status === 'active' || session.status === 'waiting_input'
                    ? '#0f9f6e'
                    : session.status === 'opening' || session.status === 'created'
                      ? '#3566df'
                      : '#cad5e5'

                return (
                  <button
                    key={session.id}
                    type="button"
                    onClick={() => setCurrentSession(session.id)}
                    aria-current={isActive ? 'true' : undefined}
                    className={`w-full rounded-[15px] border px-3.5 py-3 text-left transition-all ${
                      isActive
                        ? 'border-[#d5e1fb] bg-white shadow-[0_10px_24px_rgba(53,102,223,0.08)]'
                        : 'border-transparent bg-transparent hover:border-[#dbe6fb] hover:bg-white'
                    }`}
                  >
                    <div className="flex items-start gap-2.5">
                      <span className="mt-[6px] inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: dotColor }} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[14px] font-semibold text-[#24324a]">{title}</div>
                        <div className="mt-2 line-clamp-2 text-[12px] leading-5 text-[#7c8aa5]">{preview}</div>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        <div className="shrink-0 border-t border-[#e7eefb] px-4 py-3">
          {isSharedSession ? (
            <div className="mb-3 px-1 text-[11px] leading-5 text-[#8a97ad]">
              {`当前会话来自共享工作区${owner?.displayName ? `，共享人：${owner.displayName}` : ''}。`}
            </div>
          ) : !hasCurrentSession ? (
            <div className="mb-3 px-1 text-[11px] leading-5 text-[#8a97ad]">
              先从会话列表里选择一个会话，再继续加载历史或恢复操作。
            </div>
          ) : null}

          {hasCurrentSession ? (
            <div className="grid gap-1 rounded-[12px] border border-[#e3ebfa] bg-white/90 p-1.5">
              <button
                type="button"
                onClick={() => void loadHistory()}
                disabled={Boolean(pendingSessionAction) || !canLoadSession}
                className="w-full rounded-[9px] px-3 py-2 text-left text-[12px] font-medium text-[#4e6387] transition-colors hover:bg-[#f5f8ff] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {pendingSessionAction === 'load' ? '加载中...' : '加载历史'}
              </button>
              <button
                type="button"
                onClick={() => void resumeSession()}
                disabled={Boolean(pendingSessionAction) || !canResumeSession}
                className="w-full rounded-[9px] px-3 py-2 text-left text-[12px] font-medium text-[#4e6387] transition-colors hover:bg-[#f5f8ff] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {pendingSessionAction === 'resume' ? '恢复中...' : '恢复会话'}
              </button>
              <button
                type="button"
                onClick={() => setConfirmClose(true)}
                disabled={Boolean(pendingSessionAction) || !canManageSession}
                className="w-full rounded-[9px] px-3 py-2 text-left text-[12px] font-medium text-[#c45858] transition-colors hover:bg-[#fff4f4] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {pendingSessionAction === 'close' ? '关闭中...' : '关闭当前会话'}
              </button>
            </div>
          ) : null}

          <button
            type="button"
            onClick={() => setConfirmLogout(true)}
            className="mt-3 w-full rounded-[12px] border border-[#e3ebfa] bg-white/80 px-3 py-2.5 text-sm font-medium text-[#60718d] transition-colors hover:bg-[#f5f8ff]"
          >
            退出
          </button>
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

      <NewSessionDialog open={createOpen} onClose={() => setCreateOpen(false)} onOpenSettings={onOpenSettings} />
    </>
  )
}

function NewSessionDialog({ open, onClose, onOpenSettings }) {
  const workspaces = useStore((state) => state.workspaces)
  const createSession = useStore((state) => state.createSession)
  const updateModel = useStore((state) => state.updateModel)
  const pendingSessionAction = useStore((state) => state.pendingSessionAction)
  const capabilities = useSessionCapabilities()
  const [workspaceId, setWorkspaceId] = useState('')
  const [selectedModelId, setSelectedModelId] = useState('')

  useEffect(() => {
    if (!open) return
    if (!workspaceId && workspaces[0]?.id) setWorkspaceId(workspaces[0].id)
    if (!selectedModelId && capabilities.models?.[0]?.id) setSelectedModelId(capabilities.models[0].id)
  }, [capabilities.models, open, selectedModelId, workspaceId, workspaces])

  const workspaceOptions = useMemo(
    () =>
      workspaces.map((workspace) => ({
        id: workspace.id,
        label: workspace.name,
      })),
    [workspaces],
  )
  const selectedWorkspace = workspaces.find((workspace) => workspace.id === workspaceId) || workspaces[0] || null
  const canSubmit = Boolean(selectedWorkspace) && !pendingSessionAction

  const handleCreate = async () => {
    if (!selectedWorkspace) return
    await createSession('新建会话', selectedWorkspace.projectId, selectedWorkspace.id)
    if (selectedModelId) {
      await updateModel(selectedModelId).catch(() => undefined)
    }
    onClose()
  }

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(15,23,42,0.18)] backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: 18, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 18, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="w-[520px] max-w-[92vw] rounded-[24px] border border-[#dbe6fb] bg-white p-8 shadow-[0_20px_52px_rgba(15,23,42,0.12)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="grid gap-6">
              <div className="grid gap-2">
                <h2 className="text-[18px] font-bold text-[#18233b]">新建会话</h2>
              </div>

              <label className="grid gap-2">
                <span className="text-[13px] font-semibold text-[#6b7a95]">工作区</span>
                <Select value={selectedWorkspace?.id || ''} onChange={setWorkspaceId} options={workspaceOptions} emptyLabel="暂无可用工作区" />
              </label>

              <div className="grid gap-3">
                <div className="text-[13px] font-semibold text-[#6b7a95]">选择模型</div>
                {capabilities.models?.length ? (
                  <div className="grid gap-3">
                    {capabilities.models.slice(0, 3).map((model, index) => {
                      const meta = readModelMeta(model, index)
                      const isSelected = selectedModelId === model.id
                      return (
                        <button
                          key={model.id}
                          type="button"
                          onClick={() => setSelectedModelId(model.id)}
                          className={`flex items-center justify-between rounded-[14px] border px-4 py-4 text-left transition-colors ${
                            isSelected
                              ? 'border-[#5e8fff] bg-[#f5f8ff] shadow-[inset_0_0_0_1px_rgba(94,143,255,0.35)]'
                              : 'border-[#dbe6fb] bg-white hover:bg-[#f8fbff]'
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <span className={`inline-block h-6 w-6 rounded-[8px] ${isSelected ? 'bg-[#3566df]' : 'bg-[#c7d2e5]'}`} aria-hidden="true" />
                            <span className="text-[15px] font-semibold text-[#24324a]">{meta.label}</span>
                          </div>
                          <span className="text-[13px] text-[#7c8aa5]">{meta.description}</span>
                        </button>
                      )
                    })}
                  </div>
                ) : (
                  <div className="rounded-[14px] border border-dashed border-[#dbe6fb] bg-[#f8fbff] px-4 py-4 text-sm text-[#7c8aa5]">
                    还没有可用模型。
                    <button
                      type="button"
                      onClick={() => {
                        onClose()
                        onOpenSettings('provider')
                      }}
                      className="ml-2 font-semibold text-[#3566df]"
                    >
                      去配置 Provider
                    </button>
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-[12px] bg-[#eef3ff] px-4 py-2.5 text-sm font-semibold text-[#61718d] transition-colors hover:bg-[#e7eefc]"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={() => void handleCreate()}
                  disabled={!canSubmit}
                  className="rounded-[12px] bg-[#3566df] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#2f5fd7] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {pendingSessionAction === 'create' ? '创建中...' : '开始对话'}
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

function readModelMeta(model, index) {
  const label = String(model.label || model.id || '').split(' · ').at(-1) || String(model.label || model.id || '').split(' 路 ').at(-1) || model.id
  const normalized = String(label).toLowerCase()
  if (normalized.includes('flash')) {
    return { label, description: '快速响应 · 适合轻量问答' }
  }
  if (normalized.includes('kimi')) {
    return { label, description: '长上下文支持' }
  }
  if (normalized.includes('v4') || index === 0) {
    return { label, description: '高速推理 · 支持思考模式' }
  }
  return { label, description: '可用于新会话' }
}

function readSessionPreview(session) {
  if (typeof session?.lastMessagePreview === 'string' && session.lastMessagePreview) return session.lastMessagePreview
  if (typeof session?.capabilityState?.sessionInfo?.lastMessagePreview === 'string') return session.capabilityState.sessionInfo.lastMessagePreview
  return ''
}
