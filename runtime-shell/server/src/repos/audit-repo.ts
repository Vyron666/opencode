import { now, nextId } from "../store/state-support"
import type { AuditAction, PersistedState } from "../types"
import { insertAuditLog, listAuditLogs } from "./state-repo"

export function listAllAuditLogs(state: PersistedState) {
  return listAuditLogs(state)
}

export function appendAuditLog(state: PersistedState, input: {
  tenantId: string
  organizationId: string
  userId?: string
  businessSessionId?: string
  requestId?: string
  action: AuditAction
  resourceType: "auth_session" | "workspace" | "business_session" | "provider_config"
  resourceId?: string
  detail: Record<string, unknown>
}) {
  return insertAuditLog(state, {
    id: nextId("audit"),
    tenantId: input.tenantId,
    organizationId: input.organizationId,
    userId: input.userId,
    businessSessionId: input.businessSessionId,
    requestId: input.requestId,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    detail: input.detail,
    createdAt: now(),
  })
}
