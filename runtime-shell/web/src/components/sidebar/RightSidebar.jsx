import { useState } from 'react'
import { CreateSessionPanel, ForkSessionPanel } from './create-panels'
import { EventStreamPanel, PlanPanel } from './event-panels'
import { MetricsPanel, PermissionPanel, QuestionPanel, SessionDetailPanel } from './inspect-panels'
import { ConfigSettingPanel, CustomModelsPanel, ModeSettingPanel, ModelSettingPanel, ProviderConfigPanel } from './settings-panels'
import { TABS } from './sidebar-support'

export default function RightSidebar() {
  const [activeTab, setActiveTab] = useState('create')
  const [collapsed, setCollapsed] = useState(false)

  if (collapsed) {
    return (
      <aside
        className="hidden xl:flex flex-col items-center gap-2 py-3 cursor-pointer opacity-60 hover:opacity-100 transition-opacity"
        onClick={() => setCollapsed(false)}
      >
        <span className="text-[10px] text-brand font-semibold tracking-wider uppercase rotate-90 origin-center whitespace-nowrap mt-8">
          展开面板
        </span>
      </aside>
    )
  }

  return (
    <aside className="sidebar-right min-h-0 h-[calc(100dvh-28px)] grid gap-2.5 content-start overflow-y-auto overflow-x-hidden max-[1100px]:hidden">
      <div className="rounded-[20px] border border-[var(--line)] bg-[var(--surface)] shadow-md backdrop-blur-2xl p-4 relative min-h-0">
        <button
          onClick={() => setCollapsed(true)}
          aria-label="收起侧边栏"
          className="absolute -left-2 top-3 hidden xl:flex items-center justify-center w-5 h-5 rounded-full bg-brand/20 text-brand-text border border-brand/30 text-[10px] hover:bg-brand/40 transition-colors"
        >
          ◀
        </button>

        <div className="flex rounded-[10px] border border-[var(--line)] overflow-hidden mb-3">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 py-2 px-1.5 text-xs font-semibold text-center transition-colors ${
                activeTab === tab.id
                  ? 'text-brand-text bg-brand/10'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-dim)] hover:bg-black/20'
              } ${tab.id !== TABS[TABS.length - 1].id ? 'border-r border-[var(--line)]' : ''}`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === 'create' && (
          <div className="grid gap-3 animate-fade-in">
            <CreateSessionPanel />
            <ForkSessionPanel />
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="grid gap-3 animate-fade-in">
            <ModeSettingPanel />
            <ModelSettingPanel />
            <ConfigSettingPanel />
            <ProviderConfigPanel />
            <CustomModelsPanel />
          </div>
        )}

        {activeTab === 'inspect' && (
          <div className="grid gap-4 animate-fade-in">
            <MetricsPanel />
            <PermissionPanel />
            <QuestionPanel />
            <SessionDetailPanel />
          </div>
        )}

        {activeTab === 'events' && (
          <div className="grid gap-4 animate-fade-in">
            <PlanPanel />
            <EventStreamPanel />
          </div>
        )}
      </div>
    </aside>
  )
}
