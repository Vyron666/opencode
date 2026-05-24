export type UserRole = "admin" | "operator" | "developer" | "viewer"

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

export type User = {
  id: string
  tenantId: string
  organizationId: string
  username: string
  password: string
  displayName: string
  role: UserRole
}

export type AuthSession = {
  id: string
  userId: string
  tenantId: string
  organizationId: string
  tokenHash: string
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
  createdBy: string
  createdAt: string
  updatedAt: string
}

export type AuditAction =
  | "auth.login"
  | "auth.logout"
  | "workspace.register"
  | "session.create"
  | "session.open"
  | "session.close"
  | "session.prompt"
  | "session.cancel"
  | "provider.save"

export type AuditLog = {
  id: string
  tenantId: string
  organizationId: string
  userId?: string
  businessSessionId?: string
  requestId?: string
  action: AuditAction
  resourceType: "auth_session" | "workspace" | "business_session" | "provider_config"
  resourceId?: string
  detail: Record<string, unknown>
  createdAt: string
}

export type WorkerStatus = "ready" | "offline" | "busy"

export type WorkerNode = {
  id: string
  name: string
  baseUrl: string
  status: WorkerStatus
  activeSessionCount: number
  lastHeartbeatAt: string
}

export type SessionStatus = "created" | "active" | "idle" | "completed" | "failed"

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
  users: User[]
  authSessions: AuthSession[]
  workspaces: Workspace[]
  workers: WorkerNode[]
  sessions: BusinessSession[]
  events: SessionEvent[]
  auditLogs: AuditLog[]
}
