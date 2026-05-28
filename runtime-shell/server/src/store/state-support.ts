import { createHash } from "node:crypto"
import { Config } from "../config"
import type {
  Organization,
  Permission,
  PersistedState,
  Project,
  Role,
  Tenant,
  User,
  WorkerNode,
  Workspace,
} from "../types"

export const DEFAULT_TENANT_ID = "tenant_default"
export const DEFAULT_ORGANIZATION_ID = "org_default"
export const DEFAULT_PROJECT_ID = "default"
export const SECONDARY_PROJECT_ID = "project_secondary"
export const DEFAULT_WORKSPACE_ID = "workspace_default"
export const SECONDARY_WORKSPACE_ID = "workspace_secondary"

export const now = () => new Date().toISOString()

export function nextId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`
}

function hashPassword(password: string) {
  return createHash("sha256").update(password).digest("hex")
}

export const defaultState = (): PersistedState => {
  const timestamp = now()
  return {
    tenants: buildDefaultTenants(timestamp),
    organizations: buildDefaultOrganizations(timestamp),
    projects: buildDefaultProjects(timestamp),
    users: buildDefaultUsers(),
    roles: buildDefaultRoles(),
    permissions: buildDefaultPermissions(),
    authSessions: [],
    workspaces: buildDefaultWorkspaces(timestamp),
    workspaceShareBindings: [],
    workers: buildDefaultWorkers(timestamp),
    sessions: [],
    events: [],
    auditLogs: [],
  }
}

export function normalizeState(input: PersistedState): PersistedState {
  const defaults = defaultState()
  return {
    tenants: Array.isArray(input.tenants) && input.tenants.length ? input.tenants : defaults.tenants,
    organizations:
      Array.isArray(input.organizations) && input.organizations.length ? input.organizations : defaults.organizations,
    projects: Array.isArray(input.projects) && input.projects.length ? input.projects : defaults.projects,
    users: Array.isArray(input.users) && input.users.length ? input.users : defaults.users,
    roles: Array.isArray(input.roles) ? input.roles : defaults.roles,
    permissions: Array.isArray(input.permissions) ? input.permissions : defaults.permissions,
    authSessions: Array.isArray(input.authSessions) ? input.authSessions : defaults.authSessions,
    workspaces: Array.isArray(input.workspaces) && input.workspaces.length ? input.workspaces : defaults.workspaces,
    workspaceShareBindings:
      Array.isArray(input.workspaceShareBindings) ? input.workspaceShareBindings : defaults.workspaceShareBindings,
    workers: normalizeWorkers(input.workers, defaults.workers),
    sessions: Array.isArray(input.sessions) ? input.sessions : defaults.sessions,
    events: Array.isArray(input.events) ? input.events : defaults.events,
    auditLogs: Array.isArray(input.auditLogs) ? input.auditLogs : defaults.auditLogs,
  }
}

function normalizeWorkers(inputWorkers: PersistedState["workers"], defaultWorkers: PersistedState["workers"]) {
  if (!Array.isArray(inputWorkers) || inputWorkers.length === 0) return defaultWorkers
  const defaultsById = new Map(defaultWorkers.map((worker) => [worker.id, worker]))
  const normalizedDefaults = defaultWorkers.map((defaultWorker) => {
    const current = inputWorkers.find((worker) => worker.id === defaultWorker.id)
    if (!current) return defaultWorker
    return {
      ...defaultWorker,
      ...current,
      tenantId: defaultWorker.tenantId,
      organizationId: defaultWorker.organizationId,
      workerCode: defaultWorker.workerCode,
      name: defaultWorker.name,
      baseUrl: defaultWorker.baseUrl,
      status: defaultWorker.status,
      capacity: defaultWorker.capacity,
      activeSessionCount: current.activeSessionCount,
      lastHeartbeatAt: current.lastHeartbeatAt,
    }
  })
  const extraWorkers = inputWorkers.filter((worker) => !defaultsById.has(worker.id))
  return [...normalizedDefaults, ...extraWorkers]
}

function buildDefaultTenants(timestamp: string): Tenant[] {
  return [
    {
      id: DEFAULT_TENANT_ID,
      slug: "default",
      name: "Default Tenant",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ]
}

function buildDefaultOrganizations(timestamp: string): Organization[] {
  return [
    {
      id: DEFAULT_ORGANIZATION_ID,
      tenantId: DEFAULT_TENANT_ID,
      slug: "default",
      name: "Default Organization",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ]
}

function buildDefaultProjects(timestamp: string): Project[] {
  return [
    {
      id: DEFAULT_PROJECT_ID,
      tenantId: DEFAULT_TENANT_ID,
      organizationId: DEFAULT_ORGANIZATION_ID,
      code: "default",
      name: "Default Project",
      defaultWorkspacePath: "/workspace/workspaces",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      id: SECONDARY_PROJECT_ID,
      tenantId: DEFAULT_TENANT_ID,
      organizationId: DEFAULT_ORGANIZATION_ID,
      code: "secondary",
      name: "Secondary Project",
      defaultWorkspacePath: "/workspace/workspaces/secondary",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ]
}

function buildDefaultUsers(): User[] {
  return [
    {
      id: "user_admin",
      tenantId: DEFAULT_TENANT_ID,
      organizationId: DEFAULT_ORGANIZATION_ID,
      username: Config.adminUsername,
      passwordHash: hashPassword(Config.adminPassword),
      displayName: "Runtime Shell Admin",
      role: "admin",
      projectIds: [DEFAULT_PROJECT_ID, SECONDARY_PROJECT_ID],
      workspaceIds: [DEFAULT_WORKSPACE_ID, SECONDARY_WORKSPACE_ID],
    },
    {
      id: "user_developer",
      tenantId: DEFAULT_TENANT_ID,
      organizationId: DEFAULT_ORGANIZATION_ID,
      username: "developer",
      passwordHash: hashPassword("change-me"),
      displayName: "Runtime Developer",
      role: "developer",
      projectIds: [SECONDARY_PROJECT_ID],
      workspaceIds: [SECONDARY_WORKSPACE_ID],
    },
    {
      id: "user_developer_secondary",
      tenantId: DEFAULT_TENANT_ID,
      organizationId: DEFAULT_ORGANIZATION_ID,
      username: "developer-secondary",
      passwordHash: hashPassword("change-me"),
      displayName: "Runtime Developer Secondary",
      role: "developer",
      projectIds: [DEFAULT_PROJECT_ID],
      workspaceIds: [DEFAULT_WORKSPACE_ID],
    },
  ]
}

function buildDefaultRoles(): Role[] {
  return []
}

function buildDefaultPermissions(): Permission[] {
  return []
}

function buildDefaultWorkspaces(timestamp: string): Workspace[] {
  return [
    {
      id: DEFAULT_WORKSPACE_ID,
      tenantId: DEFAULT_TENANT_ID,
      organizationId: DEFAULT_ORGANIZATION_ID,
      projectId: DEFAULT_PROJECT_ID,
      name: "Default Workspace Root",
      rootPath: "/workspace/workspaces",
      status: "active",
      createdBy: "user_admin",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      id: SECONDARY_WORKSPACE_ID,
      tenantId: DEFAULT_TENANT_ID,
      organizationId: DEFAULT_ORGANIZATION_ID,
      projectId: SECONDARY_PROJECT_ID,
      name: "Secondary Workspace Root",
      rootPath: "/workspace/workspaces/secondary",
      status: "active",
      createdBy: "user_admin",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ]
}

function buildDefaultWorkers(timestamp: string): WorkerNode[] {
  return [
    {
      id: "worker_local",
      tenantId: DEFAULT_TENANT_ID,
      organizationId: DEFAULT_ORGANIZATION_ID,
      workerCode: "worker_local",
      name: "opencode-worker",
      baseUrl: Config.opencodeBaseUrl,
      status: "ready",
      // 中文/English: local development should tolerate a few concurrent sessions,
      // otherwise one active session makes the whole shell feel "stuck" for other users.
      capacity: 16,
      activeSessionCount: 0,
      lastHeartbeatAt: timestamp,
      version: "local",
    },
  ]
}
