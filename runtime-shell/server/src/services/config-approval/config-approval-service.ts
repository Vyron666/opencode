import * as ConfigApprovalRepo from "../../repos/config-approval-repo"
import { auditService } from "../store/store-singleton"
import type { ConfigNamespace, User, UserMcpConfig, UserSkillConfig } from "../../types"
import {
  applyApprovedPlatformMcpConfig,
  applyApprovedPlatformProviderConfig,
  applyApprovedPlatformSkillConfig,
} from "../settings/settings-service"

export async function createConfigApproval(input: {
  user: User
  requestId: string
  namespace: ConfigNamespace
  configKey: string
  scopeLevel: "platform"
  scopeId: string
  summaryJson: Record<string, unknown>
  payloadJson: Record<string, unknown>
}) {
  const approval = await ConfigApprovalRepo.createConfigApprovalRequest({
    tenantId: input.user.tenantId,
    organizationId: input.user.organizationId,
    requestId: input.requestId,
    namespace: input.namespace,
    configKey: input.configKey,
    scopeLevel: input.scopeLevel,
    scopeId: input.scopeId,
    summaryJson: input.summaryJson,
    payloadJson: input.payloadJson,
    createdBy: input.user.id,
  })
  void auditService.appendAuditLog({
    tenantId: input.user.tenantId,
    organizationId: input.user.organizationId,
    userId: input.user.id,
    requestId: input.requestId,
    action: "config.approval.create",
    resourceType: "config_approval_request",
    resourceId: approval.id,
    detail: {
      namespace: input.namespace,
      configKey: input.configKey,
      scopeLevel: input.scopeLevel,
      scopeId: input.scopeId,
    },
  })
  return approval
}

export async function listConfigApprovals(user: User) {
  if (user.role !== "admin") return { ok: false as const, reason: "forbidden" }
  return {
    ok: true as const,
    items: await ConfigApprovalRepo.listConfigApprovalRequests({
      tenantId: user.tenantId,
      organizationId: user.organizationId,
    }),
  }
}

export async function reviewConfigApproval(input: {
  user: User
  requestId: string
  approvalId: string
  decision: "approved" | "rejected"
  comment?: string
}) {
  if (input.user.role !== "admin") return { ok: false as const, reason: "forbidden" }
  const current = await ConfigApprovalRepo.findConfigApprovalRequest(input.approvalId)
  if (!current) return { ok: false as const, reason: "not_found" }
  if (current.status !== "pending") return { ok: false as const, reason: "invalid_status" }

  if (input.decision === "approved") {
    const executeResult = await applyApprovalPayload({
      user: input.user,
      requestId: input.requestId,
      approval: current,
    })
    if (!executeResult.ok) return executeResult
  }

  const reviewed = await ConfigApprovalRepo.reviewConfigApprovalRequest({
    id: input.approvalId,
    status: input.decision,
    reviewedBy: input.user.id,
    reviewComment: input.comment,
  })
  if (!reviewed) return { ok: false as const, reason: "not_found" }
  void auditService.appendAuditLog({
    tenantId: input.user.tenantId,
    organizationId: input.user.organizationId,
    userId: input.user.id,
    requestId: input.requestId,
    action: input.decision === "approved" ? "config.approval.approve" : "config.approval.reject",
    resourceType: "config_approval_request",
    resourceId: reviewed.id,
    detail: {
      namespace: reviewed.namespace,
      configKey: reviewed.configKey,
      decision: input.decision,
    },
  })
  return {
    ok: true as const,
    approval: reviewed,
  }
}

async function applyApprovalPayload(input: {
  user: User
  requestId: string
  approval: Awaited<ReturnType<typeof ConfigApprovalRepo.findConfigApprovalRequest>>
}) {
  if (!input.approval) return { ok: false as const, reason: "not_found" }
  if (input.approval.namespace === "provider") {
    const config = input.approval.payloadJson.config
    if (!isProviderPayload(config)) return { ok: false as const, reason: "invalid_payload" }
    await applyApprovedPlatformProviderConfig({
      user: input.user,
      requestId: input.requestId,
      config,
    })
    return { ok: true as const }
  }
  if (input.approval.namespace === "mcp") {
    const servers = input.approval.payloadJson.servers
    if (!isMcpServerMap(servers)) return { ok: false as const, reason: "invalid_payload" }
    await applyApprovedPlatformMcpConfig({
      user: input.user,
      requestId: input.requestId,
      servers,
    })
    return { ok: true as const }
  }
  if (input.approval.namespace === "skill") {
    const config = input.approval.payloadJson.config
    if (!isSkillConfig(config)) return { ok: false as const, reason: "invalid_payload" }
    await applyApprovedPlatformSkillConfig({
      user: input.user,
      requestId: input.requestId,
      config,
    })
    return { ok: true as const }
  }
  return { ok: false as const, reason: "invalid_payload" }
}

function isProviderPayload(value: unknown): value is {
  providerId: string
  name: string
  npm?: string
  api: string
  baseURL: string
  apiKey?: string
  defaultModel: string
  models: Array<{
    id: string
    name: string
    api?: string
  }>
} {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as { providerId?: string }).providerId === "string" &&
      Array.isArray((value as { models?: unknown[] }).models),
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isMcpServerMap(value: unknown): value is Record<string, UserMcpConfig> {
  if (!isRecord(value)) return false
  return Object.values(value).every(isMcpConfig)
}

function isMcpConfig(value: unknown): value is UserMcpConfig {
  if (!isRecord(value)) return false
  if (value.type === "local") {
    return Array.isArray(value.command) && value.command.every((item) => typeof item === "string")
  }
  if (value.type === "remote") {
    return typeof value.url === "string" && (!value.headers || isStringRecord(value.headers))
  }
  return false
}

function isSkillConfig(value: unknown): value is UserSkillConfig {
  if (!isRecord(value)) return false
  const pathsValid = !value.paths || (Array.isArray(value.paths) && value.paths.every((item) => typeof item === "string"))
  const urlsValid = !value.urls || (Array.isArray(value.urls) && value.urls.every((item) => typeof item === "string"))
  return pathsValid && urlsValid
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!isRecord(value)) return false
  return Object.values(value).every((item) => typeof item === "string")
}
