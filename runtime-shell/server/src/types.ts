export type UserRole = "admin" | "developer"

export type Tenant = {
  id: string
  slug: string
  name: string
  createdAt: string
  updatedAt: string
}

export type Organization = {
  id: string
  tenantId: string
  slug: string
  name: string
  createdAt: string
  updatedAt: string
}

export type Project = {
  id: string
  tenantId: string
  organizationId: string
  code: string
  name: string
  defaultWorkspacePath?: string
  createdAt: string
  updatedAt: string
}

export type User = {
  id: string
  tenantId: string
  organizationId: string
  username: string
  passwordHash: string
  displayName: string
  role: UserRole
  projectIds: string[]
  workspaceIds: string[]
}

export type Role = {
  id: string
  tenantId: string
  code: string
  name: string
  createdAt: string
  updatedAt: string
}

export type Permission = {
  id: string
  tenantId: string
  code: string
  name: string
  resourceType: string
  action: string
  scope: string
  createdAt: string
  updatedAt: string
}

export type AuthSession = {
  id: string
  userId: string
  tenantId: string
  organizationId: string
  tokenHash: string
  status: "active" | "expired" | "revoked"
  createdAt: string
  updatedAt: string
  expiresAt: string
}

export type Workspace = {
  id: string
  tenantId: string
  organizationId: string
  projectId: string
  name: string
  rootPath: string
  status: "active" | "disabled" | "deleted"
  createdBy: string
  createdAt: string
  updatedAt: string
}

export type SessionShareBinding = {
  id: string
  tenantId: string
  organizationId: string
  projectId: string
  workspaceId: string
  businessSessionId: string
  ownerUserId: string
  targetUserId: string
  status: "active" | "revoked"
  createdAt: string
  createdBy: string
  updatedAt: string
  updatedBy: string
}

export type WorkspaceAccessResult =
  | {
      ok: true
      workspace: Workspace
    }
  | {
      ok: false
      reason: "workspace_not_found" | "forbidden" | "workspace_disabled" | "invalid_path"
    }

export type AuditAction =
  | "auth.login"
  | "auth.logout"
  | "workspace.register"
  | "session.create"
  | "session.share"
  | "session.unshare"
  | "session.open"
  | "session.close"
  | "session.prompt"
  | "session.cancel"
  | "custom_model.save"
  | "provider.save"

export type AuditLog = {
  id: string
  tenantId: string
  organizationId: string
  userId?: string
  businessSessionId?: string
  requestId?: string
  action: AuditAction
  resourceType:
    | "auth_session"
    | "workspace"
    | "business_session"
    | "provider_config"
    | "custom_model"
    | "session_share_binding"
  resourceId?: string
  detail: Record<string, unknown>
  createdAt: string
}

export type WorkerStatus = "registering" | "ready" | "busy" | "degraded" | "offline" | "draining"

export type WorkerNode = {
  id: string
  tenantId?: string
  organizationId?: string
  workerCode: string
  name: string
  baseUrl: string
  status: WorkerStatus
  capacity: number
  activeSessionCount: number
  lastHeartbeatAt: string
  version?: string
}

export type WorkerHeartbeat = {
  id: string
  workerId: string
  capacityUsed: number
  status: WorkerStatus
  reportedAt: string
  createdAt: string
}

export type SessionStatus =
  | "created"
  | "opening"
  | "active"
  | "waiting_input"
  | "cancelling"
  | "closing"
  | "completed"
  | "failed"
  | "orphaned"

export type SessionRuntimeBindingStatus = "binding" | "bound" | "lost" | "releasing" | "released"

export type BusinessSessionRuntimeBinding = {
  id: string
  businessSessionId: string
  workerId: string
  acpSessionId?: string
  runtimeKey?: string
  bindingStatus: SessionRuntimeBindingStatus
  boundAt: string
  releasedAt?: string
  createdAt: string
  updatedAt: string
}

export type RuntimeLease = {
  id: string
  businessSessionId: string
  workerId: string
  leaseOwner: string
  leaseExpiresAt: string
  version: number
  createdAt: string
  updatedAt: string
}

export type RuntimeFailureType =
  | "worker_offline"
  | "runtime_exit"
  | "open_timeout"
  | "prompt_timeout"
  | "close_timeout"
  | "binding_conflict"

export type RuntimeFailureLog = {
  id: string
  businessSessionId?: string
  workerId?: string
  failureType: RuntimeFailureType
  message?: string
  detail?: Record<string, unknown>
  createdAt: string
}

export type SessionCapabilityState = {
  modelId?: string
  modeId?: string
  configOptions?: Array<Record<string, unknown>>
  models?: Record<string, unknown>
  modes?: Record<string, unknown>
  sessionInfo?: Record<string, unknown>
  usage?: Record<string, unknown>
  availableCommands?: string[]
}

export type AcpBinding = {
  acpSessionId: string
  runtimeKey: string
  openedAt: string
  // 中文/English: runtime-shell 只支持真实 ACP，不提供 mock 传输层。
  transport?: "real"
}

export type PermissionOptionSummary = {
  optionId: string
  kind: string
  name: string
}

export type PendingPermission = {
  requestId: string
  businessSessionId: string
  acpSessionId?: string
  workerId: string
  toolName: string
  rawInput?: unknown
  options: PermissionOptionSummary[]
  createdAt: string
}

export type PendingQuestion = {
  requestId: string
  businessSessionId: string
  acpSessionId?: string
  workerId: string
  // 中文/English: human-readable message shown to the user (prompt for answers).
  message: string
  // 中文/English: Elicitation mode. We only implement "form" for now.
  mode: "form"
  requestedSchema: Record<string, unknown>
  meta?: Record<string, unknown>
  createdAt: string
}

export type BusinessSession = {
  id: string
  tenantId: string
  organizationId: string
  workspaceId: string
  title: string
  projectId: string
  workspacePath: string
  workerId: string
  status: SessionStatus
  createdBy: string
  createdAt: string
  updatedAt: string
  lastEventAt?: string
  binding?: AcpBinding
  capabilityState?: SessionCapabilityState
}

export type BusinessSessionPatch = Partial<Omit<BusinessSession, "binding">> & {
  // 中文/English: `null` means explicitly clear the persisted ACP binding during lifecycle reset.
  binding?: AcpBinding | null
}

export type SessionEventType =
  | "session_opened"
  | "session_closed"
  | "user_message_chunk"
  | "agent_message_chunk"
  | "agent_thought_chunk"
  | "tool_call"
  | "tool_call_update"
  | "upstream_update"
  | "turn_completed"
  | "plan"
  | "usage_update"
  | "available_commands_update"
  | "config_option_update"
  | "current_mode_update"
  | "session_info_update"
  | "permission_requested"
  | "permission_resolved"
  | "question_requested"
  | "question_resolved"
  | "session_error"
  | "worker_disconnected"
  | "session_failed"

export type SessionEvent = {
  eventId: string
  eventType: SessionEventType
  businessSessionId: string
  acpSessionId?: string
  workerId: string
  timestamp: string
  payload: Record<string, unknown>
}

export type PersistedState = {
  tenants: Tenant[]
  organizations: Organization[]
  projects: Project[]
  users: User[]
  roles: Role[]
  permissions: Permission[]
  authSessions: AuthSession[]
  workspaces: Workspace[]
  sessionShareBindings: SessionShareBinding[]
  workers: WorkerNode[]
  sessions: BusinessSession[]
  events: SessionEvent[]
  auditLogs: AuditLog[]
}
