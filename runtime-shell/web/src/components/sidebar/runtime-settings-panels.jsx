import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../../store'
import {
  Field,
  inputClassName,
  secondaryButtonClassName,
  Select,
  selectClassName,
  stringifyConfigValue,
  useSessionCapabilities,
  useViewerContext,
} from './sidebar-support'

export function ModelSettingPanel() {
  const updateModel = useStore((state) => state.updateModel)
  const currentSessionId = useStore((state) => state.currentSessionId)
  const pendingSettingsAction = useStore((state) => state.pendingSettingsAction)
  const capabilities = useSessionCapabilities()
  const { canManageRuntimeSettings, isSharedSession } = useViewerContext()
  const [selected, setSelected] = useState('')

  if (!currentSessionId) return null

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
        <Select value={selected} onChange={setSelected} options={capabilities.models} emptyLabel="当前会话没有可选模型" />
      </Field>
      {isSharedSession ? <div className="text-[11px] text-[var(--text-muted)]">共享工作区下的会话不允许切换模型。</div> : null}
      <button
        type="submit"
        disabled={!selected || !currentSessionId || Boolean(pendingSettingsAction) || !canManageRuntimeSettings}
        className={secondaryButtonClassName}
      >
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
  const { canManageRuntimeSettings, isSharedSession } = useViewerContext()
  const configOptions = capabilities.configOptions || []
  const userConfigOptions = useMemo(
    () => configOptions.filter((item) => item.id !== 'mode' && item.id !== 'model'),
    [configOptions],
  )
  const [configId, setConfigId] = useState('')
  const [value, setValue] = useState('')
  const selectedConfig = useMemo(
    () => userConfigOptions.find((item) => item.id === configId),
    [configId, userConfigOptions],
  )

  if (!currentSessionId) return null

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
      {selectedConfig?.description ? <div className="text-[11px] text-[var(--text-muted)] -mt-1">{selectedConfig.description}</div> : null}
      {isSharedSession ? <div className="text-[11px] text-[var(--text-muted)]">共享工作区下的会话不允许修改运行时配置。</div> : null}
      <button
        type="submit"
        disabled={!configId || !currentSessionId || Boolean(pendingSettingsAction) || !canManageRuntimeSettings}
        className={secondaryButtonClassName}
      >
        {pendingSettingsAction === 'config' ? '更新中...' : '更新配置'}
      </button>
    </form>
  )
}
