import * as StateRepo from "../../repos/state-repo"
import * as WorkspaceRepo from "../../repos/workspace-repo"
import type { User } from "../../types"
import type { PersistState, ReadState } from "./store-domain-support"

export class StoreWorkspaceService {
  constructor(
    private readonly readState: ReadState,
    private readonly persistState: PersistState,
  ) {}

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

  async listWorkspacesByNamePrefix(input: {
    tenantId: string
    organizationId: string
    namePrefix: string
    limit: number
    createdBy?: string
  }) {
    return WorkspaceRepo.listWorkspacesByNamePrefix(input)
  }

  async ensureWorkspace(input: {
    tenantId: string
    organizationId: string
    projectId: string
    rootPath: string
    createdBy: string
    name?: string
  }) {
    const workspace = await WorkspaceRepo.ensureWorkspace(input)
    if (!StateRepo.getWorkspace(this.readState(), workspace.id)) {
      StateRepo.insertWorkspace(this.readState(), workspace)
      await this.persistState()
    }
    return workspace
  }

  async softDeleteWorkspaceById(input: {
    workspaceId: string
    deletedBy: string
  }) {
    return WorkspaceRepo.softDeleteWorkspaceById(input)
  }
}
