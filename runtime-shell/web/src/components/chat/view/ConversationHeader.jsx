import { memo, useEffect, useMemo, useState } from 'react'
import { useStore } from '../../../store'
import { roleLabel, Select, useSessionCapabilities, useViewerContext } from '../../sidebar/sidebar-support'
import { useConversationPhase } from './useConversationPhase'

export const ConversationHeader = memo(function ConversationHeader({ currentSessionId, sessionTitle, onOpenSettings }) {
  const connectSSE = useStore((state) => state.connectSSE)
  const forkSession = useStore((state) => state.forkSession)
  const shareWorkspace = useStore((state) => state.shareWorkspace)
  const unshareWorkspace = useStore((state) => state.unshareWorkspace)
  const isConnected = useStore((state) => state.isConnected)
  const reconnectAttempt = useStore((state) => state.reconnectAttempt)
  const pendingSessionAction = useStore((state) => state.pendingSessionAction)
  const pendingShareAction = useStore((state) => state.pendingShareAction)
  const users = useStore((state) => state.users)
  const phase = useConversationPhase()
  const capabilities = useSessionCapabilities()
  const { canManageSession, canShareWorkspace, hasOutgoingShares, isSharedSession, owner, shares, user } = useViewerContext()
  const [shareOpen, setShareOpen] = useState(false)
  const [targetUserId, setTargetUserId] = useState('')

  const modelLabel =
    capabilities.models?.find((item) => item.id === capabilities.modelId)?.label?.split(' 路 ').at(-1) ||
    capabilities.modelId?.split('/').at(-1) ||
    'Runtime'

  const availableTargets = useMemo(() => {
    const sharedUserIds = new Set((shares || []).map((item) => item.targetUserId))
    return users.filter((candidate) => candidate.id !== user?.id && !sharedUserIds.has(candidate.id))
  }, [shares, user?.id, users])

  const subtitle = !currentSessionId
    ? '从左侧选择会话，或新建一个会话继续当前工作流'
    : phase.isBusy
      ? phase.detail || '当前会话正在继续推进任务'
      : '保持上下文，继续这项工作'

  const statusLabel = !currentSessionId ? '未连接' : isConnected ? '就绪' : reconnectAttempt > 0 ? `重连 ${reconnectAttempt}` : '连接中'
  const statusClassName = !currentSessionId
    ? 'border-[#dbe5f6] bg-[#f6f8fe] text-[#7c8aa5]'
    : isConnected
      ? 'border-[#cbeadf] bg-[#eef9f4] text-[#0f9f6e]'
      : 'border-[#dbe5f6] bg-[#f6f8fe] text-[#61718d]'
  const canForkSession = Boolean(currentSessionId && canManageSession && !isSharedSession)
  const shareButtonLabel = isSharedSession ? 'Shared' : hasOutgoingShares ? 'Shared' : 'Share'

  useEffect(() => {
    if (!availableTargets.length) {
      setTargetUserId('')
      return
    }
    if (availableTargets.some((candidate) => candidate.id === targetUserId)) return
    setTargetUserId(availableTargets[0]?.id || '')
  }, [availableTargets, targetUserId])

  useEffect(() => {
    if (!currentSessionId) setShareOpen(false)
  }, [currentSessionId])

  return (
    <header className="relative shrink-0 border-b border-[#eef2ff] bg-white px-6 py-5 max-[1024px]:px-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[17px] font-bold text-[#18233b]">{sessionTitle || '新建会话'}</h1>
          <div className="mt-1 text-[12px] text-[#70809c]">{subtitle}</div>

          {currentSessionId ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void forkSession(`${sessionTitle || '当前会话'} Fork`)}
                disabled={!canForkSession || Boolean(pendingSessionAction)}
                className="inline-flex items-center gap-2 rounded-full border border-[#dbe5f6] bg-white px-3 py-1.5 text-[12px] font-semibold text-[#3566df] transition-colors hover:bg-[#f5f8ff] disabled:cursor-not-allowed disabled:opacity-45"
              >
                <span>Fork</span>
                <span className="text-[11px] text-[#8a96ab]">{pendingSessionAction === 'fork' ? '创建中...' : '创建分支'}</span>
              </button>

              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShareOpen((current) => !current)}
                  className="inline-flex items-center gap-2 rounded-full border border-[#dbe5f6] bg-white px-3 py-1.5 text-[12px] font-semibold text-[#3566df] transition-colors hover:bg-[#f5f8ff]"
                >
                  <span>{shareButtonLabel}</span>
                  <span className="text-[11px] text-[#8a96ab]">
                    {isSharedSession ? '协作中' : shares?.length ? `${shares.length} 人` : '共享会话'}
                  </span>
                </button>

                {shareOpen ? (
                  <div className="absolute left-0 top-[calc(100%+10px)] z-20 w-[320px] rounded-[20px] border border-[#dbe6fb] bg-white p-4 shadow-[0_20px_50px_rgba(15,23,42,0.14)]">
                    <div className="grid gap-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-[14px] font-semibold text-[#18233b]">Share 会话</div>
                          <div className="mt-1 text-[12px] leading-6 text-[#70809c]">
                            {isSharedSession
                              ? `当前会话来自 ${owner?.displayName || owner?.username || '其他成员'} 的共享工作区。`
                              : '这里展示当前共享成员，并提供快速共享入口。'}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setShareOpen(false)}
                          className="grid h-8 w-8 place-items-center rounded-full bg-[#f4f7ff] text-[#7c8aa5] transition-colors hover:bg-[#ebf1ff]"
                          aria-label="关闭共享面板"
                        >
                          ×
                        </button>
                      </div>

                      {shares?.length ? (
                        <div className="grid gap-2">
                          {(shares || []).map((share) => (
                            <div key={share.id} className="flex items-center gap-2 rounded-[14px] border border-[#e1eafc] bg-[#f8fbff] px-3 py-2.5">
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-[13px] font-semibold text-[#24324a]">{share.targetDisplayName}</div>
                                <div className="text-[11px] text-[#8a96ab]">{roleLabel(share.targetRole)}</div>
                              </div>
                              {canShareWorkspace ? (
                                <button
                                  type="button"
                                  onClick={() => void unshareWorkspace(share.targetUserId)}
                                  disabled={Boolean(pendingShareAction)}
                                  className="rounded-full border border-[#f3d0d0] bg-[#fff6f6] px-2.5 py-1 text-[11px] font-semibold text-[#c45858] transition-colors hover:bg-[#fff0f0] disabled:cursor-not-allowed disabled:opacity-45"
                                >
                                  {pendingShareAction === 'unshare' ? '移除中...' : '移除'}
                                </button>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="rounded-[14px] border border-dashed border-[#d7e3fb] bg-[#f8fbff] px-3 py-3 text-[12px] text-[#8a96ab]">
                          当前还没有共享给其他成员。
                        </div>
                      )}

                      {canShareWorkspace ? (
                        <>
                          <Select
                            value={targetUserId}
                            onChange={setTargetUserId}
                            options={availableTargets.map((candidate) => ({
                              id: candidate.id,
                              label: `${candidate.displayName} (${roleLabel(candidate.role)})`,
                            }))}
                            emptyLabel="暂无可共享成员"
                            disabled={availableTargets.length === 0}
                          />
                          <button
                            type="button"
                            onClick={() => {
                              if (!targetUserId) return
                              void shareWorkspace(targetUserId).then(() => setShareOpen(false))
                            }}
                            disabled={!targetUserId || Boolean(pendingShareAction) || availableTargets.length === 0}
                            className="rounded-[12px] bg-[#3566df] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#2f5fd7] disabled:cursor-not-allowed disabled:opacity-45"
                          >
                            {pendingShareAction === 'share' ? '共享中...' : '共享当前工作区'}
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setShareOpen(false)
                            onOpenSettings?.('workspace')
                          }}
                          className="rounded-[12px] border border-[#dbe6fb] bg-[#f8fbff] px-4 py-2.5 text-sm font-semibold text-[#3566df] transition-colors hover:bg-[#f1f5ff]"
                        >
                          打开共享详情
                        </button>
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <span className="hidden rounded-full border border-[#dbe5f6] bg-[#f6f8fe] px-3 py-1.5 text-[12px] text-[#4a5a73] xl:inline-flex">
            <span className="mr-1.5 inline-block h-2 w-2 self-center rounded-full bg-[#0f9f6e]" />
            {modelLabel}
          </span>

          <span className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${statusClassName}`}>{statusLabel}</span>

          {currentSessionId && !isConnected && reconnectAttempt === 0 ? (
            <button
              type="button"
              onClick={() => connectSSE()}
              className="rounded-full border border-[#dbe5f6] bg-white px-3 py-1.5 text-[12px] font-medium text-[#3566df] transition-colors hover:bg-[#f5f8ff]"
            >
              重新连接
            </button>
          ) : null}
        </div>
      </div>
    </header>
  )
})
