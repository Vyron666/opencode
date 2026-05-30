import { createRequestFailureHandler } from './interaction-action-support'

export function createWorkspaceActions(input) {
  return {
    createWorkspace: async (name, projectId) => {
      input.set({ pendingWorkspaceAction: 'create' })
      const workspace = await input.api.createWorkspace({ name, projectId }).then(
        (value) => value,
        createRequestFailureHandler(input, { pendingWorkspaceAction: '' }, '创建工作区失败'),
      )
      input.set((state) => ({
        // 中文/English: push the freshly created workspace into local state first so
        // the adjacent create-session form can immediately target it without waiting for polling.
        workspaces: state.workspaces.some((item) => item.id === workspace.id) ? state.workspaces : [...state.workspaces, workspace],
        pendingWorkspaceAction: '',
        preferredWorkspaceId: workspace.id || '',
      }))
      await input.get().loadSessions().then(
        (value) => value,
        createRequestFailureHandler(input, { pendingWorkspaceAction: '' }, '刷新工作区列表失败'),
      )
      input.set({ pendingWorkspaceAction: '', preferredWorkspaceId: workspace.id || '' })
      return workspace
    },
  }
}
