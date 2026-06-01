import { useStore } from '../../../store'
import { formatData } from './format-data'

export function PermissionInlineBlock({ block }) {
  const respondPermission = useStore((state) => state.respondPermission)
  const pendingPermissions = useStore((state) => state.pendingPermissions)
  const respondingPermissionIds = useStore((state) => state.respondingPermissionIds)
  const requestId = block.data?.requestId || block.data?.id
  const submitting = requestId ? respondingPermissionIds.has(requestId) : false
  const pending = requestId
    ? pendingPermissions.some((item) => (item.requestId || item.id) === requestId)
    : false
  const resolved = Boolean(requestId) && !pending && !submitting

  return (
    <div className="flex justify-center px-4">
      <div className="min-w-0 rounded-[16px] px-4 py-3 border border-brand/20 bg-brand/5 w-full max-w-[540px] grid gap-2 text-center">
        <div className="text-[10px] font-bold text-brand tracking-widest uppercase">权限请求</div>
        <div className="text-xs font-semibold text-[var(--text)]">{block.data?.toolName || '权限审批'}</div>
        <div className="text-[11px] text-[var(--text-muted)]">当前会话正在等待你处理这个权限请求，处理完成后会继续运行。</div>
        {block.data?.rawInput && (
          <pre className="max-w-full text-xs text-[var(--text-dim)] bg-black/30 rounded-[10px] p-2 whitespace-pre-wrap break-words overflow-x-auto">
            {formatData(block.data.rawInput)}
          </pre>
        )}
        {resolved ? (
          <div className="text-[11px] text-[var(--text-muted)]">
            已处理，等待会话继续。
          </div>
        ) : (
          <div className="flex gap-2 justify-center flex-wrap">
          {(block.data?.options || []).map((option) => (
            <button
              key={option.optionId || option.id}
              onClick={() => respondPermission(requestId, true, option.optionId || option.id)}
              disabled={submitting}
              className="text-xs px-4 py-1.5 rounded-[8px] bg-success/10 text-success border border-success/20 hover:bg-success/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? '提交中...' : `批准：${option.name || option.kind || option.optionId}`}
            </button>
          ))}
          {(!block.data?.options || block.data.options.length === 0) && (
            <button
              onClick={() => respondPermission(requestId, true)}
              disabled={submitting}
              className="text-xs px-4 py-1.5 rounded-[8px] bg-success/10 text-success border border-success/20 hover:bg-success/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? '提交中...' : '批准'}
            </button>
          )}
          <button
            onClick={() => respondPermission(requestId, false)}
            disabled={submitting}
            className="text-xs px-4 py-1.5 rounded-[8px] bg-danger/10 text-danger border border-danger/20 hover:bg-danger/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? '提交中...' : '拒绝'}
          </button>
          </div>
        )}
      </div>
    </div>
  )
}
