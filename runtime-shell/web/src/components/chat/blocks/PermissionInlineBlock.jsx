import { useStore } from '../../../store'
import { formatData } from './format-data'

export function PermissionInlineBlock({ block }) {
  const respondPermission = useStore((state) => state.respondPermission)
  const pendingPermissions = useStore((state) => state.pendingPermissions)
  const respondingPermissionIds = useStore((state) => state.respondingPermissionIds)
  const requestId = block.data?.requestId || block.data?.id
  const submitting = requestId ? respondingPermissionIds.has(requestId) : false
  const pending = requestId ? pendingPermissions.some((item) => (item.requestId || item.id) === requestId) : false
  const resolved = Boolean(requestId) && !pending && !submitting

  return (
    <div className="flex justify-center px-4">
      <div className="grid min-w-0 w-full max-w-[620px] gap-3 rounded-[20px] border border-brand/15 bg-[linear-gradient(180deg,#ffffff,#f8fbff)] px-4 py-4 shadow-[0_14px_34px_rgba(15,23,42,0.08)]">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-[14px] bg-brand/10 text-sm font-bold text-brand">
            权
          </div>
          <div className="min-w-0 grid gap-1">
            <div className="text-[10px] font-bold uppercase tracking-widest text-brand">权限请求</div>
            <div className="text-sm font-semibold text-[var(--text)]">{block.data?.toolName || '权限审批'}</div>
            <div className="text-[12px] leading-relaxed text-[var(--text-muted)]">
              当前会话正在等待你处理这个权限请求，完成后会自动继续运行。
            </div>
          </div>
        </div>

        {block.data?.rawInput ? (
          <pre className="max-w-full overflow-x-auto whitespace-pre-wrap break-words rounded-[12px] border border-[var(--line)] bg-[var(--surface-muted)] p-3 text-xs text-[var(--text-dim)]">
            {formatData(block.data.rawInput)}
          </pre>
        ) : null}

        {resolved ? (
          <div className="rounded-[12px] border border-[var(--line)] bg-[var(--surface-muted)] px-3 py-2 text-[11px] text-[var(--text-muted)]">
            已处理，等待会话继续。
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {(block.data?.options || []).map((option) => (
              <button
                key={option.optionId || option.id}
                onClick={() => respondPermission(requestId, true, option.optionId || option.id)}
                disabled={submitting}
                className="rounded-[10px] border border-success/20 bg-success/10 px-4 py-2 text-xs text-success transition-colors hover:bg-success/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? '提交中...' : `批准：${option.name || option.kind || option.optionId}`}
              </button>
            ))}

            {!block.data?.options || block.data.options.length === 0 ? (
              <button
                onClick={() => respondPermission(requestId, true)}
                disabled={submitting}
                className="rounded-[10px] border border-success/20 bg-success/10 px-4 py-2 text-xs text-success transition-colors hover:bg-success/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? '提交中...' : '批准'}
              </button>
            ) : null}

            <button
              onClick={() => respondPermission(requestId, false)}
              disabled={submitting}
              className="rounded-[10px] border border-danger/20 bg-danger/10 px-4 py-2 text-xs text-danger transition-colors hover:bg-danger/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? '提交中...' : '拒绝'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
