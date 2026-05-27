import { createHash } from "node:crypto"
import path from "node:path"
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
export const DEFAULT_WORKSPACE_ID = "workspace_default"

export const now = () => new Date().toISOString()

export function nextId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`
}

function hashPassword(password: string) {
  return createHash("sha256").update(password).digest("hex")
}

function readLegacyPassword(input: User) {
  const legacy = (input as Record<string, unknown>).password
  return typeof legacy === "string" ? legacy : undefined
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
    workers: buildDefaultWorkers(timestamp),
    sessions: [],
    events: [],
    auditLogs: [],
  }
}

export function normalizeState(input: PersistedState): PersistedState {
  const defaults = defaultState()
  const tenants = Array.isArray(input.tenants) && input.tenants.length ? input.tenants : defaults.tenants
  const organizations =
    Array.isArray(input.organizations) && input.organizations.length ? input.organizations : defaults.organizations
  const projects = Array.isArray(input.projects) && input.projects.length ? input.projects : defaults.projects
  const users = Array.isArray(input.users) && input.users.length ? input.users : defaults.users
  const roles = Array.isArray(input.roles) ? input.roles : defaults.roles
  const permissions = Array.isArray(input.permissions) ? input.permissions : defaults.permissions
  const authSessions = Array.isArray(input.authSessions) ? input.authSessions : defaults.authSessions
  const workspaces = Array.isArray(input.workspaces) && input.workspaces.length ? input.workspaces : defaults.workspaces
  const workers = Array.isArray(input.workers) && input.workers.length ? input.workers : defaults.workers
  const sessions = Array.isArray(input.sessions) ? input.sessions : defaults.sessions
  const events = Array.isArray(input.events) ? input.events : defaults.events
  const auditLogs = Array.isArray(input.auditLogs) ? input.auditLogs : defaults.auditLogs

  return {
    tenants,
    organizations,
    projects,
    users: users.map((item) => {
      const fallbackPassword = item.username === Config.adminUsername ? Config.adminPassword : "change-me"
      return {
        ...item,
        tenantId: item.tenantId || DEFAULT_TENANT_ID,
        organizationId: item.organizationId || DEFAULT_ORGANIZATION_ID,
        passwordHash: item.passwordHash || hashPassword(readLegacyPassword(item) || fallbackPassword),
      }
    }),
    roles,
    permissions,
    authSessions,
    workspaces: workspaces.map((item) => ({
      ...item,
      tenantId: item.tenantId || DEFAULT_TENANT_ID,
      organizationId: item.organizationId || DEFAULT_ORGANIZATION_ID,
      projectId: item.projectId || "default",
      name: item.name || path.basename(item.rootPath || "") || "Workspace",
    })),
    workers: workers.map((item) => ({
      ...item,
      workerCode: item.workerCode || item.id,
      capacity: item.capacity ?? 1,
    })),
    sessions: sessions.map((item) => ({
      ...item,
      tenantId: item.tenantId || DEFAULT_TENANT_ID,
      organizationId: item.organizationId || DEFAULT_ORGANIZATION_ID,
      workspaceId: item.workspaceId || DEFAULT_WORKSPACE_ID,
      lastEventAt: item.lastEventAt || item.updatedAt,
      capabilityState: item.capabilityState || {},
    })),
    events,
    auditLogs,
  }
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
      id: "project_default",
      tenantId: DEFAULT_TENANT_ID,
      organizationId: DEFAULT_ORGANIZATION_ID,
      code: "default",
      name: "Default Project",
      defaultWorkspacePath: "/workspace/workspaces",
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
    },
    {
      id: "user_operator",
      tenantId: DEFAULT_TENANT_ID,
      organizationId: DEFAULT_ORGANIZATION_ID,
      username: "operator",
      passwordHash: hashPassword("change-me"),
      displayName: "Runtime Operator",
      role: "operator",
    },
    {
      id: "user_developer",
      tenantId: DEFAULT_TENANT_ID,
      organizationId: DEFAULT_ORGANIZATION_ID,
      username: "developer",
      passwordHash: hashPassword("change-me"),
      displayName: "Runtime Developer",
      role: "developer",
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
      projectId: "default",
      name: "Default Workspace Root",
      rootPath: "/workspace/workspaces",
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
      workerCode: "worker_local",
      name: "opencode-worker",
      baseUrl: Config.opencodeBaseUrl,
      status: "ready",
      capacity: 1,
      activeSessionCount: 0,
      lastHeartbeatAt: timestamp,
    },
  ]
}
