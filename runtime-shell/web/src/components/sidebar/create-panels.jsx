import { useEffect, useState } from 'react'
import { useStore } from '../../store'
import { Field, inputClassName } from './sidebar-support'

const DEFAULT_TITLE = 'Runtime Shell 会话'

export function CreateSessionPanel() {
  const createSession = useStore((state) => state.createSession)
  const pendingSessionAction = useStore((state) => state.pendingSessionAction)
  const workspaces = useStore((state) => state.workspaces)
  const [title, setTitle] = useState(DEFAULT_TITLE)
  const [workspaceId, setWorkspaceId] = useState('')
  const hasWorkspaces = workspaces.length > 0
  const selectedWorkspace = workspaces.find((workspace) => workspace.id === workspaceId) || null
  const canSubmit = Boolean(title.trim() && selectedWorkspace) && !pendingSessionAction

  useEffect(() => {
    if (!hasWorkspaces) {
      if (workspaceId) setWorkspaceId('')
      return
    }
    if (selectedWorkspace) return
    setWorkspaceId(workspaces[0].id)
  }, [hasWorkspaces, selectedWorkspace, workspaceId, workspaces])

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        if (!selectedWorkspace || !title.trim()) return
        void createSession(title, selectedWorkspace.projectId, selectedWorkspace.id).then(() => {
          setTitle(DEFAULT_TITLE)
        })
      }}
      className="grid gap-2.5 pb-3 border-b border-[var(--line)]"
    >
      <span className="text-[10px] font-semibold tracking-[0.14em] uppercase text-brand">Create</span>
      <Field label="会话标题">
        <input value={title} onChange={(event) => setTitle(event.target.value)} className={inputClassName} />
      </Field>
      <Field label="工作区">
        <select
          value={workspaceId}
          onChange={(event) => setWorkspaceId(event.target.value)}
          className={inputClassName}
          disabled={!hasWorkspaces}
        >
          <option value="" disabled>
            {hasWorkspaces ? '请选择工作区' : '暂无可用工作区'}
          </option>
          {workspaces.map((workspace) => (
            <option key={workspace.id} value={workspace.id}>
              {workspace.name} ({workspace.projectId})
            </option>
          ))}
        </select>
      </Field>
      <Field label="项目 ID">
        <input
          value={selectedWorkspace?.projectId || ''}
          className={inputClassName}
          readOnly
          disabled={!selectedWorkspace}
        />
      </Field>
      {!hasWorkspaces && (
        <p className="text-xs text-[var(--text-muted)] leading-relaxed">
          当前账号下还没有可用工作区，暂时无法创建会话。请先让服务端登记工作区，再回来创建会话。
        </p>
      )}
      {selectedWorkspace && (
        <p className="text-xs text-[var(--text-muted)] leading-relaxed">
          当前将使用工作区 <span className="font-semibold text-[var(--text)]">{selectedWorkspace.name}</span>，项目 ID 为{' '}
          <span className="font-semibold text-[var(--text)]">{selectedWorkspace.projectId}</span>。
        </p>
      )}
      <button
        type="submit"
        disabled={!canSubmit}
        className="rounded-[10px] py-2.5 px-4 font-semibold text-sm bg-brand text-[#14100d] hover:brightness-110 active:scale-[0.985] transition-all shadow-glow disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:brightness-100 disabled:active:scale-100"
      >
        {pendingSessionAction === 'create' ? '创建中...' : '创建并进入'}
      </button>
    </form>
  )
}

export function ForkSessionPanel() {
  const forkSession = useStore((state) => state.forkSession)
  const pendingSessionAction = useStore((state) => state.pendingSessionAction)
  const [title, setTitle] = useState('Forked Session')

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void forkSession(title)
      }}
      className="grid gap-2.5"
    >
      <span className="text-[10px] font-semibold tracking-[0.14em] uppercase text-brand">Fork</span>
      <Field label="分支标题">
        <input value={title} onChange={(event) => setTitle(event.target.value)} className={inputClassName} />
      </Field>
      <button type="submit" disabled={Boolean(pendingSessionAction)} className="rounded-[10px] py-2 px-4 text-xs font-semibold bg-brand/10 text-brand-text border border-[var(--line)] hover:bg-brand/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
        {pendingSessionAction === 'fork' ? '创建分支中...' : '从当前会话创建分支'}
      </button>
    </form>
  )
}
