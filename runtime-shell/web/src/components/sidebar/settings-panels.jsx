import { useEffect, useMemo, useState } from 'react'
import { api } from '../../api'
import { useStore } from '../../store'
import { readErrorMessage } from '../../store/actions/interaction-action-support'
import {
  Field,
  inputClassName,
  secondaryButtonClassName,
  Select,
  selectClassName,
  stringifyConfigValue,
  useSessionCapabilities,
} from './sidebar-support'

export function ModeSettingPanel() {
  const updateMode = useStore((state) => state.updateMode)
  const currentSessionId = useStore((state) => state.currentSessionId)
  const pendingSettingsAction = useStore((state) => state.pendingSettingsAction)
  const capabilities = useSessionCapabilities()
  const [selected, setSelected] = useState('')

  useEffect(() => {
    setSelected(capabilities.modeId || capabilities.modes?.[0]?.id || '')
  }, [capabilities.modeId, capabilities.modes, currentSessionId])

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        if (!selected) return
        void updateMode(selected)
      }}
      className="grid gap-2.5 pb-3 border-b border-[var(--line)]"
    >
      <span className="text-[10px] font-semibold tracking-[0.14em] uppercase text-brand">Runtime</span>
      <Field label="模式">
        <Select value={selected} onChange={setSelected} options={capabilities.modes} emptyLabel="当前会话没有模式选项" />
      </Field>
      <button type="submit" disabled={!selected || !currentSessionId || Boolean(pendingSettingsAction)} className={secondaryButtonClassName}>
        {pendingSettingsAction === 'mode' ? '切换中...' : '切换模式'}
      </button>
    </form>
  )
}

export function ModelSettingPanel() {
  const updateModel = useStore((state) => state.updateModel)
  const currentSessionId = useStore((state) => state.currentSessionId)
  const pendingSettingsAction = useStore((state) => state.pendingSettingsAction)
  const capabilities = useSessionCapabilities()
  const [selected, setSelected] = useState('')

  useEffect(() => {
    setSelected(capabilities.modelId || capabilities.models?.[0]?.id || '')
  }, [capabilities.modelId, capabilities.models, currentSessionId])

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        if (!selected) return
        void updateModel(selected)
      }}
      className="grid gap-2.5 pb-3 border-b border-[var(--line)]"
    >
      <Field label="模型">
        <Select value={selected} onChange={setSelected} options={capabilities.models} emptyLabel="当前会话没有模型选项" />
      </Field>
      <button type="submit" disabled={!selected || !currentSessionId || Boolean(pendingSettingsAction)} className={secondaryButtonClassName}>
        {pendingSettingsAction === 'model' ? '切换中...' : '切换模型'}
      </button>
    </form>
  )
}

export function ConfigSettingPanel() {
  const updateConfig = useStore((state) => state.updateConfig)
  const currentSessionId = useStore((state) => state.currentSessionId)
  const pendingSettingsAction = useStore((state) => state.pendingSettingsAction)
  const capabilities = useSessionCapabilities()
  const configOptions = capabilities.configOptions || []
  const userConfigOptions = useMemo(() => configOptions.filter((item) => item.id !== 'mode' && item.id !== 'model'), [configOptions])
  const [configId, setConfigId] = useState('')
  const [value, setValue] = useState('')
  const selectedConfig = useMemo(() => userConfigOptions.find((item) => item.id === configId), [configId, userConfigOptions])

  useEffect(() => {
    const fallbackId = userConfigOptions[0]?.id || ''
    setConfigId(userConfigOptions.some((item) => item.id === configId) ? configId : fallbackId)
  }, [configId, userConfigOptions])

  useEffect(() => {
    setValue(stringifyConfigValue(selectedConfig?.currentValue))
  }, [selectedConfig?.id, selectedConfig?.currentValue])

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        if (!configId) return
        void updateConfig(configId, value)
      }}
      className="grid gap-2.5 pb-3 border-b border-[var(--line)]"
    >
      <Field label="配置项">
        <Select value={configId} onChange={setConfigId} options={userConfigOptions} emptyLabel="当前会话没有可配置项" />
      </Field>
      <Field label="配置值">
        {selectedConfig?.type === 'boolean' ? (
          <select value={value} onChange={(event) => setValue(event.target.value)} className={selectClassName}>
            <option value="true">true</option>
            <option value="false">false</option>
          </select>
        ) : selectedConfig?.options?.length ? (
          <select value={value} onChange={(event) => setValue(event.target.value)} className={selectClassName}>
            {selectedConfig.options.map((option) => (
              <option key={option.id || option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        ) : (
          <input value={value} onChange={(event) => setValue(event.target.value)} placeholder="例如 high / true / code" className={inputClassName} />
        )}
      </Field>
      {selectedConfig?.description && <div className="text-[11px] text-[var(--text-muted)] -mt-1">{selectedConfig.description}</div>}
      <button type="submit" disabled={!configId || !currentSessionId || Boolean(pendingSettingsAction)} className={secondaryButtonClassName}>
        {pendingSettingsAction === 'config' ? '更新中...' : '更新配置'}
      </button>
    </form>
  )
}

export function CustomModelsPanel() {
  const setFlash = useStore((state) => state.setFlash)
  const [expanded, setExpanded] = useState(false)
  const [customModels, setCustomModels] = useState([])
  const [modelId, setModelId] = useState('')
  const [modelName, setModelName] = useState('')

  useEffect(() => {
    if (!expanded) return
    api.customModels.get().then((data) => {
      setCustomModels(data.items)
    })
  }, [expanded])

  return (
    <div className="grid gap-2.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-[var(--text-dim)]">自定义模型</span>
        <button onClick={() => setExpanded((current) => !current)} className={secondaryButtonClassName}>
          {expanded ? '收起' : '展开'}
        </button>
      </div>

      {expanded && (
        <div className="grid gap-2.5 animate-fade-in">
          <form
            onSubmit={(event) => {
              event.preventDefault()
              if (!modelId.trim()) return
              setCustomModels((current) => [...current, { modelId: modelId.trim(), name: modelName.trim() || modelId.trim() }])
              setModelId('')
              setModelName('')
            }}
            className="grid gap-2"
          >
            <input value={modelId} onChange={(event) => setModelId(event.target.value)} placeholder="例如 deepseek/deepseek-chat" className={inputClassName} />
            <input value={modelName} onChange={(event) => setModelName(event.target.value)} placeholder="显示名称" className={inputClassName} />
            <button type="submit" className="rounded-[10px] py-2 px-4 text-xs font-semibold bg-brand text-[#14100d] shadow-glow hover:brightness-110 transition-all">
              添加模型
            </button>
          </form>

          <div className="grid gap-1.5">
            {customModels.map((model, index) => (
              <div key={`${model.modelId}-${index}`} className="flex items-center gap-2 text-xs text-[var(--text-dim)]">
                <span>{model.name}</span>
                <span className="text-[var(--text-muted)]">{model.modelId}</span>
                <button onClick={() => setCustomModels((current) => current.filter((_, currentIndex) => currentIndex !== index))} className="ml-auto text-[var(--text-muted)] hover:text-danger transition-colors">
                  删
                </button>
              </div>
            ))}
          </div>

          <button
            onClick={() =>
              api.customModels
                .save(customModels)
                .then(() => setFlash('自定义模型已保存'))
                .catch((error) => setFlash(error instanceof Error ? error.message : '自定义模型保存失败'))
            }
            className={secondaryButtonClassName}
          >
            保存到文件
          </button>
        </div>
      )}
    </div>
  )
}

export function ProviderConfigPanel() {
  const currentSessionId = useStore((state) => state.currentSessionId)
  const loadSessionDetail = useStore((state) => state.loadSessionDetail)
  const activateSession = useStore((state) => state.activateSession)
  const disconnectSSE = useStore((state) => state.disconnectSSE)
  const updateCapability = useStore((state) => state.updateCapability)
  const setFlash = useStore((state) => state.setFlash)
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

  useEffect(() => {
    if (!expanded) return
    api.providerConfig.get().then((data) => {
      const first = data.items[0]
      if (!first) return
      setProviderId(first.providerId || 'deepseek')
      setProviderName(first.name || first.providerId || 'Provider')
      setProviderApi(first.api || '@ai-sdk/openai-compatible')
      setProviderNpm(first.npm || '')
      setBaseURL(first.baseURL || '')
      setApiKey('')
      setApiKeyMasked(first.apiKeyMasked || '')
      setDefaultModel(first.defaultModel || '')
      setModels(first.models?.length ? first.models.map((item) => ({ id: item.id || '', name: item.name || '', api: item.api || '' })) : [{ id: '', name: '', api: '' }])
    })
  }, [expanded])

  return (
    <div className="grid gap-2.5 pb-3 border-b border-[var(--line)]">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-[var(--text-dim)]">Provider 配置</span>
        <button onClick={() => setExpanded((current) => !current)} className={secondaryButtonClassName}>
          {expanded ? '收起' : '展开'}
        </button>
      </div>

      {expanded && (
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

          <button type="submit" disabled={Boolean(pendingSettingsAction) || Boolean(pendingSessionAction)} className="rounded-[10px] py-2.5 px-4 font-semibold text-sm bg-brand text-[#14100d] hover:brightness-110 active:scale-[0.985] transition-all shadow-glow disabled:opacity-40 disabled:cursor-not-allowed">
            {pendingSettingsAction === 'provider' ? '保存中...' : '保存 Provider 配置'}
          </button>
        </form>
      )}
    </div>
  )
}
