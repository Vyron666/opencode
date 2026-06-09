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
      <div className="grid w-full gap-3 rounded-[18px] border border-[#f1e1b4] bg-[#fff9e9] px-4 py-4 shadow-[0_10px_24px_rgba(15,23,42,0.04)]">
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-[14px] bg-[#ffe9b8] text-sm font-bold text-[#8c6b18]">
            权
          </div>
          <div className="min-w-0 grid gap-1">
            <div className="text-[11px] font-bold tracking-[0.12em] text-[#8c6b18]">权限请求</div>
            <div className="text-sm font-semibold text-[#24324a]">{block.data?.toolName || '权限审批'}</div>
            <div className="text-[12px] leading-6 text-[#7b6a36]">当前会话正在等待你处理这项权限请求，处理完成后会自动继续。</div>
          </div>
        </div>

        {block.data?.rawInput ? (
          <pre className="max-w-full overflow-x-auto whitespace-pre-wrap break-words rounded-[12px] border border-[#eed9aa] bg-white p-3 text-xs text-[#7b6a36]">
            {formatData(block.data.rawInput)}
          </pre>
        ) : null}

        {resolved ? (
          <div className="rounded-[12px] border border-[#eed9aa] bg-white px-3 py-2 text-[11px] text-[#7b6a36]">已处理，等待会话继续。</div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {(block.data?.options || []).map((option) => (
              <button
                key={option.optionId || option.id}
                onClick={() => respondPermission(requestId, true, option.optionId || option.id)}
                disabled={submitting}
                className="rounded-[10px] border border-[#bce5d6] bg-[#eef9f4] px-4 py-2 text-xs text-[#0f9f6e] transition-colors hover:bg-[#e5f7ef] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? '提交中...' : `批准：${option.name || option.kind || option.optionId}`}
              </button>
            ))}

            {!block.data?.options || block.data.options.length === 0 ? (
              <button
                onClick={() => respondPermission(requestId, true)}
                disabled={submitting}
                className="rounded-[10px] border border-[#bce5d6] bg-[#eef9f4] px-4 py-2 text-xs text-[#0f9f6e] transition-colors hover:bg-[#e5f7ef] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? '提交中...' : '批准'}
              </button>
            ) : null}

            <button
              onClick={() => respondPermission(requestId, false)}
              disabled={submitting}
              className="rounded-[10px] border border-[#efc4c4] bg-[#fff3f3] px-4 py-2 text-xs text-[#cf4040] transition-colors hover:bg-[#ffeaea] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? '提交中...' : '拒绝'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
