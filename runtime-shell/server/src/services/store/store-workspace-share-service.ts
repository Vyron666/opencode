import type { Workspace } from "../../types"
import * as WorkspaceShareRepo from "../../repos/workspace-share-repo"

export class StoreWorkspaceShareService {
  async listSharesForTargetUser(userId: string) {
    return WorkspaceShareRepo.listSharesForTargetUser(userId)
  }

  async listSharesForWorkspace(workspaceId: string) {
    return WorkspaceShareRepo.listSharesForWorkspace(workspaceId)
  }

  async findShareForWorkspaceTarget(input: {
    workspaceId: string
    targetUserId: string
  }) {
    return WorkspaceShareRepo.findShareForWorkspaceTarget(input)
  }

  async createShareBinding(input: {
    workspace: Workspace
    ownerUserId: string
    targetUserId: string
  }) {
    return WorkspaceShareRepo.createShareBinding(input)
  }

  async revokeShareBinding(input: {
    workspaceId: string
    targetUserId: string
    updatedBy: string
  }) {
    return WorkspaceShareRepo.revokeShareBinding(input)
  }

  async softDeleteSharesByWorkspaceId(input: {
    workspaceId: string
    deletedBy: string
  }) {
    return WorkspaceShareRepo.softDeleteSharesByWorkspaceId(input)
  }
}
