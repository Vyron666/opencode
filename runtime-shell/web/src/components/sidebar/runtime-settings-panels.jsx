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
  const { canUpdateModel, isSharedSession } = useViewerContext()
  const [selected, setSelected] = useState('')

  useEffect(() => {
    setSelected(capabilities.modelId || capabilities.models?.[0]?.id || '')
  }, [capabilities.modelId, capabilities.models, currentSessionId])

  if (!currentSessionId) return null

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        if (!selected) return
        void updateModel(selected)
      }}
      className="grid gap-2.5 pb-3 border-b border-[var(--line)]"
    >
      <Field label={'\u6a21\u578b'}>
        <Select
          value={selected}
          onChange={setSelected}
          options={capabilities.models}
          emptyLabel={'\u5f53\u524d\u4f1a\u8bdd\u6ca1\u6709\u53ef\u9009\u6a21\u578b'}
        />
      </Field>
      {isSharedSession ? (
        <div className="text-[11px] text-[var(--text-muted)]">
          {'\u5171\u4eab\u5de5\u4f5c\u533a\u4e0b\u7684\u4f1a\u8bdd\u4e0d\u5141\u8bb8\u5207\u6362\u6a21\u578b\u3002'}
        </div>
      ) : null}
      <button
        type="submit"
        disabled={!selected || !currentSessionId || Boolean(pendingSettingsAction) || !canUpdateModel}
        className={secondaryButtonClassName}
      >
        {pendingSettingsAction === 'model' ? '\u5207\u6362\u4e2d...' : '\u5207\u6362\u6a21\u578b'}
      </button>
    </form>
  )
}

export function ConfigSettingPanel() {
  const updateConfig = useStore((state) => state.updateConfig)
  const currentSessionId = useStore((state) => state.currentSessionId)
  const pendingSettingsAction = useStore((state) => state.pendingSettingsAction)
  const capabilities = useSessionCapabilities()
  const { canUpdateConfig, isSharedSession } = useViewerContext()
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

  useEffect(() => {
    const fallbackId = userConfigOptions[0]?.id || ''
    setConfigId(userConfigOptions.some((item) => item.id === configId) ? configId : fallbackId)
  }, [configId, userConfigOptions])

  useEffect(() => {
    setValue(stringifyConfigValue(selectedConfig?.currentValue))
  }, [selectedConfig?.id, selectedConfig?.currentValue])

  if (!currentSessionId) return null

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        if (!configId) return
        void updateConfig(configId, value)
      }}
      className="grid gap-2.5 pb-3 border-b border-[var(--line)]"
    >
      <Field label={'\u914d\u7f6e\u9879'}>
        <Select
          value={configId}
          onChange={setConfigId}
          options={userConfigOptions}
          emptyLabel={'\u5f53\u524d\u4f1a\u8bdd\u6ca1\u6709\u53ef\u914d\u7f6e\u9879'}
        />
      </Field>
      <Field label={'\u914d\u7f6e\u503c'}>
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
          <input
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={'\u4f8b\u5982 high / true / code'}
            className={inputClassName}
          />
        )}
      </Field>
      {selectedConfig?.description ? <div className="text-[11px] text-[var(--text-muted)] -mt-1">{selectedConfig.description}</div> : null}
      {isSharedSession ? (
        <div className="text-[11px] text-[var(--text-muted)]">
          {'\u5171\u4eab\u5de5\u4f5c\u533a\u4e0b\u7684\u4f1a\u8bdd\u4e0d\u5141\u8bb8\u4fee\u6539\u8fd0\u884c\u65f6\u914d\u7f6e\u3002'}
        </div>
      ) : null}
      <button
        type="submit"
        disabled={!configId || !currentSessionId || Boolean(pendingSettingsAction) || !canUpdateConfig}
        className={secondaryButtonClassName}
      >
        {pendingSettingsAction === 'config' ? '\u66f4\u65b0\u4e2d...' : '\u66f4\u65b0\u914d\u7f6e'}
      </button>
    </form>
  )
}
