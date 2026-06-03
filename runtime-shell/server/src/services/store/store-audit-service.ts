import * as AuditDbRepo from "../../repos/audit-db-repo"
import type { AuditAction, AuditResourceType } from "../../types"

export class StoreAuditService {
  listAuditLogs() {
    return AuditDbRepo.listAuditLogs()
  }

  async appendAuditLog(input: {
    tenantId: string
    organizationId: string
    projectId?: string
    userId?: string
    businessSessionId?: string
    requestId?: string
    action: AuditAction
    resourceType: AuditResourceType
    resourceId?: string
    detail: Record<string, unknown>
  }) {
    return AuditDbRepo.appendAuditLog({
      ...input,
      // 中文/English: audit must keep troubleshooting context, but obvious secrets
      // should never be written to the persistent audit table in plain text.
      detail: sanitizeAuditDetail(input.detail),
    })
  }
}

const SENSITIVE_AUDIT_KEYS = new Set([
  "apikey",
  "token",
  "authorization",
  "password",
  "secret",
  "cookie",
  "sessionsecret",
  "accesstoken",
  "refreshtoken",
])

function sanitizeAuditDetail(detail: Record<string, unknown>) {
  return sanitizeAuditValue(detail) as Record<string, unknown>
}

function sanitizeAuditValue(value: unknown, key = ""): unknown {
  const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, "")
  if (normalizedKey && SENSITIVE_AUDIT_KEYS.has(normalizedKey)) {
    return maskAuditSecret(value)
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeAuditValue(item))
  }
  if (!value || typeof value !== "object") {
    return value
  }
  return Object.fromEntries(
    Object.entries(value).map(([nextKey, nextValue]) => [
      nextKey,
      sanitizeAuditValue(nextValue, nextKey),
    ]),
  )
}

function maskAuditSecret(value: unknown) {
  if (typeof value !== "string") return "***"
  if (value.length <= 8) return "********"
  return `${value.slice(0, 4)}****${value.slice(-4)}`
}
