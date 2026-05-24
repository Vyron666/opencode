import { useStore } from '../../store'
import { formatJson, useSessionCapabilities } from './sidebar-support'

export function MetricsPanel() {
  const capabilities = useSessionCapabilities()

  return (
    <div className="pb-3 border-b border-[var(--line)]">
      <span className="text-[10px] font-semibold tracking-[0.14em] uppercase text-brand block mb-2">Snapshot</span>
      <div className="grid grid-cols-2 gap-2">
        {[
          { label: '当前模式', value: capabilities.modeId || '-' },
          { label: '当前模型', value: capabilities.modelId || '-' },
          { label: '命令数', value: capabilities.availableCommands?.length || 0 },
          { label: '总 Tokens', value: capabilities.usage?.used || 0 },
        ].map((item) => (
          <div key={item.label} className="rounded-[14px] p-3 border border-[var(--line)] bg-black/40 grid gap-1">
            <span className="text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wider">{item.label}</span>
            <strong className="text-lg font-bold tracking-tight text-[var(--text)]">{item.value}</strong>
          </div>
        ))}
      </div>

      {capabilities.availableCommands?.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {capabilities.availableCommands.map((command) => (
            <span key={command} className="text-[11px] font-medium px-2.5 py-1 rounded-full bg-brand/10 text-brand-text">
              {command}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

export function PermissionPanel() {
  const pendingPermissions = useStore((state) => state.pendingPermissions)

  return (
    <div className="pb-3 border-b border-[var(--line)]">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div>
          <span className="text-[10px] font-semibold tracking-[0.14em] uppercase text-brand">Approval</span>
          <h3 className="text-sm font-bold mt-0.5">权限审批</h3>
        </div>
      </div>

      {pendingPermissions.length === 0 && (
        <div className="text-xs text-[var(--text-muted)] p-3 text-center border border-dashed border-[var(--line-strong)] rounded-[14px]">
          暂无待处理权限请求
        </div>
      )}

      <div className="grid gap-2.5">
        {pendingPermissions.map((permission, index) => (
          <div key={permission.requestId || index} className="rounded-[14px] p-3 border border-[var(--line)] bg-black/30 grid gap-2">
            <div className="text-xs font-bold">{permission.toolName || `权限请求 #${index + 1}`}</div>
            {permission.rawInput && (
              <pre className="text-xs text-[var(--text-dim)] bg-black/20 rounded-[10px] p-2 whitespace-pre-wrap break-words overflow-x-auto">
                {formatJson(permission.rawInput)}
              </pre>
            )}
            <div className="flex gap-2 flex-wrap">
              {(permission.options || []).map((option) => (
                <span
                  key={option.optionId}
                  className="text-xs px-3 py-1.5 rounded-[8px] bg-success/10 text-success border border-success/20"
                >
                  批准：{option.name || option.kind || option.optionId}
                </span>
              ))}
              {(!permission.options || permission.options.length === 0) && (
                <span className="text-xs px-3 py-1.5 rounded-[8px] bg-success/10 text-success border border-success/20">
                  批准
                </span>
              )}
              <span className="text-xs px-3 py-1.5 rounded-[8px] bg-danger/10 text-danger border border-danger/20">
                拒绝
              </span>
            </div>
            <div className="text-[11px] text-[var(--text-muted)]">
              请在聊天消息区内完成审批。
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function QuestionPanel() {
  const pendingQuestions = useStore((state) => state.pendingQuestions)

  return (
    <div className="pb-3 border-b border-[var(--line)]">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div>
          <span className="text-[10px] font-semibold tracking-[0.14em] uppercase text-brand">Question</span>
          <h3 className="text-sm font-bold mt-0.5">交互提问</h3>
        </div>
      </div>

      {pendingQuestions.length === 0 && (
        <div className="text-xs text-[var(--text-muted)] p-3 text-center border border-dashed border-[var(--line-strong)] rounded-[14px]">
          暂无待处理提问
        </div>
      )}

      <div className="grid gap-2.5">
        {pendingQuestions.map((question, index) => (
          <div key={question.requestId || index} className="rounded-[14px] p-3 border border-[var(--line)] bg-black/30 grid gap-2">
            <div className="text-xs font-bold">{question.message || `提问 #${index + 1}`}</div>
            {question.requestedSchema && (
              <pre className="text-xs text-[var(--text-dim)] bg-black/20 rounded-[10px] p-2 whitespace-pre-wrap break-words overflow-x-auto">
                {formatJson(question.requestedSchema)}
              </pre>
            )}
            <div className="text-[11px] text-[var(--text-muted)]">
              请在聊天消息区内补全并提交信息。
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function SessionDetailPanel() {
  const detail = useStore((state) => state.sessionDetail)

  return (
    <div>
      <div className="flex items-start justify-between gap-3 mb-2">
        <div>
          <span className="text-[10px] font-semibold tracking-[0.14em] uppercase text-brand">Details</span>
          <h3 className="text-sm font-bold mt-0.5">会话详情</h3>
        </div>
      </div>
      <pre className="rounded-[14px] p-3 bg-black/60 border border-[var(--line)] font-mono text-xs leading-relaxed text-[var(--text-dim)] whitespace-pre-wrap break-words overflow-auto min-h-[180px] max-h-[320px]">
        {detail ? JSON.stringify(detail.session || detail, null, 2) : '未选择会话'}
      </pre>
    </div>
  )
}
