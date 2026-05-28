import { createRequestFailureHandler } from './interaction-action-support'

export function createWorkspaceActions(input) {
  return {
    createWorkspace: async (name, projectId) => {
      input.set({ pendingWorkspaceAction: 'create' })
      const workspace = await input.api.createWorkspace({ name, projectId }).then(
        (value) => value,
        createRequestFailureHandler(input, { pendingWorkspaceAction: '' }, '创建工作区失败'),
      )
      await input.get().loadSessions().then(
        (value) => value,
        createRequestFailureHandler(input, { pendingWorkspaceAction: '' }, '刷新工作区列表失败'),
      )
      input.set({ pendingWorkspaceAction: '', preferredWorkspaceId: workspace.id || '' })
      return workspace
    },
  }
}
