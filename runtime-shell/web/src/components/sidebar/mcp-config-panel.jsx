import { useEffect, useMemo, useState } from 'react'
import { api } from '../../api'
import { useStore } from '../../store'
import { readErrorMessage } from '../../store/actions/interaction-action-support'
import { Field, inputClassName, secondaryButtonClassName, useViewerContext } from './sidebar-support'

function createEmptyServer() {
  return { name: '', type: 'local', command: '', url: '', headers: '', timeout: '', enabled: true }
}

export function McpConfigPanel() {
  const setFlash = useStore((state) => state.setFlash)
  const pendingSettingsAction = useStore((state) => state.pendingSettingsAction)
  const { canManageProviderSettings, canManagePlatformSettings } = useViewerContext()
  const [visibleItems, setVisibleItems] = useState([])
  const [servers, setServers] = useState([createEmptyServer()])
  const [impactPreview, setImpactPreview] = useState(null)

  const platformItems = useMemo(
    () => visibleItems.filter((item) => item.source === 'platform_shared'),
    [visibleItems],
  )
  const privateItems = useMemo(
    () => visibleItems.filter((item) => item.source === 'user_private'),
    [visibleItems],
  )

  useEffect(() => {
    if (!canManageProviderSettings) return
    void loadMcpData()
  }, [canManageProviderSettings])

  if (!canManageProviderSettings) return null

  return (
    <div className="grid gap-4">
      <SectionBlock
        title="平台共享 MCP"
        description="普通用户可见并可直接使用的平台共享 MCP。"
        items={platformItems}
        emptyLabel="当前没有平台共享 MCP"
      />

      <SectionBlock
        title="我的私有 MCP"
        description="只属于当前用户的 MCP 配置。"
        items={privateItems}
        emptyLabel="当前没有私有 MCP"
      />

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

          await loadMcpData()
          setFlash('MCP 配置已保存')
        }}
        className="grid gap-3"
      >
        <div className="grid gap-3 rounded-[24px] border border-[#dbe6fb] bg-white p-4 shadow-[0_18px_42px_rgba(15,23,42,0.06)]">
          <div className="grid gap-1">
            <div className="text-[14px] font-semibold text-[#18233b]">
              {canManagePlatformSettings ? '平台共享 MCP 编辑器' : '我的私有 MCP 编辑器'}
            </div>
            <div className="text-[12px] leading-6 text-[#70809c]">
              {canManagePlatformSettings ? '管理员保存后会更新平台共享 MCP。' : '普通用户保存后只会更新自己的私有 MCP。'}
            </div>
          </div>

          {servers.map((server, index) => (
            <div key={`mcp-server-${index}`} className="grid gap-2.5 rounded-[18px] border border-[#e3ebfa] bg-[#f8fbff] p-3">
              <Field label="Server Name">
                <input value={server.name} onChange={(event) => setServers((current) => current.map((item, currentIndex) => (currentIndex === index ? { ...item, name: event.target.value } : item)))} placeholder="例如 docs-server" className={inputClassName} />
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
            <div className="rounded-[12px] border border-brand/15 bg-brand/5 px-3 py-2 text-[11px] text-[var(--text-dim)]">
              {impactPreview.summary}；预计影响 {impactPreview.affectedSessionCount} 个活跃会话。
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setServers((current) => [...current, createEmptyServer()])} className={secondaryButtonClassName}>
              添加 MCP
            </button>
            <button
              type="submit"
              disabled={Boolean(pendingSettingsAction)}
              className="rounded-[14px] bg-brand px-4 py-3 text-sm font-semibold text-white transition-all hover:bg-[var(--brand-strong)] active:scale-[0.985] shadow-[0_12px_30px_rgba(37,99,235,0.18)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {pendingSettingsAction === 'mcp' ? '保存中...' : '保存 MCP 配置'}
            </button>
          </div>
        </div>
      </form>
    </div>
  )

  async function loadMcpData() {
    const data = await api.mcpConfig.get().catch(() => ({ items: [] }))
    const nextItems = Array.isArray(data.items) ? data.items : []
    setVisibleItems(nextItems)
    const editableItems = canManagePlatformSettings
      ? nextItems.filter((item) => item.source === 'platform_shared')
      : nextItems.filter((item) => item.source === 'user_private')
    setServers(editableItems.length > 0 ? editableItems.map(mapItemToForm) : [createEmptyServer()])
    setImpactPreview(null)
  }
}

function SectionBlock({ title, description, items, emptyLabel }) {
  return (
    <section className="grid gap-2 rounded-[22px] border border-[#dbe6fb] bg-[#f7faff] p-4">
      <div className="grid gap-1">
        <div className="text-[14px] font-semibold text-[#18233b]">{title}</div>
        <div className="text-[12px] leading-6 text-[#70809c]">{description}</div>
      </div>

      {items.length === 0 ? <div className="rounded-[14px] border border-dashed border-[#d5e1f7] bg-white px-4 py-3 text-[12px] text-[#8a96ab]">{emptyLabel}</div> : null}

      {items.length > 0 ? (
        <div className="grid gap-2">
          {items.map((item) => (
            <div key={`${item.source}-${item.name}`} className="rounded-[16px] border border-[#dbe6fb] bg-white px-4 py-3">
              <div className="text-[14px] font-semibold text-[#24324a]">{item.name}</div>
              <div className="mt-1 text-[12px] text-[#7c8aa5]">
                {item.type === 'local' ? 'local' : item.url || 'remote'} · {item.enabled === false ? '未启用' : '已启用'}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  )
}

function mapItemToForm(item) {
  return {
    name: item.name || '',
    type: item.type || 'local',
    command: Array.isArray(item.command) ? item.command.join('\n') : '',
    url: item.url || '',
    headers: item.headers ? JSON.stringify(item.headers, null, 2) : '',
    timeout: item.timeout == null ? '' : String(item.timeout),
    enabled: item.enabled !== false,
  }
}
