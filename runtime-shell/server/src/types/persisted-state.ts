import type { AuditLog } from "./audit"
import type { AuthSession, Organization, Permission, Project, Role, Tenant, User } from "./auth"
import type { SkillPackageRecord } from "./config"
import type { BusinessSession, SessionEvent } from "./session"
import type { WorkerNode } from "./worker"
import type { Workspace, WorkspaceShareBinding } from "./workspace"

export type PersistedState = {
  tenants: Tenant[]
  organizations: Organization[]
  projects: Project[]
  users: User[]
  roles: Role[]
  permissions: Permission[]
  authSessions: AuthSession[]
  workspaces: Workspace[]
  workspaceShareBindings: WorkspaceShareBinding[]
  workers: WorkerNode[]
  sessions: BusinessSession[]
  events: SessionEvent[]
  auditLogs: AuditLog[]
  skillPackages?: SkillPackageRecord[]
}
