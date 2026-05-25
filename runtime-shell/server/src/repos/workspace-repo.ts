import path from "node:path"
import { now, nextId } from "../store/state-support"
import type { PersistedState, User } from "../types"
import { findWorkspaceByRootPath, getWorkspace, insertWorkspace, listUserWorkspaces, listWorkspaces } from "./state-repo"

export function listAllWorkspaces(state: PersistedState) {
  return listWorkspaces(state)
}

export function findWorkspace(state: PersistedState, workspaceId: string) {
  return getWorkspace(state, workspaceId)
}

export function findWorkspaceByPath(state: PersistedState, rootPath: string) {
  return findWorkspaceByRootPath(state, rootPath)
}

export function listWorkspacesForUser(state: PersistedState, user: User) {
  return listUserWorkspaces(state, user)
}

export function ensureWorkspace(state: PersistedState, input: {
  tenantId: string
  organizationId: string
  projectId: string
  rootPath: string
  createdBy: string
  name?: string
}) {
  const existing = findWorkspaceByPath(state, input.rootPath)
  if (existing) return existing
  const timestamp = now()
  return insertWorkspace(state, {
    id: nextId("workspace"),
    tenantId: input.tenantId,
    organizationId: input.organizationId,
    projectId: input.projectId,
    name: input.name || path.basename(input.rootPath) || input.projectId,
    rootPath: input.rootPath,
    createdBy: input.createdBy,
    createdAt: timestamp,
    updatedAt: timestamp,
  })
}
