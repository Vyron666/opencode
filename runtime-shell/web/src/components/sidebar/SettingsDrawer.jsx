import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { api } from '../../api'
import { ConfigHistoryPanel, McpConfigPanel, ProviderConfigPanel, SkillConfigPanel, WorkerOverviewPanel } from './admin-settings-panels'
import { CreateSessionPanel, CreateWorkspacePanel, ForkSessionPanel } from './create-panels'
import { ModelSettingPanel, ConfigSettingPanel } from './runtime-settings-panels'
import { WorkspaceSharePanel } from './workspace-share-panel'
import { useViewerContext } from './sidebar-support'

const SECTION_TABS = [
  { id: 'overview', label: '概览' },
  { id: 'provider', label: 'Provider' },
  { id: 'skill', label: 'Skill' },
  { id: 'mcp', label: 'MCP' },
  { id: 'workspace', label: '工作区' },
  { id: 'runtime', label: '运行时' },
  { id: 'system', label: '系统' },
]

export default function SettingsDrawer({ open, activeSection = 'overview', onClose }) {
  const { canManageProviderSettings } = useViewerContext()
  const [focusedSection, setFocusedSection] = useState(activeSection || 'overview')
  const [summary, setSummary] = useState({
    providerCount: 0,
    skillCount: 0,
    mcpCount: 0,
  })

  useEffect(() => {
    if (!open) return
    setFocusedSection(activeSection || 'overview')
  }, [activeSection, open])

  useEffect(() => {
    if (!open || !canManageProviderSettings) return
    let cancelled = false

    void Promise.all([
      api.providerConfig.get().catch(() => ({ items: [] })),
      api.skillConfig.get().catch(() => ({ items: [] })),
      api.mcpConfig.get().catch(() => ({ items: [] })),
    ]).then(([providerData, skillData, mcpData]) => {
      if (cancelled) return
      setSummary({
        providerCount: Array.isArray(providerData.items) ? providerData.items.length : 0,
        skillCount: Array.isArray(skillData.items) ? skillData.items.length : 0,
        mcpCount: Array.isArray(mcpData.items) ? mcpData.items.length : 0,
      })
    })

    return () => {
      cancelled = true
    }
  }, [canManageProviderSettings, open])

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          className="fixed inset-0 z-40 flex items-center justify-center bg-[rgba(15,23,42,0.22)] p-4 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.aside
            initial={{ y: 16, opacity: 0, scale: 0.985 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 16, opacity: 0, scale: 0.985 }}
            transition={{ type: 'spring', stiffness: 320, damping: 30 }}
            className="flex h-[min(920px,calc(100vh-32px))] w-[min(980px,calc(100vw-32px))] flex-col overflow-hidden rounded-[32px] bg-white shadow-[0_32px_90px_rgba(15,23,42,0.20)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="shrink-0 border-b border-[#ebf1fe] px-7 pb-5 pt-6">
              <div className="flex items-start justify-between gap-4">
                <div className="grid gap-1">
                  <div className="text-[30px] font-bold tracking-[-0.02em] text-[#18233b]">设置</div>
                  <div className="text-[13px] text-[#70809c]">统一管理 Provider、Skill、MCP 和运行时配置。</div>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="关闭设置"
                  className="grid h-11 w-11 place-items-center rounded-[14px] bg-[#f3f6ff] text-[#6f7f99] transition-colors hover:bg-[#e9efff]"
                >
                  ×
                </button>
              </div>

              <div className="mt-5 flex flex-wrap gap-2">
                {SECTION_TABS.map((section) => (
                  <button
                    key={section.id}
                    type="button"
                    onClick={() => setFocusedSection(section.id)}
                    className={`rounded-full px-4 py-2 text-[13px] font-semibold transition-colors ${
                      focusedSection === section.id
                        ? 'bg-[#3566df] text-white shadow-[0_12px_24px_rgba(53,102,223,0.18)]'
                        : 'bg-[#f4f7ff] text-[#61718d] hover:bg-[#edf2ff]'
                    }`}
                  >
                    {section.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-7 pb-7 pt-6">
              {focusedSection === 'overview' ? (
                <OverviewGrid summary={summary} onSelect={setFocusedSection} />
              ) : null}

              {focusedSection === 'provider' ? (
                <PanelShell title="Provider 配置" description="系统模板只用于设置页配置；聊天模型下拉只显示真实可用配置和平台免费模型。">
                  <ProviderConfigPanel />
                </PanelShell>
              ) : null}

              {focusedSection === 'skill' ? (
                <PanelShell title="Skill 配置" description="管理 Skill 包、路径和远程地址。">
                  <SkillConfigPanel />
                </PanelShell>
              ) : null}

              {focusedSection === 'mcp' ? (
                <PanelShell title="MCP 配置" description="查看平台共享 MCP，并维护自己的私有 MCP。">
                  <McpConfigPanel />
                </PanelShell>
              ) : null}

              {focusedSection === 'workspace' ? (
                <PanelShell title="工作区与会话" description="创建工作区、创建会话、分支会话和管理共享关系。">
                  <CreateWorkspacePanel />
                  <CreateSessionPanel />
                  <ForkSessionPanel />
                  <WorkspaceSharePanel />
                </PanelShell>
              ) : null}

              {focusedSection === 'runtime' ? (
                <PanelShell title="运行时设置" description="切换当前会话的模型、模式和运行时选项。">
                  <ModelSettingPanel />
                  <ConfigSettingPanel />
                </PanelShell>
              ) : null}

              {focusedSection === 'system' ? (
                <PanelShell title="系统概览" description="查看 Worker 状态和配置变更历史。">
                  <WorkerOverviewPanel />
                  <ConfigHistoryPanel />
                </PanelShell>
              ) : null}
            </div>
          </motion.aside>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

function OverviewGrid({ summary, onSelect }) {
  const cards = [
    {
      id: 'provider',
      title: 'Provider',
      description: '模板与真实配置严格分离',
      value: `${summary.providerCount} 项`,
    },
    {
      id: 'skill',
      title: 'Skill',
      description: '统一查看平台共享与私有技能',
      value: `${summary.skillCount} 项`,
    },
    {
      id: 'mcp',
      title: 'MCP',
      description: '共享配置和私有配置同面板管理',
      value: `${summary.mcpCount} 项`,
    },
    {
      id: 'workspace',
      title: '工作区',
      description: '创建工作区、会话和共享关系',
      value: '进入管理',
    },
    {
      id: 'runtime',
      title: '运行时',
      description: '切换模型、模式和会话选项',
      value: '进入管理',
    },
    {
      id: 'system',
      title: '系统',
      description: '查看 Worker 和配置历史',
      value: '进入管理',
    },
  ]

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {cards.map((card) => (
        <button
          key={card.id}
          type="button"
          onClick={() => onSelect(card.id)}
          className="grid gap-2 rounded-[24px] border border-[#dbe6fb] bg-[#f7faff] px-5 py-5 text-left transition-colors hover:bg-[#f1f6ff]"
        >
          <div className="text-[17px] font-semibold text-[#18233b]">{card.title}</div>
          <div className="text-[13px] leading-6 text-[#70809c]">{card.description}</div>
          <div className="text-[13px] font-semibold text-[#3566df]">{card.value}</div>
        </button>
      ))}
    </div>
  )
}

function PanelShell({ title, description, children }) {
  return (
    <section className="grid gap-4 rounded-[26px] bg-[#f4f7ff] px-5 py-5">
      <div className="grid gap-1">
        <div className="text-[22px] font-semibold text-[#18233b]">{title}</div>
        <div className="text-[13px] leading-6 text-[#70809c]">{description}</div>
      </div>
      <div className="grid gap-4">{children}</div>
    </section>
  )
}
