import { useEffect, useMemo, useState } from 'react'
import { api } from '../../api'
import { useStore } from '../../store'
import { readErrorMessage } from '../../store/actions/interaction-action-support'
import { Field, inputClassName, primeConfiguredProviderModels, secondaryButtonClassName, useViewerContext } from './sidebar-support'

function createEmptyModel() {
  return { id: '', name: '', api: '' }
}

const PREFERRED_TEMPLATE_IDS = ['deepseek', 'anthropic', 'openai', 'google', 'openrouter', 'github-copilot', 'opencode']

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
  const { canManageProviderSettings, canManagePlatformSettings } = useViewerContext()
  const [providerItems, setProviderItems] = useState([])
  const [builtinItems, setBuiltinItems] = useState([])
  const [freeItems, setFreeItems] = useState([])
  const [selectedProvider, setSelectedProvider] = useState(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [customOpen, setCustomOpen] = useState(false)
  const [templateQuery, setTemplateQuery] = useState('')
  const [providerId, setProviderId] = useState('')
  const [providerName, setProviderName] = useState('')
  const [providerApi, setProviderApi] = useState('')
  const [providerNpm, setProviderNpm] = useState('')
  const [baseURL, setBaseURL] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [apiKeyMasked, setApiKeyMasked] = useState('')
  const [defaultModel, setDefaultModel] = useState('')
  const [models, setModels] = useState([createEmptyModel()])
  const [impactPreview, setImpactPreview] = useState(null)

  const platformItems = useMemo(() => providerItems.filter((item) => item.source === 'platform_shared'), [providerItems])
  const privateItems = useMemo(() => providerItems.filter((item) => item.source === 'user_private'), [providerItems])
  const connectedItems = useMemo(() => [...platformItems, ...privateItems], [platformItems, privateItems])
  const recommendedTemplates = useMemo(() => {
    const preferred = builtinItems.filter((item) => PREFERRED_TEMPLATE_IDS.includes(item.providerId))
    const fallback = builtinItems.filter((item) => !PREFERRED_TEMPLATE_IDS.includes(item.providerId))
    return [...preferred, ...fallback].slice(0, 6)
  }, [builtinItems])
  const filteredTemplates = useMemo(() => {
    const keyword = templateQuery.trim().toLowerCase()
    if (!keyword) return builtinItems
    return builtinItems.filter((item) => {
      const name = String(item.name || '').toLowerCase()
      const id = String(item.providerId || '').toLowerCase()
      return name.includes(keyword) || id.includes(keyword)
    })
  }, [builtinItems, templateQuery])

  useEffect(() => {
    if (!canManageProviderSettings) return
    void loadProviderData()
  }, [canManageProviderSettings])

  if (!canManageProviderSettings) return null

  return (
    <div className="grid gap-5">
      <SectionTitle
        title="Provider"
        description="设置页保留完整模板入口，但主面板只展示已连接、热门入口和自定义入口，避免把全部系统模板铺在页面里。"
      />

      <ProviderSection
        title="已连接的提供商"
        description={connectedItems.length ? '这里只展示当前真实可用的 Provider 配置。' : '当前还没有已连接的 Provider。'}
      >
        {connectedItems.length ? (
          <div className="rounded-[24px] border border-[#dbe6fb] bg-white shadow-[0_16px_36px_rgba(15,23,42,0.05)]">
            {connectedItems.map((item, index) => (
              <ConnectedProviderRow
                key={`${item.source}:${item.providerId}`}
                item={item}
                isLast={index === connectedItems.length - 1}
                onEdit={() => {
                  setSelectedProvider(item)
                  applyProviderToForm(item)
                  setCustomOpen(true)
                }}
                onDelete={() => void handleDelete(item)}
                deleting={pendingSettingsAction === 'provider'}
                canDelete={canManagePlatformSettings || item.source === 'user_private'}
              />
            ))}
          </div>
        ) : (
          <EmptyState label="还没有可直接使用的 Provider，可以从下方热门入口或自定义入口开始。" />
        )}
      </ProviderSection>

      <ProviderSection
        title="热门提供商"
        description="主面板保持简洁，只放高频 Provider，完整系统模板放到“查看更多”里。"
        action={(
          <button
            type="button"
            onClick={() => {
              setSelectedProvider(null)
              applyProviderToForm({})
              setCustomOpen(true)
            }}
            className="rounded-[12px] border border-[#dbe6fb] bg-white px-3.5 py-2 text-sm font-semibold text-[#3566df] transition-colors hover:bg-[#f5f8ff]"
          >
            + 自定义 Provider
          </button>
        )}
      >
        <div className="rounded-[24px] border border-[#dbe6fb] bg-white shadow-[0_16px_36px_rgba(15,23,42,0.05)]">
          {recommendedTemplates.map((item, index) => (
            <TemplateProviderRow
              key={`recommended:${item.providerId}:${index}`}
              item={item}
              isLast={index === recommendedTemplates.length - 1}
              onConnect={() => {
                setSelectedProvider(item)
                applyProviderToForm(item)
                setCustomOpen(true)
              }}
            />
          ))}
        </div>

        {builtinItems.length > recommendedTemplates.length ? (
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="mt-3 text-sm font-semibold text-[#3566df] transition-opacity hover:opacity-80"
          >
            查看更多提供商
          </button>
        ) : null}
      </ProviderSection>

      <FreeModelSection items={freeItems} />

      {pickerOpen ? (
        <ProviderPickerDialog
          query={templateQuery}
          setQuery={setTemplateQuery}
          items={filteredTemplates}
          onClose={() => setPickerOpen(false)}
          onPick={(item) => {
            setSelectedProvider(item)
            applyProviderToForm(item)
            setPickerOpen(false)
            setCustomOpen(true)
          }}
        />
      ) : null}

      {customOpen ? (
        <ProviderFormDialog
          title={selectedProvider ? (selectedProvider.source ? '编辑 Provider' : '连接 Provider') : '自定义 Provider'}
          pending={Boolean(pendingSettingsAction) || Boolean(pendingSessionAction)}
          isPlatformSharedTemplate={!canManagePlatformSettings && selectedProvider?.source === 'platform_shared'}
          providerId={providerId}
          setProviderId={setProviderId}
          providerName={providerName}
          setProviderName={setProviderName}
          providerApi={providerApi}
          setProviderApi={setProviderApi}
          providerNpm={providerNpm}
          setProviderNpm={setProviderNpm}
          baseURL={baseURL}
          setBaseURL={setBaseURL}
          apiKey={apiKey}
          setApiKey={setApiKey}
          apiKeyMasked={apiKeyMasked}
          defaultModel={defaultModel}
          setDefaultModel={setDefaultModel}
          models={models}
          setModels={setModels}
          impactPreview={impactPreview}
          onClose={() => setCustomOpen(false)}
          onSubmit={async (event) => {
            event.preventDefault()
            await handleSave()
          }}
        />
      ) : null}
    </div>
  )

  async function loadProviderData() {
    const data = await api.providerConfig.get().catch(() => ({ items: [], builtinItems: [], freeItems: [] }))
    const nextItems = Array.isArray(data.items) ? data.items : []
    const nextBuiltinItems = Array.isArray(data.builtinItems) ? data.builtinItems : []
    const nextFreeItems = Array.isArray(data.freeItems) ? data.freeItems : []
    setProviderItems(nextItems)
    setBuiltinItems(nextBuiltinItems)
    setFreeItems(nextFreeItems)
    primeConfiguredProviderModels([...nextItems, ...nextFreeItems])
  }

  function applyProviderToForm(provider) {
    setProviderId(provider.providerId || '')
    setProviderName(provider.name || provider.providerId || '')
    setProviderApi(provider.api || provider.npm || '')
    setProviderNpm(provider.npm || '')
    setBaseURL(provider.baseURL || '')
    setApiKey('')
    setApiKeyMasked(provider.apiKeyMasked || '')
    setDefaultModel(provider.defaultModel || '')
    setModels(
      Array.isArray(provider.models) && provider.models.length > 0
        ? provider.models.map((item) => ({
            id: item.id || '',
            name: item.name || item.id || '',
            api: item.api || '',
          }))
        : [createEmptyModel()],
    )
    setImpactPreview(null)
  }

  async function handleSave() {
    const cleanedModels = models
      .map((item) => ({
        id: item.id.trim(),
        name: item.name.trim() || item.id.trim(),
        api: item.api.trim(),
      }))
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

    await reloadProviderState(providerId.trim())
    setFlash('Provider 配置已保存，正在刷新会话')
    setCustomOpen(false)
  }

  async function handleDelete(item) {
    useStore.setState({ pendingSettingsAction: 'provider' })
    const removeResult = await api.providerConfig.remove({
      providerId: item.providerId,
      source: item.source,
    }).then(
      (value) => ({ ok: true, value }),
      (error) => ({ ok: false, error }),
    )
    if (!removeResult.ok) {
      useStore.setState({ pendingSettingsAction: '' })
      setFlash(`Provider 删除失败: ${readErrorMessage(removeResult.error)}`)
      throw removeResult.error
    }

    await reloadProviderState('')
    setFlash('Provider 已删除，正在刷新会话')
  }

  async function reloadProviderState(activeProviderId) {
    const latestData = await api.providerConfig.get().catch(() => ({
      items: [],
      builtinItems: [],
      freeItems: [],
    }))
    const nextItems = Array.isArray(latestData.items) ? latestData.items : []
    const nextBuiltinItems = Array.isArray(latestData.builtinItems) ? latestData.builtinItems : []
    const nextFreeItems = Array.isArray(latestData.freeItems) ? latestData.freeItems : []
    primeConfiguredProviderModels([...nextItems, ...nextFreeItems])
    setProviderItems(nextItems)
    setBuiltinItems(nextBuiltinItems)
    setFreeItems(nextFreeItems)
    setApiKey('')
    setApiKeyMasked((nextItems.find((item) => item.providerId === activeProviderId) || {}).apiKeyMasked || '')
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
  }
}

function SectionTitle({ title, description }) {
  return (
    <div className="grid gap-1">
      <div className="text-[13px] font-semibold uppercase tracking-[0.08em] text-[var(--text-dim)]">{title}</div>
      <div className="text-[12px] leading-6 text-[#70809c]">{description}</div>
    </div>
  )
}

function ProviderSection({ title, description, action, children }) {
  return (
    <section className="grid gap-3">
      <div className="flex items-end justify-between gap-3">
        <div className="grid gap-1">
          <div className="text-[15px] font-semibold text-[#18233b]">{title}</div>
          <div className="text-[12px] leading-6 text-[#70809c]">{description}</div>
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

function EmptyState({ label }) {
  return (
    <div className="rounded-[18px] border border-dashed border-[#d7e3fb] bg-white px-4 py-4 text-sm text-[#8a96ab]">
      {label}
    </div>
  )
}

function ConnectedProviderRow({ item, isLast, onEdit, onDelete, deleting, canDelete }) {
  return (
    <div className={`flex items-center justify-between gap-3 px-5 py-4 ${isLast ? '' : 'border-b border-[#edf2fc]'}`}>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <div className="truncate text-[15px] font-semibold text-[#24324a]">{item.name || item.providerId}</div>
          <span className="rounded-full bg-[#eef4ff] px-2 py-0.5 text-[11px] text-[#3566df]">
            {item.source === 'platform_shared' ? '平台共享' : '私有'}
          </span>
        </div>
        <div className="mt-1 text-[12px] text-[#7c8aa5]">
          {item.defaultModel || item.providerId} 路 {item.models?.length || 0} 个模型
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onEdit}
          className="rounded-[12px] border border-[#dbe6fb] bg-white px-4 py-2 text-sm font-semibold text-[#3566df] transition-colors hover:bg-[#f5f8ff]"
        >
          {item.source === 'platform_shared' ? '查看' : '编辑'}
        </button>
        {canDelete ? (
          <button
            type="button"
            onClick={onDelete}
            disabled={deleting}
            className="rounded-[12px] border border-[#f3d0d0] bg-[#fff7f7] px-4 py-2 text-sm font-semibold text-[#c45858] transition-colors hover:bg-[#fff0f0] disabled:cursor-not-allowed disabled:opacity-45"
          >
            删除
          </button>
        ) : null}
      </div>
    </div>
  )
}

function TemplateProviderRow({ item, isLast, onConnect }) {
  return (
    <div className={`flex items-center justify-between gap-3 px-5 py-4 ${isLast ? '' : 'border-b border-[#edf2fc]'}`}>
      <div className="min-w-0">
        <div className="truncate text-[15px] font-semibold text-[#24324a]">{item.name || item.providerId}</div>
        <div className="mt-1 text-[12px] text-[#7c8aa5]">{item.providerId} 路 {item.models?.length || 0} 个模型</div>
      </div>
      <button
        type="button"
        onClick={onConnect}
        className="rounded-[12px] border border-[#dbe6fb] bg-white px-4 py-2 text-sm font-semibold text-[#3566df] transition-colors hover:bg-[#f5f8ff]"
      >
        连接
      </button>
    </div>
  )
}

function FreeModelSection({ items }) {
  if (!Array.isArray(items) || items.length === 0) return null

  return (
    <ProviderSection
      title="平台免费模型"
      description="这些模型可以直接进入聊天模型下拉，但不会污染 Provider 模板主列表。"
    >
      <div className="grid gap-3 md:grid-cols-2">
        {items.map((provider) => (
          <div key={`free-${provider.providerId}`} className="rounded-[20px] border border-[#dbe6fb] bg-white px-4 py-4 shadow-[0_12px_28px_rgba(15,23,42,0.05)]">
            <div className="text-[14px] font-semibold text-[#24324a]">{provider.name}</div>
            <div className="mt-3 flex flex-wrap gap-2">
              {(provider.models || []).map((model) => (
                <span key={`${provider.providerId}-${model.id}`} className="rounded-full bg-[#eef4ff] px-2.5 py-1 text-[11px] text-[#3566df]">
                  {model.name || model.id}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </ProviderSection>
  )
}

function ProviderPickerDialog({ query, setQuery, items, onClose, onPick }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(15,23,42,0.22)] p-4 backdrop-blur-sm">
      <div className="flex h-[min(760px,calc(100vh-32px))] w-[min(960px,calc(100vw-32px))] flex-col overflow-hidden rounded-[28px] bg-white shadow-[0_28px_80px_rgba(15,23,42,0.22)]">
        <div className="flex items-center justify-between gap-3 border-b border-[#edf2fc] px-7 py-5">
          <div>
            <div className="text-[18px] font-semibold text-[#18233b]">连接提供商</div>
            <div className="mt-1 text-[12px] text-[#70809c]">系统完整模板保留在这里，主页面只展示高频入口。</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-10 w-10 place-items-center rounded-full bg-[#f4f7ff] text-[#7c8aa5] transition-colors hover:bg-[#ebf1ff]"
            aria-label="关闭 Provider 选择器"
          >
            ×
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-7 py-6">
          <div className="grid gap-4">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索 Provider"
              className={inputClassName}
            />

            <div className="rounded-[24px] border border-[#dbe6fb] bg-white shadow-[0_16px_36px_rgba(15,23,42,0.05)]">
              {items.map((item, index) => (
                <TemplateProviderRow
                  key={`picker:${item.providerId}:${index}`}
                  item={item}
                  isLast={index === items.length - 1}
                  onConnect={() => onPick(item)}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function ProviderFormDialog({
  title,
  pending,
  isPlatformSharedTemplate,
  providerId,
  setProviderId,
  providerName,
  setProviderName,
  providerApi,
  setProviderApi,
  providerNpm,
  setProviderNpm,
  baseURL,
  setBaseURL,
  apiKey,
  setApiKey,
  apiKeyMasked,
  defaultModel,
  setDefaultModel,
  models,
  setModels,
  impactPreview,
  onClose,
  onSubmit,
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(15,23,42,0.22)] p-4 backdrop-blur-sm">
      <div className="flex h-[min(840px,calc(100vh-32px))] w-[min(980px,calc(100vw-32px))] flex-col overflow-hidden rounded-[28px] bg-white shadow-[0_28px_80px_rgba(15,23,42,0.22)]">
        <div className="flex items-center justify-between gap-3 border-b border-[#edf2fc] px-7 py-5">
          <div>
            <div className="text-[18px] font-semibold text-[#18233b]">{title}</div>
            <div className="mt-1 text-[12px] text-[#70809c]">配置一个可真实调用的 Provider，表单尽量保持简洁清晰。</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-10 w-10 place-items-center rounded-full bg-[#f4f7ff] text-[#7c8aa5] transition-colors hover:bg-[#ebf1ff]"
            aria-label="关闭 Provider 表单"
          >
            ×
          </button>
        </div>

        <form onSubmit={onSubmit} className="min-h-0 flex-1 overflow-y-auto px-7 py-6">
          <div className="grid gap-4">
            {isPlatformSharedTemplate ? (
              <div className="rounded-[14px] border border-[#dbe6fb] bg-[#f8fbff] px-4 py-3 text-[12px] leading-6 text-[#61718d]">
                当前载入的是平台共享配置。如果你要保存成自己的私有 Provider，请先修改 <code>Provider ID</code>。
              </div>
            ) : null}

            <Field label="Provider ID">
              <input value={providerId} onChange={(event) => setProviderId(event.target.value)} placeholder="myprovider" className={inputClassName} />
            </Field>

            <Field label="显示名称">
              <input value={providerName} onChange={(event) => setProviderName(event.target.value)} placeholder="我的 AI Provider" className={inputClassName} />
            </Field>

            <Field label="Provider 适配器">
              <input value={providerApi} onChange={(event) => setProviderApi(event.target.value)} placeholder="@ai-sdk/openai-compatible" className={inputClassName} />
            </Field>

            <Field label="自定义 NPM 包（可选）">
              <input value={providerNpm} onChange={(event) => setProviderNpm(event.target.value)} placeholder="留空则使用上方适配器" className={inputClassName} />
            </Field>

            <Field label="基础 URL">
              <input value={baseURL} onChange={(event) => setBaseURL(event.target.value)} placeholder="https://api.myprovider.com/v1" className={inputClassName} />
            </Field>

            <Field label="API 密钥">
              <input value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={apiKeyMasked || '留空则保留已有密钥'} className={inputClassName} />
            </Field>

            <Field label="默认模型">
              <input value={defaultModel} onChange={(event) => setDefaultModel(event.target.value)} placeholder="provider/model-id" className={inputClassName} />
            </Field>

            {impactPreview ? (
              <div className="rounded-[14px] border border-brand/15 bg-brand/5 px-4 py-3 text-[12px] text-[var(--text-dim)]">
                {impactPreview.summary}；预计影响 {impactPreview.affectedSessionCount} 个活跃会话。
              </div>
            ) : null}

            <div className="grid gap-3 rounded-[22px] border border-[#e3ebfa] bg-[#f8fbff] p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="text-[14px] font-semibold text-[#24324a]">模型</div>
                <button type="button" onClick={() => setModels((current) => [...current, createEmptyModel()])} className={secondaryButtonClassName}>
                  添加模型
                </button>
              </div>

              {models.map((model, index) => (
                <div key={`provider-model-${index}`} className="grid gap-2 rounded-[18px] border border-[#dbe6fb] bg-white p-3 md:grid-cols-[1.2fr_1.2fr_1fr_auto]">
                  <input
                    value={model.id}
                    onChange={(event) => setModels((current) => current.map((item, currentIndex) => (currentIndex === index ? { ...item, id: event.target.value } : item)))}
                    placeholder="model-id"
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
                    placeholder="上游模型 ID"
                    className={inputClassName}
                  />
                  <button
                    type="button"
                    onClick={() => setModels((current) => current.filter((_, currentIndex) => currentIndex !== index))}
                    className="rounded-[12px] border border-[#f0d7d7] bg-[#fff7f7] px-4 py-2 text-sm font-semibold text-[#c45858] transition-colors hover:bg-[#fff0f0] disabled:cursor-not-allowed disabled:opacity-45"
                    disabled={models.length === 1}
                  >
                    删除
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-6 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-[12px] border border-[#dbe6fb] bg-white px-4 py-2.5 text-sm font-semibold text-[#61718d] transition-colors hover:bg-[#f5f8ff]"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={pending}
              className="rounded-[12px] bg-[#3566df] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#2f5fd7] disabled:cursor-not-allowed disabled:opacity-45"
            >
              {pending ? '保存中...' : '保存 Provider'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
