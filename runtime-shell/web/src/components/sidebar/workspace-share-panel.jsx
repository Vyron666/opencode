import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../../store'
import { Field, roleLabel, secondaryButtonClassName, Select, useViewerContext } from './sidebar-support'

export function WorkspaceSharePanel() {
  const users = useStore((state) => state.users)
  const pendingShareAction = useStore((state) => state.pendingShareAction)
  const shareWorkspace = useStore((state) => state.shareWorkspace)
  const unshareWorkspace = useStore((state) => state.unshareWorkspace)
  const { canShareWorkspace, owner, session, shares, user, isSharedSession, hasOutgoingShares } = useViewerContext()
  const [targetUserId, setTargetUserId] = useState('')

  const availableTargets = useMemo(() => {
    const sharedUserIds = new Set((shares || []).map((item) => item.targetUserId))
    return users.filter((candidate) => candidate.id !== user?.id && !sharedUserIds.has(candidate.id))
  }, [shares, user?.id, users])

  useEffect(() => {
    if (!availableTargets.length) {
      setTargetUserId('')
      return
    }
    if (availableTargets.some((candidate) => candidate.id === targetUserId)) return
    setTargetUserId(availableTargets[0]?.id || '')
  }, [availableTargets, targetUserId])

  if (!session) return null

  return (
    <div className="grid gap-2.5 pb-3 border-b border-[var(--line)]">
      <div className="flex items-center justify-between gap-3">
        <div>
          <span className="text-[10px] font-semibold tracking-[0.14em] uppercase text-brand">Share</span>
          <h3 className="text-sm font-bold mt-0.5">工作区共享</h3>
        </div>
        {isSharedSession ? <span className="text-[11px] text-[var(--text-muted)]">协作中</span> : null}
      </div>

      {isSharedSession ? (
        <div className="text-[11px] text-[var(--text-muted)] leading-relaxed">
          当前会话所在工作区由 {owner?.displayName || owner?.username || '他人'} 共享给你。你可以继续协作，但不能再次共享或取消共享。
        </div>
      ) : null}

      {canShareWorkspace ? (
        <>
          <div className="grid gap-2">
            <span className="text-xs font-medium text-[var(--text-dim)]">已共享成员</span>
            {shares?.length ? (
              shares.map((share) => (
                <div key={share.id} className="flex items-center gap-2 rounded-[12px] border border-[var(--line)] bg-black/20 p-2.5 text-xs text-[var(--text-dim)]">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold text-[var(--text)]">{share.targetDisplayName}</div>
                    <div className="text-[var(--text-muted)]">{roleLabel(share.targetRole)}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void unshareWorkspace(share.targetUserId)}
                    disabled={Boolean(pendingShareAction)}
                    className="px-3 py-1.5 text-xs font-semibold rounded-[8px] bg-danger/10 text-danger border border-danger/20 hover:bg-danger/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {pendingShareAction === 'unshare' ? '取消中...' : '取消共享'}
                  </button>
                </div>
              ))
            ) : (
              <div className="text-xs text-[var(--text-muted)] p-3 text-center border border-dashed border-[var(--line-strong)] rounded-[14px]">
                当前还未共享给其他成员
              </div>
            )}
          </div>

          <Field label="新增共享对象">
            <Select
              value={targetUserId}
              onChange={setTargetUserId}
              options={availableTargets.map((candidate) => ({
                id: candidate.id,
                label: `${candidate.displayName} (${roleLabel(candidate.role)})`,
              }))}
              emptyLabel="暂无可选用户"
            />
          </Field>

          <button
            type="button"
            onClick={() => void shareWorkspace(targetUserId)}
            disabled={!targetUserId || Boolean(pendingShareAction) || availableTargets.length === 0}
            className={secondaryButtonClassName}
          >
            {pendingShareAction === 'share' ? '共享中...' : '共享当前工作区'}
          </button>

          <div className="text-[11px] text-[var(--text-muted)] leading-relaxed">
            共享工作区后，对方可以查看并继续处理该工作区下已有会话，但不能在该工作区里新建会话。
          </div>
        </>
      ) : null}

      {!isSharedSession && hasOutgoingShares ? (
        <div className="text-[11px] text-[var(--text-muted)] leading-relaxed">
          当前工作区已共享给其他成员，他们可以继续协作已有会话，但不能关闭、Fork 或修改运行时设置。
        </div>
      ) : null}
    </div>
  )
}
