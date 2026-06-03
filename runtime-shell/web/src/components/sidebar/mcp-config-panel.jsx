import { useEffect, useState } from 'react'
import { api } from '../../api'
import { useStore } from '../../store'
import { readErrorMessage } from '../../store/actions/interaction-action-support'
import { Field, inputClassName, secondaryButtonClassName, useViewerContext } from './sidebar-support'

export function McpConfigPanel() {
  const setFlash = useStore((state) => state.setFlash)
  const { canManageProviderSettings, canManagePlatformSettings } = useViewerContext()
  const pendingSettingsAction = useStore((state) => state.pendingSettingsAction)
  const [expanded] = useState(true)
  const [servers, setServers] = useState([{ name: '', type: 'local', command: '', url: '', headers: '', timeout: '', enabled: true }])
  const [impactPreview, setImpactPreview] = useState(null)

  useEffect(() => {
    if (!expanded) return
    api.mcpConfig.get().then((data) => {
      if (!data.items?.length) return
      const preferred = data.items.filter((item) => item.source === 'user_private')
      const nextItems = (preferred.length ? preferred : data.items).map((item) => ({
        name: item.name || '',
        type: item.type || 'local',
        command: Array.isArray(item.command) ? item.command.join('\n') : '',
        url: item.url || '',
        headers: item.headers ? JSON.stringify(item.headers, null, 2) : '',
        timeout: item.timeout == null ? '' : String(item.timeout),
        enabled: item.enabled !== false,
      }))
      setServers(nextItems.length ? nextItems : [{ name: '', type: 'local', command: '', url: '', headers: '', timeout: '', enabled: true }])
      setImpactPreview(null)
    })
  }, [expanded])

  if (!canManageProviderSettings) return null

  return (
    <div className="grid gap-3">
      <div className="text-xs font-semibold tracking-[0.08em] uppercase text-[var(--text-dim)]">
        {canManagePlatformSettings ? '平台 MCP 配置' : '我的 MCP 配置'}
      </div>

      {expanded ? (
        <form
          onSubmit={async (event) => {
            event.preventDefault()
            const normalizedServers = {}
            for (const server of servers) {
              const name = server.name.trim()
              if (!name) continue
              if (server.type === 'local') {
                const command = server.command
                  .split('\n')
                  .map((item) => item.trim())
                  .filter(Boolean)
                if (command.length === 0) {
                  setFlash(`MCP '${name}' 需要至少一行 command`)
                  return
                }
                normalizedServers[name] = {
                  type: 'local',
                  command,
                  enabled: server.enabled,
                  ...(server.timeout ? { timeout: Number(server.timeout) } : {}),
                }
                continue
              }

              if (!server.url.trim()) {
                setFlash(`MCP '${name}' 需要填写 URL`)
                return
              }

              let headers
              if (server.headers.trim()) {
                try {
                  headers = JSON.parse(server.headers)
                } catch {
                  setFlash(`MCP '${name}' 的 Headers JSON 格式不正确`)
                  return
                }
              }

              normalizedServers[name] = {
                type: 'remote',
                url: server.url.trim(),
                enabled: server.enabled,
                ...(server.timeout ? { timeout: Number(server.timeout) } : {}),
                ...(headers ? { headers } : {}),
              }
            }

            useStore.setState({ pendingSettingsAction: 'mcp' })
            const previewResult = await api.configImpact.preview({
              namespace: 'mcp',
            }).then(
              (value) => ({ ok: true, value }),
              (error) => ({ ok: false, error }),
            )
            if (previewResult.ok) setImpactPreview(previewResult.value)

            const saveResult = await api.mcpConfig.save(normalizedServers).then(
              (value) => ({ ok: true, value }),
              (error) => ({ ok: false, error }),
            )
            useStore.setState({ pendingSettingsAction: '' })
            if (!saveResult.ok) {
              setFlash(`MCP 配置保存失败: ${readErrorMessage(saveResult.error)}`)
              throw saveResult.error
            }
            setFlash('MCP 配置已保存')
          }}
          className="grid gap-3 animate-fade-in"
        >
          {servers.map((server, index) => (
            <div key={`mcp-server-${index}`} className="grid gap-2.5 rounded-[16px] border border-[rgba(181,148,116,0.14)] p-3 bg-[rgba(12,9,7,0.52)]">
              <Field label="Server Name">
                <input value={server.name} onChange={(event) => setServers((current) => current.map((item, currentIndex) => (currentIndex === index ? { ...item, name: event.target.value } : item)))} placeholder="例如 deepseek-docs" className={inputClassName} />
              </Field>
              <Field label="Type">
                <select value={server.type} onChange={(event) => setServers((current) => current.map((item, currentIndex) => (currentIndex === index ? { ...item, type: event.target.value } : item)))} className={inputClassName}>
                  <option value="local">local</option>
                  <option value="remote">remote</option>
                </select>
              </Field>
              {server.type === 'local' ? (
                <Field label="Command">
                  <textarea value={server.command} onChange={(event) => setServers((current) => current.map((item, currentIndex) => (currentIndex === index ? { ...item, command: event.target.value } : item)))} placeholder={'每行一个参数\n例如\nnpx\n-y\n@modelcontextprotocol/server-filesystem'} className={`${inputClassName} min-h-[88px]`} />
                </Field>
              ) : (
                <>
                  <Field label="URL">
                    <input value={server.url} onChange={(event) => setServers((current) => current.map((item, currentIndex) => (currentIndex === index ? { ...item, url: event.target.value } : item)))} placeholder="例如 https://example.com/mcp" className={inputClassName} />
                  </Field>
                  <Field label="Headers JSON">
                    <textarea value={server.headers} onChange={(event) => setServers((current) => current.map((item, currentIndex) => (currentIndex === index ? { ...item, headers: event.target.value } : item)))} placeholder={'例如\n{\n  "Authorization": "Bearer xxx"\n}'} className={`${inputClassName} min-h-[88px]`} />
                  </Field>
                </>
              )}
              <Field label="Timeout (ms)">
                <input value={server.timeout} onChange={(event) => setServers((current) => current.map((item, currentIndex) => (currentIndex === index ? { ...item, timeout: event.target.value } : item)))} placeholder="例如 15000" className={inputClassName} />
              </Field>
              <label className="flex items-center gap-2 text-xs text-[var(--text-dim)]">
                <input type="checkbox" checked={server.enabled} onChange={(event) => setServers((current) => current.map((item, currentIndex) => (currentIndex === index ? { ...item, enabled: event.target.checked } : item)))} />
                启用该 MCP
              </label>
              <button type="button" onClick={() => setServers((current) => current.filter((_, currentIndex) => currentIndex !== index))} className={secondaryButtonClassName} disabled={servers.length === 1}>
                删除这一项
              </button>
            </div>
          ))}

          {impactPreview ? (
            <div className="rounded-[10px] border border-[var(--line)] bg-black/20 px-3 py-2 text-[11px] text-[var(--text-dim)]">
              {impactPreview.summary}；预计影响 {impactPreview.affectedSessionCount} 个活跃会话
            </div>
          ) : null}

          <button type="button" onClick={() => setServers((current) => [...current, { name: '', type: 'local', command: '', url: '', headers: '', timeout: '', enabled: true }])} className={secondaryButtonClassName}>
            添加 MCP
          </button>

          <button type="submit" disabled={Boolean(pendingSettingsAction)} className="rounded-[10px] py-2.5 px-4 font-semibold text-sm bg-brand text-[#14100d] hover:brightness-110 active:scale-[0.985] transition-all shadow-glow disabled:opacity-40 disabled:cursor-not-allowed">
            {pendingSettingsAction === 'mcp' ? '保存中...' : '保存 MCP 配置'}
          </button>
        </form>
      ) : null}
    </div>
  )
}
