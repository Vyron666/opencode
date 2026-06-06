import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { api } from '../../api'
import { ConfigHistoryPanel, McpConfigPanel, ProviderConfigPanel, SkillConfigPanel, WorkerOverviewPanel } from './admin-settings-panels'
import { CreateSessionPanel, CreateWorkspacePanel, ForkSessionPanel } from './create-panels'
import { ModelSettingPanel, ConfigSettingPanel } from './runtime-settings-panels'
import { WorkspaceSharePanel } from './workspace-share-panel'
import { useViewerContext } from './sidebar-support'

function DetailSection({ title, description, onBack, children }) {
  return (
    <section className="rounded-[22px] bg-[#f4f7ff] px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[18px] font-semibold text-[#18233b]">{title}</div>
          {description ? <div className="mt-1 text-[12px] leading-6 text-[#70809c]">{description}</div> : null}
        </div>
        <button
          type="button"
          onClick={onBack}
          className="rounded-[10px] bg-white px-3 py-2 text-[12px] font-semibold text-[#61718d] transition-colors hover:bg-[#edf2ff]"
        >
          返回总览
        </button>
      </div>
      <div className="mt-4 grid gap-3">{children}</div>
    </section>
  )
}

function OverviewCard({ title, actionLabel, onAction, children }) {
  return (
    <section className="rounded-[22px] bg-[#f4f7ff] px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="text-[16px] font-semibold text-[#18233b]">{title}</div>
        <button
          type="button"
          onClick={onAction}
          className="rounded-[10px] bg-white px-3 py-1.5 text-[12px] font-medium text-[#3566df] transition-colors hover:bg-[#edf2ff]"
        >
          {actionLabel}
        </button>
      </div>
      <div className="mt-3 grid gap-2.5 rounded-[18px] p-1">{children}</div>
    </section>
  )
}

function SummaryRow({ leadingColor = '#3566df', title, description, strong = false, trailing }) {
  return (
    <div
      className={`flex items-center justify-between gap-3 rounded-[13px] border px-3 py-3 ${
        strong ? 'border-[#7aa1ff] bg-white shadow-[inset_0_0_0_1px_rgba(94,143,255,0.22)]' : 'border-[#d9e4fb] bg-white'
      }`}
    >
      <div className="flex min-w-0 items-center gap-3">
        <span className="inline-block h-5 w-5 shrink-0 rounded-[6px]" style={{ background: leadingColor }} />
        <div className="min-w-0">
          <div className="truncate text-[14px] font-semibold text-[#24324a]">{title}</div>
          {description ? <div className="mt-1 truncate text-[12px] text-[#7c8aa5]">{description}</div> : null}
        </div>
      </div>
      {trailing ? <div className="shrink-0 text-[12px] text-[#7c8aa5]">{trailing}</div> : null}
    </div>
  )
}

function ToggleRow({ title, enabled }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-[13px] border border-[#d9e4fb] bg-white px-3 py-3">
      <div className={`truncate text-[14px] ${enabled ? 'font-semibold text-[#24324a]' : 'text-[#8ea0bb]'}`}>{title}</div>
      <span className={`relative h-7 w-11 rounded-full transition-colors ${enabled ? 'bg-[#12a06f]' : 'bg-[#c8d3e5]'}`}>
        <span className={`absolute top-1 h-5 w-5 rounded-full bg-white transition-transform ${enabled ? 'left-[22px]' : 'left-1'}`} />
      </span>
    </div>
  )
}

function StatusRow({ title, enabled }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-[13px] border border-[#d9e4fb] bg-white px-3 py-3">
      <div className="inline-flex min-w-0 items-center gap-2">
        <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${enabled ? 'bg-[#12a06f]' : 'bg-[#cad5e5]'}`} />
        <span className="truncate text-[14px] font-semibold text-[#24324a]">{title}</span>
      </div>
      <span className={`text-[12px] ${enabled ? 'text-[#12a06f]' : 'text-[#8ea0bb]'}`}>{enabled ? '已连接' : '未启用'}</span>
    </div>
  )
}

export default function SettingsDrawer({ open, activeSection = 'overview', onClose }) {
  const { canManageProviderSettings } = useViewerContext()
  const [focusedSection, setFocusedSection] = useState(activeSection || 'overview')
  const [summary, setSummary] = useState(createEmptySummary())

  useEffect(() => {
    if (!open) return
    setFocusedSection(activeSection || 'overview')
  }, [activeSection, open])

  useEffect(() => {
    if (!open || !canManageProviderSettings) return
    let cancelled = false

    // 中文/English: fetch lightweight summary data so the drawer keeps a single
    // clear overview page instead of stacking a second settings version below it.
    void Promise.all([
      api.providerConfig.get().catch(() => ({ items: [] })),
      api.skillConfig.get().catch(() => ({ items: [], paths: [], urls: [] })),
      api.skillPackage.list().catch(() => ({ items: [] })),
      api.mcpConfig.get().catch(() => ({ items: [] })),
    ]).then(([providerData, skillConfigData, skillPackageData, mcpData]) => {
      if (cancelled) return
      setSummary({
        providers: normalizeProviderSummary(providerData.items),
        skills: normalizeSkillSummary(skillConfigData.items, skillPackageData.items),
        mcpServers: normalizeMcpSummary(mcpData.items),
      })
    })

    return () => {
      cancelled = true
    }
  }, [canManageProviderSettings, open])

  const extraSections = useMemo(
    () => [
      { id: 'workspace', label: '工作区与会话' },
      { id: 'runtime', label: '运行时' },
      { id: 'system', label: '系统概览' },
    ],
    [],
  )

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          className="fixed inset-0 z-40 bg-[rgba(15,23,42,0.22)] backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.aside
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 20, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 30 }}
            className="absolute left-1/2 top-4 flex h-[min(860px,calc(100vh-32px))] w-[min(460px,calc(100vw-32px))] -translate-x-1/2 flex-col overflow-hidden rounded-[30px] bg-white shadow-[0_28px_80px_rgba(15,23,42,0.18)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex shrink-0 items-start justify-between gap-3 px-6 pb-4 pt-6">
              <div>
                <div className="text-[28px] font-bold tracking-[-0.02em] text-[#18233b]">⚙ 设置</div>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="关闭设置"
                className="grid h-10 w-10 place-items-center rounded-[12px] bg-[#f3f6ff] text-[#6f7f99] transition-colors hover:bg-[#e9efff]"
              >
                ×
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-6 pb-6" style={{ scrollbarGutter: 'stable both-edges' }}>
              {focusedSection === 'overview' ? (
                <div className="grid gap-4">
                  <OverviewCard title="🔌 Provider" actionLabel="+ 配置 Provider" onAction={() => setFocusedSection('provider')}>
                    {summary.providers.length > 0 ? (
                      summary.providers.slice(0, 3).map((provider, index) => (
                        <SummaryRow
                          key={`${provider.providerId}-${index}`}
                          leadingColor={provider.color}
                          title={provider.name}
                          description={provider.description}
                          trailing={provider.meta}
                          strong={index === 0}
                        />
                      ))
                    ) : (
                      <SummaryRow leadingColor="#cad5e5" title="还没有 Provider" description="去配置模型与鉴权信息" />
                    )}
                  </OverviewCard>

                  <OverviewCard title="🧩 Skills" actionLabel="+ 上传新 Skill 包" onAction={() => setFocusedSection('skill')}>
                    {summary.skills.length > 0 ? (
                      summary.skills.slice(0, 4).map((skill) => <ToggleRow key={skill.id} title={skill.name} enabled={skill.enabled} />)
                    ) : (
                      <ToggleRow title="暂无 Skill 包" enabled={false} />
                    )}
                  </OverviewCard>

                  <OverviewCard title="🔗 MCP 服务器" actionLabel="+ 添加 MCP 服务器" onAction={() => setFocusedSection('mcp')}>
                    {summary.mcpServers.length > 0 ? (
                      summary.mcpServers.slice(0, 4).map((server) => <StatusRow key={server.name} title={server.name} enabled={server.enabled} />)
                    ) : (
                      <StatusRow title="暂无 MCP 服务" enabled={false} />
                    )}
                  </OverviewCard>

                  <section className="rounded-[22px] bg-[#f4f7ff] px-4 py-4">
                    <div className="text-[16px] font-semibold text-[#18233b]">更多设置</div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {extraSections.map((section) => (
                        <button
                          key={section.id}
                          type="button"
                          onClick={() => setFocusedSection(section.id)}
                          className="rounded-[12px] bg-white px-3.5 py-2 text-[13px] font-medium text-[#61718d] transition-colors hover:bg-[#edf2ff]"
                        >
                          {section.label}
                        </button>
                      ))}
                    </div>
                  </section>
                </div>
              ) : null}

              {focusedSection === 'provider' ? (
                <DetailSection title="Provider 配置" description="管理模型列表、API Key 与默认模型。" onBack={() => setFocusedSection('overview')}>
                  <ProviderConfigPanel />
                </DetailSection>
              ) : null}

              {focusedSection === 'skill' ? (
                <DetailSection title="Skill 配置" description="管理 Skill 包、路径与远程地址。" onBack={() => setFocusedSection('overview')}>
                  <SkillConfigPanel />
                </DetailSection>
              ) : null}

              {focusedSection === 'mcp' ? (
                <DetailSection title="MCP 配置" description="维护本地或远程 MCP 服务连接。" onBack={() => setFocusedSection('overview')}>
                  <McpConfigPanel />
                </DetailSection>
              ) : null}

              {focusedSection === 'workspace' ? (
                <DetailSection title="工作区与会话" description="创建工作区、新建会话与管理共享关系。" onBack={() => setFocusedSection('overview')}>
                  <CreateWorkspacePanel />
                  <CreateSessionPanel />
                  <ForkSessionPanel />
                  <WorkspaceSharePanel />
                </DetailSection>
              ) : null}

              {focusedSection === 'runtime' ? (
                <DetailSection title="运行时" description="切换模型、模式与当前会话参数。" onBack={() => setFocusedSection('overview')}>
                  <ModelSettingPanel />
                  <ConfigSettingPanel />
                </DetailSection>
              ) : null}

              {focusedSection === 'system' ? (
                <DetailSection title="系统概览" description="查看 Worker 状态与配置历史。" onBack={() => setFocusedSection('overview')}>
                  <WorkerOverviewPanel />
                  <ConfigHistoryPanel />
                </DetailSection>
              ) : null}
            </div>
          </motion.aside>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

function createEmptySummary() {
  return {
    providers: [],
    skills: [],
    mcpServers: [],
  }
}

function normalizeProviderSummary(items) {
  if (!Array.isArray(items)) return []
  const providers = items.filter(Boolean)
  const preferred = providers.find((item) => item.source === 'user_private') || providers[0]
  if (!preferred) return []

  const colors = ['#3566df', '#6c67e8', '#12a06f']
  return preferred.models?.length
    ? preferred.models.map((model, index) => ({
        providerId: preferred.providerId || `provider-${index}`,
        name: model.name || model.id || preferred.name || preferred.providerId || 'Provider',
        description: readProviderDescription(model, index),
        meta: index === 0 ? '推荐' : model.api || '可用',
        color: colors[index % colors.length],
      }))
    : [
        {
          providerId: preferred.providerId || 'provider',
          name: preferred.name || preferred.providerId || 'Provider',
          description: preferred.defaultModel || '已配置',
          meta: '已启用',
          color: colors[0],
        },
      ]
}

function normalizeSkillSummary(configItems, packages) {
  const configUrls = new Set((Array.isArray(configItems) ? configItems : []).filter((item) => item.type === 'url').map((item) => item.value))
  if (!Array.isArray(packages) || packages.length === 0) return []
  return packages.map((item) => ({
    id: item.id,
    name: item.displayName || item.skillName || item.id,
    enabled: !item.url || configUrls.size === 0 ? true : configUrls.has(item.url),
  }))
}

function normalizeMcpSummary(items) {
  if (!Array.isArray(items)) return []
  const preferred = items.filter((item) => item.source === 'user_private')
  const source = preferred.length ? preferred : items
  return source.map((item) => ({
    name: item.name || 'MCP',
    enabled: item.enabled !== false,
  }))
}

function readProviderDescription(model, index) {
  const label = String(model?.name || model?.id || '').toLowerCase()
  if (label.includes('flash')) return '快速响应'
  if (label.includes('kimi')) return '长上下文'
  if (label.includes('v4') || index === 0) return '高速推理'
  return '可用于对话'
}
