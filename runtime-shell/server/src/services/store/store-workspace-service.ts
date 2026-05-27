import * as WorkspaceRepo from "../../repos/workspace-repo"
import type { User } from "../../types"

export class StoreWorkspaceService {
  async listWorkspaces() {
    return WorkspaceRepo.listAllWorkspaces()
  }

  async getWorkspace(workspaceId: string) {
    return WorkspaceRepo.findWorkspace(workspaceId)
  }

  async findWorkspaceByRootPath(rootPath: string) {
    return WorkspaceRepo.findWorkspaceByPath(rootPath)
  }

  async listUserWorkspaces(user: User) {
    return WorkspaceRepo.listWorkspacesForUser(user)
  }

  async ensureWorkspace(input: {
    tenantId: string
    organizationId: string
    projectId: string
    rootPath: string
    createdBy: string
    name?: string
  }) {
    return WorkspaceRepo.ensureWorkspace(input)
  }
}
