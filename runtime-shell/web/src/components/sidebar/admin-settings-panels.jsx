import { useEffect, useState } from 'react'
import { api } from '../../api'
import { useStore } from '../../store'
import { readErrorMessage } from '../../store/actions/interaction-action-support'
import { Field, inputClassName, secondaryButtonClassName, useViewerContext } from './sidebar-support'

export function ProviderConfigPanel() {
  const currentSessionId = useStore((state) => state.currentSessionId)
  const loadSessionDetail = useStore((state) => state.loadSessionDetail)
  const activateSession = useStore((state) => state.activateSession)
  const disconnectSSE = useStore((state) => state.disconnectSSE)
  const updateCapability = useStore((state) => state.updateCapability)
  const setFlash = useStore((state) => state.setFlash)
  const { canManageProviderSettings, canManagePlatformSettings } = useViewerContext()
  const pendingSettingsAction = useStore((state) => state.pendingSettingsAction)
  const pendingSessionAction = useStore((state) => state.pendingSessionAction)
  const sessionSelectionVersion = useStore((state) => state.sessionSelectionVersion)
  const [expanded, setExpanded] = useState(false)
  const [providerId, setProviderId] = useState('deepseek')
  const [providerName, setProviderName] = useState('DeepSeek')
  const [providerApi, setProviderApi] = useState('@ai-sdk/openai-compatible')
  const [providerNpm, setProviderNpm] = useState('')
  const [baseURL, setBaseURL] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [apiKeyMasked, setApiKeyMasked] = useState('')
  const [defaultModel, setDefaultModel] = useState('')
  const [models, setModels] = useState([{ id: '', name: '', api: '' }])
  const [impactPreview, setImpactPreview] = useState(null)

  useEffect(() => {
    if (!expanded) return
    api.providerConfig.get().then((data) => {
      const preferred =
        data.items.find((item) => item.source === 'user_private') ||
        data.items.find((item) => item.source === 'platform_shared') ||
        null
      if (!preferred) return
      setProviderId(preferred.providerId || 'deepseek')
      setProviderName(preferred.name || preferred.providerId || 'Provider')
      setProviderApi(preferred.api || '@ai-sdk/openai-compatible')
      setProviderNpm(preferred.npm || '')
      setBaseURL(preferred.baseURL || '')
      setApiKey('')
      setApiKeyMasked(preferred.apiKeyMasked || '')
      setDefaultModel(preferred.defaultModel || '')
      setModels(preferred.models?.length ? preferred.models.map((item) => ({ id: item.id || '', name: item.name || '', api: item.api || '' })) : [{ id: '', name: '', api: '' }])
      setImpactPreview(null)
    })
  }, [expanded])

  if (!canManageProviderSettings) return null

  return (
    <div className="grid gap-2.5 pb-3 border-b border-[var(--line)]">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-[var(--text-dim)]">{canManagePlatformSettings ? '平台 Provider 配置' : '我的 Provider 配置'}</span>
        <button onClick={() => setExpanded((current) => !current)} className={secondaryButtonClassName}>
          {expanded ? '收起' : '展开'}
        </button>
      </div>

      {expanded ? (
        <form
          onSubmit={async (event) => {
            event.preventDefault()
            const cleanedModels = models
              .map((item) => ({ id: item.id.trim(), name: item.name.trim() || item.id.trim(), api: item.api.trim() }))
              .filter((item) => item.id)
            if (!providerId.trim() || !providerName.trim() || !providerApi.trim() || !baseURL.trim() || !defaultModel.trim() || cleanedModels.length === 0) {
              setFlash('请先补全 Provider 配置')
              return
            }

            useStore.setState({ pendingSettingsAction: 'provider' })
            const previewResult = await api.configImpact.preview({
              namespace: 'provider',
              targetId: providerId.trim(),
            }).then(
              (value) => ({ ok: true, value }),
              (error) => ({ ok: false, error }),
            )
            if (previewResult.ok) {
              setImpactPreview(previewResult.value)
            }
            const saveResult = await api.providerConfig.save({
              providerId: providerId.trim(),
              name: providerName.trim(),
              npm: providerNpm.trim() || undefined,
              api: providerApi.trim(),
              baseURL: baseURL.trim(),
              apiKey: apiKey.trim() || undefined,
              defaultModel: defaultModel.trim(),
              models: cleanedModels,
            }).then(
              (value) => ({ ok: true, value }),
              (error) => ({ ok: false, error }),
            )
            if (!saveResult.ok) {
              useStore.setState({ pendingSettingsAction: '' })
              setFlash(`Provider 配置保存失败: ${readErrorMessage(saveResult.error)}`)
              throw saveResult.error
            }
            setApiKey('')
            setFlash('Provider 配置已保存，正在刷新会话')
            disconnectSSE()
            updateCapability({
              modeId: '',
              modelId: '',
              modes: [],
              models: [],
              configOptions: [],
              availableCommands: [],
              usage: null,
              sessionInfo: null,
            })
            if (currentSessionId) {
              const activationResult =
                useStore.getState().currentSessionId === currentSessionId &&
                useStore.getState().sessionSelectionVersion === sessionSelectionVersion
                  ? await activateSession().then(
                      () => ({ ok: true }),
                      (error) => ({ ok: false, error }),
                    )
                  : { ok: true }
              if (!activationResult.ok) {
                useStore.setState({ pendingSettingsAction: '' })
                setFlash(`刷新会话失败: ${readErrorMessage(activationResult.error)}`)
                throw activationResult.error
              }
              useStore.setState({ pendingSettingsAction: '' })
              return
            }
            const detailResult = await loadSessionDetail().then(
              () => ({ ok: true }),
              (error) => ({ ok: false, error }),
            )
            if (!detailResult.ok) {
              useStore.setState({ pendingSettingsAction: '' })
              setFlash(`刷新会话失败: ${readErrorMessage(detailResult.error)}`)
              throw detailResult.error
            }
            useStore.setState({ pendingSettingsAction: '' })
          }}
          className="grid gap-2.5 animate-fade-in"
        >
          <Field label="Provider ID">
            <input value={providerId} onChange={(event) => setProviderId(event.target.value)} placeholder="例如 deepseek" className={inputClassName} />
          </Field>
          <Field label="Provider 名称">
            <input value={providerName} onChange={(event) => setProviderName(event.target.value)} placeholder="例如 DeepSeek" className={inputClassName} />
          </Field>
          <Field label="Provider API">
            <input value={providerApi} onChange={(event) => setProviderApi(event.target.value)} placeholder="例如 @ai-sdk/openai-compatible" className={inputClassName} />
          </Field>
          <Field label="Provider NPM（可选）">
            <input value={providerNpm} onChange={(event) => setProviderNpm(event.target.value)} placeholder="例如 @ai-sdk/openai-compatible" className={inputClassName} />
          </Field>
          <Field label="Base URL">
            <input value={baseURL} onChange={(event) => setBaseURL(event.target.value)} placeholder="例如 https://api.deepseek.com/v1" className={inputClassName} />
          </Field>
          <Field label="API Key">
            <input value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={apiKeyMasked || '留空则保留已有密钥'} className={inputClassName} />
          </Field>
          <Field label="默认模型">
            <input value={defaultModel} onChange={(event) => setDefaultModel(event.target.value)} placeholder="例如 deepseek/deepseek-chat" className={inputClassName} />
          </Field>
          {impactPreview ? (
            <div className="rounded-[10px] border border-[var(--line)] bg-black/20 px-3 py-2 text-[11px] text-[var(--text-dim)]">
              {impactPreview.summary}；预计影响 {impactPreview.affectedSessionCount} 个活跃会话
            </div>
          ) : null}

          <div className="grid gap-2">
            <span className="text-xs font-medium text-[var(--text-dim)]">模型列表</span>
            {models.map((model, index) => (
              <div key={`provider-model-${index}`} className="grid gap-2 rounded-[12px] border border-[var(--line)] p-2.5 bg-black/20">
                <input value={model.id} onChange={(event) => setModels((current) => current.map((item, currentIndex) => (currentIndex === index ? { ...item, id: event.target.value } : item)))} placeholder="模型 ID，例如 deepseek-chat" className={inputClassName} />
                <input value={model.name} onChange={(event) => setModels((current) => current.map((item, currentIndex) => (currentIndex === index ? { ...item, name: event.target.value } : item)))} placeholder="显示名称" className={inputClassName} />
                <input value={model.api} onChange={(event) => setModels((current) => current.map((item, currentIndex) => (currentIndex === index ? { ...item, api: event.target.value } : item)))} placeholder="Provider 模型 API 名称（可选）" className={inputClassName} />
                <button type="button" onClick={() => setModels((current) => current.filter((_, currentIndex) => currentIndex !== index))} className={secondaryButtonClassName} disabled={models.length === 1}>
                  删除这一行
                </button>
              </div>
            ))}
            <button type="button" onClick={() => setModels((current) => [...current, { id: '', name: '', api: '' }])} className={secondaryButtonClassName}>
              添加模型
            </button>
          </div>

          <button
            type="submit"
            disabled={Boolean(pendingSettingsAction) || Boolean(pendingSessionAction)}
            className="rounded-[10px] py-2.5 px-4 font-semibold text-sm bg-brand text-[#14100d] hover:brightness-110 active:scale-[0.985] transition-all shadow-glow disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {pendingSettingsAction === 'provider' ? '保存中...' : '保存 Provider 配置'}
          </button>
        </form>
      ) : null}
    </div>
  )
}

export function WorkerOverviewPanel() {
  const workers = useStore((state) => state.workers)
  const workerOverview = useStore((state) => state.workerOverview)
  const { canViewSystemWorkers } = useViewerContext()

  if (!canViewSystemWorkers) return null

  return (
    <div className="grid gap-2.5 pb-3 border-b border-[var(--line)]">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-[var(--text-dim)]">Worker 概览</span>
        <span className="text-[11px] text-[var(--text-muted)]">
          {workerOverview.ready}/{workerOverview.total} ready
        </span>
      </div>

      <div className="grid gap-1.5">
        {workers.map((worker) => (
          <div key={worker.id} className="rounded-[12px] border border-[var(--line)] bg-black/20 px-3 py-2 text-xs text-[var(--text-dim)]">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-[var(--text-primary)]">{worker.name}</span>
              <span>{worker.status}</span>
            </div>
            <div className="mt-1 text-[var(--text-muted)]">
              {worker.activeSessionCount}/{worker.capacity} sessions
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function McpConfigPanel() {
  const setFlash = useStore((state) => state.setFlash)
  const { canManageProviderSettings, canManagePlatformSettings } = useViewerContext()
  const pendingSettingsAction = useStore((state) => state.pendingSettingsAction)
  const [expanded, setExpanded] = useState(false)
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
    <div className="grid gap-2.5 pb-3 border-b border-[var(--line)]">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-[var(--text-dim)]">{canManagePlatformSettings ? '平台 MCP 配置' : '我的 MCP 配置'}</span>
        <button onClick={() => setExpanded((current) => !current)} className={secondaryButtonClassName}>
          {expanded ? '收起' : '展开'}
        </button>
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
            if (previewResult.ok) {
              setImpactPreview(previewResult.value)
            }
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
          className="grid gap-2.5 animate-fade-in"
        >
          {servers.map((server, index) => (
            <div key={`mcp-server-${index}`} className="grid gap-2 rounded-[12px] border border-[var(--line)] p-2.5 bg-black/20">
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

export function SkillConfigPanel() {
  const setFlash = useStore((state) => state.setFlash)
  const { canManageProviderSettings, canManagePlatformSettings } = useViewerContext()
  const pendingSettingsAction = useStore((state) => state.pendingSettingsAction)
  const [expanded, setExpanded] = useState(false)
  const [paths, setPaths] = useState('')
  const [urls, setUrls] = useState('')
  const [impactPreview, setImpactPreview] = useState(null)

  useEffect(() => {
    if (!expanded) return
    api.skillConfig.get().then((data) => {
      setPaths(Array.isArray(data.paths) ? data.paths.join('\n') : '')
      setUrls(Array.isArray(data.urls) ? data.urls.join('\n') : '')
      setImpactPreview(null)
    })
  }, [expanded])

  if (!canManageProviderSettings) return null

  return (
    <div className="grid gap-2.5 pb-3 border-b border-[var(--line)]">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-[var(--text-dim)]">{canManagePlatformSettings ? '平台 Skill 配置' : '我的 Skill 配置'}</span>
        <button onClick={() => setExpanded((current) => !current)} className={secondaryButtonClassName}>
          {expanded ? '收起' : '展开'}
        </button>
      </div>

      {expanded ? (
        <form
          onSubmit={async (event) => {
            event.preventDefault()
            useStore.setState({ pendingSettingsAction: 'skill' })
            const previewResult = await api.configImpact.preview({
              namespace: 'skill',
            }).then(
              (value) => ({ ok: true, value }),
              (error) => ({ ok: false, error }),
            )
            if (previewResult.ok) {
              setImpactPreview(previewResult.value)
            }
            const saveResult = await api.skillConfig.save({
              paths: paths.split('\n').map((item) => item.trim()).filter(Boolean),
              urls: urls.split('\n').map((item) => item.trim()).filter(Boolean),
            }).then(
              (value) => ({ ok: true, value }),
              (error) => ({ ok: false, error }),
            )
            useStore.setState({ pendingSettingsAction: '' })
            if (!saveResult.ok) {
              setFlash(`Skill 配置保存失败: ${readErrorMessage(saveResult.error)}`)
              throw saveResult.error
            }
            setFlash('Skill 配置已保存')
          }}
          className="grid gap-2.5 animate-fade-in"
        >
          <Field label="Skill Paths">
            <textarea value={paths} onChange={(event) => setPaths(event.target.value)} placeholder={'每行一个本地路径\n例如\nC:\\Users\\xxx\\.codex\\skills'} className={`${inputClassName} min-h-[96px]`} />
          </Field>
          <Field label="Skill URLs">
            <textarea value={urls} onChange={(event) => setUrls(event.target.value)} placeholder={'每行一个远程 URL\n例如\nhttps://example.com/skills/index.json'} className={`${inputClassName} min-h-[96px]`} />
          </Field>

          {impactPreview ? (
            <div className="rounded-[10px] border border-[var(--line)] bg-black/20 px-3 py-2 text-[11px] text-[var(--text-dim)]">
              {impactPreview.summary}；预计影响 {impactPreview.affectedSessionCount} 个活跃会话
            </div>
          ) : null}

          <button type="submit" disabled={Boolean(pendingSettingsAction)} className="rounded-[10px] py-2.5 px-4 font-semibold text-sm bg-brand text-[#14100d] hover:brightness-110 active:scale-[0.985] transition-all shadow-glow disabled:opacity-40 disabled:cursor-not-allowed">
            {pendingSettingsAction === 'skill' ? '保存中...' : '保存 Skill 配置'}
          </button>
        </form>
      ) : null}
    </div>
  )
}
