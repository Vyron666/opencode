import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../../store'
import { Field, inputClassName, secondaryButtonClassName, Select, useViewerContext } from './sidebar-support'

const DEFAULT_TITLE = 'Runtime Shell \u4f1a\u8bdd'
const DEFAULT_WORKSPACE_NAME = '\u65b0\u5de5\u4f5c\u533a'

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
        const submittedName = name.trim()
        void createWorkspace(submittedName, projectId).then(() => {
          // 中文/English: only clear the field if the user has not already started
          // typing the next workspace name while the previous create request was finishing.
          setName((current) => (current === submittedName ? DEFAULT_WORKSPACE_NAME : current))
        })
      }}
      className="grid gap-2.5 pb-3 border-b border-[var(--line)]"
    >
      <span className="text-[10px] font-semibold tracking-[0.14em] uppercase text-brand">Workspace</span>
      <Field label={'\u5de5\u4f5c\u533a\u540d\u79f0'}>
        <input value={name} onChange={(event) => setName(event.target.value)} className={inputClassName} />
      </Field>
      <Field label={'\u6240\u5c5e\u9879\u76ee'}>
        <Select value={projectId} onChange={setProjectId} options={projectOptions} emptyLabel={'\u5f53\u524d\u6ca1\u6709\u53ef\u7528\u9879\u76ee'} />
      </Field>
      <p className="text-xs text-[var(--text-muted)] leading-relaxed">
        {'\u7cfb\u7edf\u4f1a\u5728\u4f60\u7684\u4e2a\u4eba\u5de5\u4f5c\u533a\u6839\u76ee\u5f55\u4e0b\u81ea\u52a8\u521b\u5efa\u6587\u4ef6\u5939\uff0c\u4e0d\u9700\u8981\u624b\u52a8\u586b\u5199 '}
        <code>rootPath</code>
        {'\u3002'}
      </p>
      <button type="submit" disabled={!canSubmit} className={secondaryButtonClassName}>
        {pendingWorkspaceAction === 'create' ? '\u521b\u5efa\u5de5\u4f5c\u533a\u4e2d...' : '\u65b0\u5efa\u5de5\u4f5c\u533a'}
      </button>
    </form>
  )
}

export function CreateSessionPanel() {
  const createSession = useStore((state) => state.createSession)
  const pendingSessionAction = useStore((state) => state.pendingSessionAction)
  const pendingWorkspaceAction = useStore((state) => state.pendingWorkspaceAction)
  const preferredWorkspaceId = useStore((state) => state.preferredWorkspaceId)
  const workspaces = useStore((state) => state.workspaces)
  const { isSharedSession } = useViewerContext()
  const [title, setTitle] = useState(DEFAULT_TITLE)
  const [workspaceId, setWorkspaceId] = useState('')
  const hasWorkspaces = workspaces.length > 0
  const effectiveWorkspaceId =
    (preferredWorkspaceId && workspaces.some((workspace) => workspace.id === preferredWorkspaceId) && preferredWorkspaceId) ||
    (workspaces.some((workspace) => workspace.id === workspaceId) && workspaceId) ||
    workspaces[0]?.id ||
    ''
  // 中文/English: resolve the effective workspace from render state so users can create
  // a session immediately after creating a workspace, without waiting for the sync effect.
  const selectedWorkspace = workspaces.find((workspace) => workspace.id === effectiveWorkspaceId) || null
  const canSubmit = Boolean(title.trim() && selectedWorkspace) && !pendingSessionAction && !pendingWorkspaceAction

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
        const submittedTitle = title.trim()
        void createSession(submittedTitle, selectedWorkspace.projectId, selectedWorkspace.id).then(() => {
          // 中文/English: avoid resetting a freshly typed next title when the previous
          // create-and-enter request resolves a little later.
          setTitle((current) => (current === submittedTitle ? DEFAULT_TITLE : current))
        })
      }}
      className="grid gap-2.5 pb-3 border-b border-[var(--line)]"
    >
      <span className="text-[10px] font-semibold tracking-[0.14em] uppercase text-brand">Create</span>
      <Field label={'\u4f1a\u8bdd\u6807\u9898'}>
        <input value={title} onChange={(event) => setTitle(event.target.value)} className={inputClassName} />
      </Field>
      <Field label={'\u5de5\u4f5c\u533a'}>
        <Select
          value={effectiveWorkspaceId}
          onChange={setWorkspaceId}
          options={workspaces.map((workspace) => ({
            id: workspace.id,
            label: `${workspace.name} / ${workspace.projectName || workspace.projectId}`,
          }))}
          emptyLabel={'\u6682\u65e0\u53ef\u7528\u5de5\u4f5c\u533a'}
        />
      </Field>
      <Field label={'\u6240\u5c5e\u9879\u76ee'}>
        <input
          value={selectedWorkspace?.projectName || selectedWorkspace?.projectId || ''}
          className={inputClassName}
          readOnly
          disabled={!selectedWorkspace}
        />
      </Field>
      {!hasWorkspaces ? (
        <p className="text-xs text-[var(--text-muted)] leading-relaxed">
          {'\u5f53\u524d\u8fd8\u6ca1\u6709\u53ef\u7528\u5de5\u4f5c\u533a\uff0c\u8bf7\u5148\u5728\u4e0a\u65b9\u65b0\u5efa\u4e00\u4e2a\u5de5\u4f5c\u533a\uff0c\u518d\u56de\u6765\u521b\u5efa\u4f1a\u8bdd\u3002'}
        </p>
      ) : null}
      {selectedWorkspace ? (
        <p className="text-xs text-[var(--text-muted)] leading-relaxed">
          {'\u5f53\u524d\u4f1a\u4f7f\u7528\u5de5\u4f5c\u533a '}
          <span className="font-semibold text-[var(--text)]">{selectedWorkspace.name}</span>
          {'\uff0c\u6240\u5c5e\u9879\u76ee\u4e3a '}
          <span className="font-semibold text-[var(--text)]">{selectedWorkspace.projectName || selectedWorkspace.projectId}</span>
          {'\u3002'}
        </p>
      ) : null}
      {isSharedSession ? (
        <p className="text-xs text-[var(--text-muted)] leading-relaxed">
          {'\u5171\u4eab\u5de5\u4f5c\u533a\u53ea\u5141\u8bb8\u7ee7\u7eed\u5904\u7406\u5df2\u6709\u4f1a\u8bdd\u3002\u65b0\u4f1a\u8bdd\u8bf7\u4ece\u4f60\u81ea\u5df1\u7684\u53ef\u7528\u5de5\u4f5c\u533a\u4e2d\u521b\u5efa\u3002'}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={!canSubmit}
        className="rounded-[12px] bg-brand px-4 py-2.5 text-sm font-semibold text-white transition-all hover:bg-[var(--brand-strong)] active:scale-[0.985] shadow-[0_12px_30px_rgba(37,99,235,0.18)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-brand disabled:active:scale-100"
      >
        {pendingSessionAction === 'create' ? '\u521b\u5efa\u4e2d...' : '\u521b\u5efa\u5e76\u8fdb\u5165'}
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
      <Field label={'\u5206\u652f\u6807\u9898'}>
        <input value={title} onChange={(event) => setTitle(event.target.value)} className={inputClassName} />
      </Field>
      {isSharedSession ? (
        <p className="text-xs text-[var(--text-muted)] leading-relaxed">
          {'\u5171\u4eab\u5de5\u4f5c\u533a\u4e0b\u7684\u4f1a\u8bdd\u53ea\u5141\u8bb8\u7ee7\u7eed\u534f\u4f5c\uff0c\u4e0d\u5141\u8bb8\u4ece\u5f53\u524d\u4f1a\u8bdd\u521b\u5efa\u5206\u652f\u3002'}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={Boolean(pendingSessionAction) || !canManageSession}
        className="rounded-[12px] border border-[var(--line)] bg-white px-4 py-2 text-xs font-semibold text-brand transition-colors hover:bg-[var(--surface-muted)] disabled:cursor-not-allowed disabled:opacity-40"
      >
        {pendingSessionAction === 'fork' ? '\u521b\u5efa\u5206\u652f\u4e2d...' : '\u4ece\u5f53\u524d\u4f1a\u8bdd\u521b\u5efa\u5206\u652f'}
      </button>
    </form>
  )
}
