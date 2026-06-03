import { useEffect, useState } from 'react'
import { api } from '../../api'
import { useStore } from '../../store'
import { readErrorMessage } from '../../store/actions/interaction-action-support'
import { Field, inputClassName, primeConfiguredProviderModels, secondaryButtonClassName, useViewerContext } from './sidebar-support'

const PROVIDER_PRESETS = [
  {
    id: 'deepseek',
    label: 'DeepSeek',
    providerId: 'deepseek',
    providerName: 'DeepSeek',
    providerApi: '@ai-sdk/openai-compatible',
    providerNpm: '',
    baseURL: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek/deepseek-chat',
    models: [{ id: 'deepseek-chat', name: 'DeepSeek Chat', api: '' }],
  },
  {
    id: 'kimi',
    label: 'Kimi',
    providerId: 'moonshot',
    providerName: 'Kimi',
    providerApi: '@ai-sdk/openai-compatible',
    providerNpm: '',
    baseURL: 'https://api.moonshot.cn/v1',
    defaultModel: 'moonshot/kimi-k2-0711-preview',
    models: [{ id: 'kimi-k2-0711-preview', name: 'Kimi K2', api: '' }],
  },
  {
    id: 'openai',
    label: 'OpenAI',
    providerId: 'openai',
    providerName: 'OpenAI',
    providerApi: '@ai-sdk/openai',
    providerNpm: '',
    baseURL: 'https://api.openai.com/v1',
    defaultModel: 'openai/gpt-4.1-mini',
    models: [{ id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini', api: '' }],
  },
]

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
  const [presetId, setPresetId] = useState('deepseek')

  useEffect(() => {
    api.providerConfig.get().then((data) => {
      primeConfiguredProviderModels(data.items)
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
      setModels(
        preferred.models?.length
          ? preferred.models.map((item) => ({ id: item.id || '', name: item.name || '', api: item.api || '' }))
          : [{ id: '', name: '', api: '' }],
      )
      setPresetId(matchPresetId(preferred.providerId, preferred.name))
      setImpactPreview(null)
    })
  }, [])

  if (!canManageProviderSettings) return null

  return (
    <div className="grid gap-3">
      <div className="text-xs font-semibold tracking-[0.08em] uppercase text-[var(--text-dim)]">
        {canManagePlatformSettings ? '平台 Provider 配置' : '我的 Provider 配置'}
      </div>

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
          if (previewResult.ok) setImpactPreview(previewResult.value)

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

          // 中文/English: refresh the cached Provider models immediately so the model picker
          // reflects the latest saved config before the next session capability refresh finishes.
          const configuredProviders = await api.providerConfig.get().then(
            (data) => data.items,
            () => [
              {
                providerId: providerId.trim(),
                name: providerName.trim(),
                defaultModel: defaultModel.trim(),
                models: cleanedModels,
              },
            ],
          )
          primeConfiguredProviderModels(configuredProviders)
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
        className="grid gap-2 animate-fade-in"
      >
        <div className="grid gap-2.5 rounded-[16px] border border-[rgba(181,148,116,0.14)] bg-[rgba(12,9,7,0.52)] p-3.5">
          <span className="text-xs font-medium text-[var(--text-dim)]">常用预设</span>
          <div className="flex flex-wrap gap-2">
            {PROVIDER_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => {
                  setPresetId(preset.id)
                  applyProviderPreset(preset, {
                    setProviderId,
                    setProviderName,
                    setProviderApi,
                    setProviderNpm,
                    setBaseURL,
                    setDefaultModel,
                    setModels,
                  })
                }}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                  presetId === preset.id
                    ? 'border-brand/20 bg-brand/10 text-brand-text'
                    : 'border-[var(--line)] bg-black/20 text-[var(--text-dim)] hover:bg-black/35'
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <div className="text-[11px] text-[var(--text-muted)] leading-relaxed">
            先选一个常用 Provider 预填连接信息，再补 API Key 和默认模型，首次配置会更快。
          </div>
        </div>

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
            <div key={`provider-model-${index}`} className="grid gap-2 rounded-[16px] border border-[rgba(181,148,116,0.14)] p-3 bg-[rgba(12,9,7,0.52)]">
              <input
                value={model.id}
                onChange={(event) => setModels((current) => current.map((item, currentIndex) => (currentIndex === index ? { ...item, id: event.target.value } : item)))}
                placeholder="模型 ID，例如 deepseek-chat"
                className={inputClassName}
              />
              <input
                value={model.name}
                onChange={(event) => setModels((current) => current.map((item, currentIndex) => (currentIndex === index ? { ...item, name: event.target.value } : item)))}
                placeholder="显示名称"
                className={inputClassName}
              />
              <input
                value={model.api}
                onChange={(event) => setModels((current) => current.map((item, currentIndex) => (currentIndex === index ? { ...item, api: event.target.value } : item)))}
                placeholder="Provider 模型 API 名称（可选）"
                className={inputClassName}
              />
              <button
                type="button"
                onClick={() => setModels((current) => current.filter((_, currentIndex) => currentIndex !== index))}
                className={secondaryButtonClassName}
                disabled={models.length === 1}
              >
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
    </div>
  )
}

function applyProviderPreset(preset, setters) {
  setters.setProviderId(preset.providerId)
  setters.setProviderName(preset.providerName)
  setters.setProviderApi(preset.providerApi)
  setters.setProviderNpm(preset.providerNpm)
  setters.setBaseURL(preset.baseURL)
  setters.setDefaultModel(preset.defaultModel)
  setters.setModels(preset.models.map((item) => ({ ...item })))
}

function matchPresetId(providerId, providerName) {
  const normalizedId = String(providerId || '').toLowerCase()
  const normalizedName = String(providerName || '').toLowerCase()
  return PROVIDER_PRESETS.find((preset) => preset.providerId === normalizedId || preset.label.toLowerCase() === normalizedName)?.id || 'deepseek'
}
