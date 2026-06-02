import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ConfigHistoryPanel, McpConfigPanel, ProviderConfigPanel, SkillConfigPanel, WorkerOverviewPanel } from './admin-settings-panels'
import { ModelSettingPanel, ConfigSettingPanel } from './runtime-settings-panels'

function SettingsSection({ title, description, defaultOpen = false, children, contentClassName = '' }) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <section className="rounded-[18px] border border-[var(--line)] bg-black/15 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="w-full px-4 py-3 flex items-center justify-between gap-3 text-left hover:bg-white/[0.02] transition-colors"
      >
        <div className="min-w-0">
          <div className="text-sm font-semibold">{title}</div>
          {description ? <div className="text-[11px] text-[var(--text-muted)] mt-1">{description}</div> : null}
        </div>
        <span className="text-xs text-[var(--text-muted)] shrink-0">{open ? '收起' : '展开'}</span>
      </button>

      {open ? <div className={`px-4 pb-4 pt-1 grid gap-3 animate-fade-in ${contentClassName}`.trim()}>{children}</div> : null}
    </section>
  )
}

export default function SettingsDrawer({ open, onClose }) {
  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          className="fixed inset-0 z-40 bg-black/55 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.aside
            initial={{ x: 28, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 28, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 30 }}
            className="absolute right-3 top-3 bottom-3 w-[min(460px,calc(100vw-24px))] rounded-[24px] border border-[var(--line)] bg-[var(--surface)] shadow-2xl overflow-hidden flex flex-col"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-[var(--line)] bg-black/15 shrink-0">
              <div>
                <div className="text-[10px] font-semibold tracking-[0.14em] uppercase text-brand">Settings</div>
                <h2 className="text-base font-bold mt-1">运行设置</h2>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="关闭设置"
                className="w-9 h-9 rounded-full border border-[var(--line)] bg-black/20 text-[var(--text-dim)] hover:bg-black/35 transition-colors"
              >
                ×
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 pb-8 grid content-start gap-3">
              <SettingsSection title="快捷设置" description="高频项保持直达，改完立即生效。" defaultOpen>
                <ModelSettingPanel />
                <ConfigSettingPanel />
              </SettingsSection>

              <SettingsSection title="AI 服务" description="首次配置或更换 Provider 时再展开。">
                <ProviderConfigPanel />
              </SettingsSection>

              <SettingsSection title="MCP" description="MCP 连接管理单独维护，便于排查和切换。">
                <McpConfigPanel />
              </SettingsSection>

              <SettingsSection title="Skill" description="Skill 包、路径和 URL 配置分开管理。">
                <SkillConfigPanel />
              </SettingsSection>

              <SettingsSection title="系统概览" description="仅在需要排查或审计时查看。">
                <WorkerOverviewPanel />
                <ConfigHistoryPanel />
              </SettingsSection>
            </div>
          </motion.aside>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
