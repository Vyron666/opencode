import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../../store'
import { Field, inputClassName, secondaryButtonClassName, Select, useViewerContext } from './sidebar-support'

const DEFAULT_TITLE = 'Runtime Shell 会话'
const DEFAULT_WORKSPACE_NAME = '新工作区'

export function CreateWorkspacePanel() {
  const createWorkspace = useStore((state) => state.createWorkspace)
  const pendingWorkspaceAction = useStore((state) => state.pendingWorkspaceAction)
  const user = useStore((state) => state.user)
  const workspaces = useStore((state) => state.workspaces)
  const [name, setName] = useState(DEFAULT_WORKSPACE_NAME)
  const [projectId, setProjectId] = useState('')

  const projectNameMap = useMemo(
    () =>
      new Map(
        workspaces.map((workspace) => [workspace.projectId, workspace.projectName || workspace.projectId]),
      ),
    [workspaces],
  )
  const projectOptions = useMemo(
    () =>
      [...new Map(
        (user?.projectIds || []).map((id) => [
          id,
          {
            id,
            label: projectNameMap.get(id) || id,
          },
        ]),
      ).values()],
    [projectNameMap, user],
  )
  const canSubmit = Boolean(name.trim() && projectId) && !pendingWorkspaceAction

  useEffect(() => {
    if (!projectOptions.length) {
      if (projectId) setProjectId('')
      return
    }
    if (projectOptions.some((option) => option.id === projectId)) return
    setProjectId(projectOptions[0].id)
  }, [projectId, projectOptions])

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        if (!name.trim() || !projectId) return
        void createWorkspace(name, projectId).then(() => {
          setName(DEFAULT_WORKSPACE_NAME)
        })
      }}
      className="grid gap-2.5 pb-3 border-b border-[var(--line)]"
    >
      <span className="text-[10px] font-semibold tracking-[0.14em] uppercase text-brand">Workspace</span>
      <Field label="工作区名称">
        <input value={name} onChange={(event) => setName(event.target.value)} className={inputClassName} />
      </Field>
      <Field label="所属项目">
        <Select value={projectId} onChange={setProjectId} options={projectOptions} emptyLabel="当前没有可用项目" />
      </Field>
      <p className="text-xs text-[var(--text-muted)] leading-relaxed">
        系统会在你的个人工作区根目录下自动创建文件夹，不需要手动填写 `rootPath`。
      </p>
      <button type="submit" disabled={!canSubmit} className={secondaryButtonClassName}>
        {pendingWorkspaceAction === 'create' ? '创建工作区中...' : '新建工作区'}
      </button>
    </form>
  )
}

export function CreateSessionPanel() {
  const createSession = useStore((state) => state.createSession)
  const pendingSessionAction = useStore((state) => state.pendingSessionAction)
  const preferredWorkspaceId = useStore((state) => state.preferredWorkspaceId)
  const workspaces = useStore((state) => state.workspaces)
  const { isSharedSession } = useViewerContext()
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
    if (preferredWorkspaceId && workspaces.some((workspace) => workspace.id === preferredWorkspaceId)) {
      if (workspaceId !== preferredWorkspaceId) {
        setWorkspaceId(preferredWorkspaceId)
      }
      useStore.setState({ preferredWorkspaceId: '' })
      return
    }
    if (selectedWorkspace) return
    setWorkspaceId(workspaces[0].id)
  }, [hasWorkspaces, preferredWorkspaceId, selectedWorkspace, workspaceId, workspaces])

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
        <Select
          value={workspaceId}
          onChange={setWorkspaceId}
          options={workspaces.map((workspace) => ({
            id: workspace.id,
            label: `${workspace.name} / ${workspace.projectName || workspace.projectId}`,
          }))}
          emptyLabel="暂无可用工作区"
        />
      </Field>
      <Field label="所属项目">
        <input
          value={selectedWorkspace?.projectName || selectedWorkspace?.projectId || ''}
          className={inputClassName}
          readOnly
          disabled={!selectedWorkspace}
        />
      </Field>
      {!hasWorkspaces ? (
        <p className="text-xs text-[var(--text-muted)] leading-relaxed">
          当前还没有可用工作区，请先在上方新建一个工作区，再回来创建会话。
        </p>
      ) : null}
      {selectedWorkspace ? (
        <p className="text-xs text-[var(--text-muted)] leading-relaxed">
          当前会使用工作区 <span className="font-semibold text-[var(--text)]">{selectedWorkspace.name}</span>，所属项目为{' '}
          <span className="font-semibold text-[var(--text)]">{selectedWorkspace.projectName || selectedWorkspace.projectId}</span>。
        </p>
      ) : null}
      {isSharedSession ? (
        <p className="text-xs text-[var(--text-muted)] leading-relaxed">
          共享工作区只允许继续处理已有会话。新会话请从你自己的可用工作区中创建。
        </p>
      ) : null}
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
  const { canManageSession, isSharedSession } = useViewerContext()
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
      {isSharedSession ? (
        <p className="text-xs text-[var(--text-muted)] leading-relaxed">
          共享工作区下的会话只允许继续协作，不允许从当前会话创建分支。
        </p>
      ) : null}
      <button
        type="submit"
        disabled={Boolean(pendingSessionAction) || !canManageSession}
        className="rounded-[10px] py-2 px-4 text-xs font-semibold bg-brand/10 text-brand-text border border-[var(--line)] hover:bg-brand/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {pendingSessionAction === 'fork' ? '创建分支中...' : '从当前会话创建分支'}
      </button>
    </form>
  )
}
