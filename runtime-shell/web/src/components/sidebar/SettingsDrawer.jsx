import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ConfigHistoryPanel, McpConfigPanel, ProviderConfigPanel, SkillConfigPanel, WorkerOverviewPanel } from './admin-settings-panels'
import { CreateSessionPanel, CreateWorkspacePanel, ForkSessionPanel } from './create-panels'
import { ModelSettingPanel, ConfigSettingPanel } from './runtime-settings-panels'
import { WorkspaceSharePanel } from './workspace-share-panel'

function SettingsSection({ title, description, defaultOpen = false, children, contentClassName = '' }) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <section className="overflow-hidden rounded-[20px] border border-[var(--line)] bg-[var(--surface-muted)]">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-start justify-between gap-3 px-4 py-4 text-left transition-colors hover:bg-white"
      >
        <div className="min-w-0 max-w-[calc(100%-56px)]">
          <div className="text-[15px] font-semibold leading-tight text-[var(--text)]">{title}</div>
          {description ? <div className="mt-1.5 text-[11px] leading-relaxed text-[var(--text-muted)]">{description}</div> : null}
        </div>
        <span className="shrink-0 pt-1 text-[11px] font-semibold text-[var(--text-muted)]">{open ? '收起' : '展开'}</span>
      </button>

      {open ? <div className={`grid gap-3 px-4 pb-4 pt-1.5 animate-fade-in ${contentClassName}`.trim()}>{children}</div> : null}
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
          className="fixed inset-0 z-40 bg-[rgba(15,23,42,0.28)] backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.aside
            initial={{ x: 28, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 28, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 30 }}
            className="absolute bottom-3 right-3 top-3 flex w-[min(460px,calc(100vw-24px))] flex-col overflow-hidden rounded-[28px] border border-[var(--line)] bg-white shadow-[0_28px_80px_rgba(15,23,42,0.20)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--line)] bg-[linear-gradient(180deg,#ffffff,#f8fbff)] px-5 py-4">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-brand">Settings</div>
                <h2 className="mt-1 text-[18px] font-bold text-[var(--text)]">运行设置</h2>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="关闭设置"
                className="h-9 w-9 rounded-full border border-[var(--line)] bg-[var(--surface-muted)] text-[var(--text-dim)] transition-colors hover:bg-[var(--bg-strong)]"
              >
                x
              </button>
            </div>

            <div
              className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-4 py-4 pb-6 pr-3"
              style={{ scrollbarGutter: 'stable both-edges' }}
            >
              <div className="flex flex-col gap-3">
                <SettingsSection title="新建与工作区" description="先创建工作区，再新建会话或继续协作。" defaultOpen>
                  <CreateWorkspacePanel />
                  <CreateSessionPanel />
                  <ForkSessionPanel />
                  <WorkspaceSharePanel />
                </SettingsSection>

                <SettingsSection title="快捷设置" description="高频项目保持直达，改完立即生效。" defaultOpen>
                  <ModelSettingPanel />
                  <ConfigSettingPanel />
                </SettingsSection>

                <SettingsSection title="AI 服务" description="首次配置或切换 Provider 时再展开。">
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
            </div>
          </motion.aside>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
