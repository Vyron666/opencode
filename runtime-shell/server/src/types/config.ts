export type ConfigScopeLevel = "platform" | "tenant" | "organization" | "project" | "workspace" | "user" | "session"

export type ConfigNamespace = "provider" | "mcp" | "skill" | "runtime"

export type ConfigChangeType = "create" | "update" | "delete"

export type ConfigSource = "platform_shared" | "user_private"

export type ConfigItem = {
  id: string
  tenantId: string
  organizationId: string
  projectId?: string
  workspaceId?: string
  businessSessionId?: string
  scopeLevel: ConfigScopeLevel
  scopeId: string
  namespace: ConfigNamespace
  configKey: string
  valueJson: unknown
  version: number
  createdAt: string
  createdBy: string
  updatedAt: string
  updatedBy: string
}

export type ConfigChangeLog = {
  id: string
  tenantId: string
  organizationId: string
  projectId?: string
  workspaceId?: string
  businessSessionId?: string
  requestId?: string
  scopeLevel: ConfigScopeLevel
  scopeId: string
  namespace: ConfigNamespace
  configKey: string
  changeType: ConfigChangeType
  previousVersion?: number
  nextVersion: number
  summaryJson: Record<string, unknown>
  createdAt: string
  createdBy: string
}

export type ConfigApprovalStatus = "pending" | "approved" | "rejected"

export type ConfigApprovalRequest = {
  id: string
  tenantId: string
  organizationId: string
  requestId?: string
  namespace: ConfigNamespace
  configKey: string
  scopeLevel: ConfigScopeLevel
  scopeId: string
  status: ConfigApprovalStatus
  summaryJson: Record<string, unknown>
  payloadJson: Record<string, unknown>
  createdAt: string
  createdBy: string
  reviewedAt?: string
  reviewedBy?: string
  reviewComment?: string
}

export type UserMcpConfig = {
  type: "local" | "remote"
  enabled?: boolean
  command?: string[]
  url?: string
  headers?: Record<string, string>
  timeout?: number
}

export type UserSkillConfig = {
  paths?: string[]
  urls?: string[]
}

export type SourcedSkillConfigItem = {
  type: "path" | "url"
  value: string
  source: ConfigSource
}

export type SkillPackageScope = "platform_shared" | "user_private"

export type SkillPackageRecord = {
  id: string
  tenantId: string
  organizationId: string
  userId?: string
  scope: SkillPackageScope
  skillName: string
  displayName: string
  description?: string
  token: string
  relativeDir: string
  skillRootDir: string
  sourceFilename: string
  createdAt: string
  updatedAt: string
}
