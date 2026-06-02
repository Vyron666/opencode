import { useEffect, useState } from 'react'
import { api } from '../../api'
import { useStore } from '../../store'
import { readErrorMessage } from '../../store/actions/interaction-action-support'
import { Field, inputClassName, secondaryButtonClassName, useViewerContext } from './sidebar-support'

export function ConfigHistoryPanel() {
  const setFlash = useStore((state) => state.setFlash)
  const { canManageProviderSettings, canManagePlatformSettings } = useViewerContext()
  const [expanded] = useState(true)
  const [namespace, setNamespace] = useState('')
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!expanded || !canManageProviderSettings) return
    setLoading(true)
    api.configHistory.list({
      ...(namespace ? { namespace } : {}),
      limit: 20,
    }).then(
      (data) => {
        setItems(Array.isArray(data.items) ? data.items : [])
        setLoading(false)
      },
      (error) => {
        setLoading(false)
        setFlash(`配置历史加载失败: ${readErrorMessage(error)}`)
      },
    )
  }, [expanded, namespace, canManageProviderSettings, setFlash])

  if (!canManageProviderSettings) return null

  return (
    <div className="grid gap-2.5">
      <div className="text-xs font-semibold text-[var(--text-dim)]">
        {canManagePlatformSettings ? '配置变更历史' : '我的配置历史'}
      </div>

      {expanded ? (
        <div className="grid gap-2.5 animate-fade-in">
          <Field label="配置类型">
            <select value={namespace} onChange={(event) => setNamespace(event.target.value)} className={inputClassName}>
              <option value="">全部</option>
              <option value="provider">Provider</option>
              <option value="mcp">MCP</option>
              <option value="skill">Skill</option>
            </select>
          </Field>

          {loading ? <div className="text-[11px] text-[var(--text-muted)]">配置历史加载中...</div> : null}
          {!loading && items.length === 0 ? <div className="text-[11px] text-[var(--text-muted)]">当前没有配置变更记录</div> : null}

          {items.map((item) => (
            <div key={item.id} className="grid gap-2 rounded-[12px] border border-[var(--line)] p-3 bg-black/20">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="font-semibold text-[var(--text-primary)]">{item.namespace}/{item.configKey}</span>
                <span className="text-[var(--text-dim)]">{item.changeType}</span>
              </div>
              <div className="text-[11px] text-[var(--text-muted)]">
                作用域: {item.scopeLevel}/{item.scopeId}
              </div>
              <div className="text-[11px] text-[var(--text-muted)]">
                版本: {item.previousVersion || '-'} {'->'} {item.nextVersion} | 时间: {item.createdAt || '-'}
              </div>
              <div className="text-[11px] text-[var(--text-dim)] break-all">
                {item.summaryJson ? JSON.stringify(item.summaryJson) : '无摘要'}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
