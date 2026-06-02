import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../../store'
import {
  Field,
  inputClassName,
  Select,
  secondaryButtonClassName,
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
  const selected = capabilities.modelId || capabilities.models?.[0]?.id || ''

  if (!currentSessionId) return null

  return (
    <div className="grid gap-2.5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-semibold text-[var(--text-dim)]">模型</span>
        {pendingSettingsAction === 'model' ? <span className="text-[11px] text-[var(--text-muted)]">切换中...</span> : null}
      </div>
      <Field label="当前模型">
        <Select
          value={selected}
          onChange={(nextModel) => {
            if (!nextModel || nextModel === selected || !canUpdateModel || pendingSettingsAction) return
            void updateModel(nextModel)
          }}
          options={capabilities.models}
          emptyLabel="当前会话没有可选模型"
          disabled={!canUpdateModel || Boolean(pendingSettingsAction)}
        />
      </Field>
      {isSharedSession ? (
        <div className="text-[11px] text-[var(--text-muted)]">
          共享工作区下的会话不允许切换模型。
        </div>
      ) : null}
    </div>
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
  const [draftValue, setDraftValue] = useState('')
  const selectedConfig = useMemo(
    () => userConfigOptions.find((item) => item.id === configId),
    [configId, userConfigOptions],
  )

  useEffect(() => {
    const fallbackId = userConfigOptions[0]?.id || ''
    setConfigId(userConfigOptions.some((item) => item.id === configId) ? configId : fallbackId)
  }, [configId, userConfigOptions])

  useEffect(() => {
    setDraftValue(stringifyConfigValue(selectedConfig?.currentValue))
  }, [selectedConfig?.id, selectedConfig?.currentValue])

  const currentValue = stringifyConfigValue(selectedConfig?.currentValue)

  if (!currentSessionId) return null

  return (
    <div className="grid gap-2.5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-semibold text-[var(--text-dim)]">运行时配置</span>
        {pendingSettingsAction === 'config' ? <span className="text-[11px] text-[var(--text-muted)]">更新中...</span> : null}
      </div>

      <Field label="配置项">
        <Select
          value={configId}
          onChange={setConfigId}
          options={userConfigOptions}
          emptyLabel="当前会话没有可配置项"
          disabled={!canUpdateConfig || Boolean(pendingSettingsAction)}
        />
      </Field>

      {selectedConfig ? (
        <div className="grid gap-2">
          <span className="text-xs font-medium text-[var(--text-dim)]">配置值</span>
          {selectedConfig.type === 'boolean' ? (
            <div className="flex items-center gap-2">
              {[
                { id: 'true', label: '开启' },
                { id: 'false', label: '关闭' },
              ].map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => {
                    if (option.id === currentValue || !canUpdateConfig || pendingSettingsAction) return
                    void updateConfig(configId, option.id)
                  }}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                    currentValue === option.id
                      ? 'bg-brand text-[#14100d] border-brand'
                      : 'bg-black/20 text-[var(--text-dim)] border-[var(--line)] hover:bg-black/35'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          ) : selectedConfig.options?.length ? (
            <Select
              value={currentValue}
              onChange={(nextValue) => {
                if (nextValue === currentValue || !canUpdateConfig || pendingSettingsAction) return
                void updateConfig(configId, nextValue)
              }}
              options={selectedConfig.options}
              emptyLabel="请选择"
              disabled={!canUpdateConfig || Boolean(pendingSettingsAction)}
            />
          ) : (
            <div className="grid gap-2">
              <input
                value={draftValue}
                onChange={(event) => setDraftValue(event.target.value)}
                placeholder="例如 high / true / code"
                className={inputClassName}
              />
              <button
                type="button"
                onClick={() => {
                  if (!configId || !canUpdateConfig || pendingSettingsAction) return
                  void updateConfig(configId, draftValue)
                }}
                disabled={!configId || !canUpdateConfig || Boolean(pendingSettingsAction)}
                className={secondaryButtonClassName}
              >
                应用配置
              </button>
            </div>
          )}
        </div>
      ) : null}

      {selectedConfig?.description ? <div className="text-[11px] text-[var(--text-muted)] -mt-1">{selectedConfig.description}</div> : null}
      {isSharedSession ? (
        <div className="text-[11px] text-[var(--text-muted)]">
          共享工作区下的会话不允许修改运行时配置。
        </div>
      ) : null}
    </div>
  )
}
