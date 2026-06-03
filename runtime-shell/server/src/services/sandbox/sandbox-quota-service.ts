import * as QuotaPolicyRepo from "../../repos/quota-policy-repo"
import * as RuntimeOperationQueueRepo from "../../repos/runtime-operation-queue-repo"
import * as SandboxInstanceRepo from "../../repos/sandbox-instance-repo"
import { sessionService } from "../store/store-singleton"
import { now, nextId } from "../../store/state-support"
import type { QuotaPolicy, User } from "../../types"

export async function requireQuotaForSessionCreate(input: {
  user: User
  projectId: string
}) {
  return requireQuota({
    user: input.user,
    projectId: input.projectId,
    action: "session_create",
  })
}

export async function requireQuotaForRuntimeOperation(input: {
  user: User
  projectId: string
  businessSessionId?: string
}) {
  return requireQuota({
    user: input.user,
    projectId: input.projectId,
    action: "runtime_operation",
    businessSessionId: input.businessSessionId,
  })
}

export async function listQuotaPolicies(input?: {
  tenantId?: string
  organizationId?: string
}) {
  return QuotaPolicyRepo.listQuotaPolicies(input)
}

export async function saveQuotaPolicy(input: {
  user: User
  tenantId: string
  organizationId: string
  scopeType: QuotaPolicy["scopeType"]
  scopeId: string
  enabled: boolean
  maxActiveSessions?: number
  maxQueuedOperations?: number
  maxRunningSandboxes?: number
  maxWarmPoolPerWorker?: number
}) {
  const timestamp = now()
  return QuotaPolicyRepo.upsertQuotaPolicy({
    id: nextId("quota"),
    tenantId: input.tenantId,
    organizationId: input.organizationId,
    scopeType: input.scopeType,
    scopeId: input.scopeId,
    enabled: input.enabled,
    maxActiveSessions: input.maxActiveSessions,
    maxQueuedOperations: input.maxQueuedOperations,
    maxRunningSandboxes: input.maxRunningSandboxes,
    maxWarmPoolPerWorker: input.maxWarmPoolPerWorker,
    createdAt: timestamp,
    updatedAt: timestamp,
    updatedBy: input.user.id,
  })
}

async function requireQuota(input: {
  user: User
  projectId: string
  action: "session_create" | "runtime_operation"
  businessSessionId?: string
}) {
  const quota = await resolveEffectiveQuota(input.user, input.projectId)
  if (!quota?.enabled) return { ok: true as const }

  const activeSessions = await countActiveSessions(input.user, input.projectId)
  if (quota.maxActiveSessions !== undefined && activeSessions >= quota.maxActiveSessions) {
    return { ok: false as const, reason: "quota_exceeded", message: "active session quota exceeded" }
  }

  const queuedOperations = await RuntimeOperationQueueRepo.countRuntimeOperationsByScope({
    tenantId: input.user.tenantId,
    organizationId: input.user.organizationId,
    projectId: input.projectId,
    userId: input.user.id,
    statuses: ["queued", "running"],
  })
  if (quota.maxQueuedOperations !== undefined && queuedOperations >= quota.maxQueuedOperations) {
    return { ok: false as const, reason: "quota_exceeded", message: "runtime operation quota exceeded" }
  }

  if (input.action === "runtime_operation") {
    const runningSandboxes = await countRunningSandboxes(input.user, input.projectId)
    if (quota.maxRunningSandboxes !== undefined && runningSandboxes >= quota.maxRunningSandboxes) {
      return { ok: false as const, reason: "quota_exceeded", message: "running sandbox quota exceeded" }
    }
  }

  return { ok: true as const, quota }
}

async function resolveEffectiveQuota(user: User, projectId: string) {
  const [projectQuota, userQuota, organizationQuota, tenantQuota] = await Promise.all([
    QuotaPolicyRepo.findQuotaPolicy({
      tenantId: user.tenantId,
      organizationId: user.organizationId,
      scopeType: "project",
      scopeId: projectId,
    }),
    QuotaPolicyRepo.findQuotaPolicy({
      tenantId: user.tenantId,
      organizationId: user.organizationId,
      scopeType: "user",
      scopeId: user.id,
    }),
    QuotaPolicyRepo.findQuotaPolicy({
      tenantId: user.tenantId,
      organizationId: user.organizationId,
      scopeType: "organization",
      scopeId: user.organizationId,
    }),
    QuotaPolicyRepo.findQuotaPolicy({
      tenantId: user.tenantId,
      organizationId: user.organizationId,
      scopeType: "tenant",
      scopeId: user.tenantId,
    }),
  ])
  return projectQuota || userQuota || organizationQuota || tenantQuota
}

async function countActiveSessions(user: User, projectId: string) {
  const sessions = await sessionService.listSessions()
  return sessions.filter((session) =>
    session.tenantId === user.tenantId &&
    session.organizationId === user.organizationId &&
    session.projectId === projectId &&
    session.createdBy === user.id &&
    (
      session.status === "created" ||
      session.status === "opening" ||
      session.status === "active" ||
      session.status === "waiting_input" ||
      session.status === "cancelling" ||
      session.status === "closing"
    ),
  ).length
}

async function countRunningSandboxes(user: User, projectId: string) {
  const sandboxes = await SandboxInstanceRepo.listSandboxInstances(500)
  return sandboxes.filter((sandbox) =>
    sandbox.tenantId === user.tenantId &&
    sandbox.organizationId === user.organizationId &&
    sandbox.projectId === projectId &&
    (
      sandbox.status === "preparing" ||
      sandbox.status === "ready" ||
      sandbox.status === "running"
    ),
  ).length
}
