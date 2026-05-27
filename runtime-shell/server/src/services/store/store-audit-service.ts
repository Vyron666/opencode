import * as AuditRepo from "../../repos/audit-repo"
import type { AuditAction } from "../../types"
import type { PersistState, ReadState } from "./store-domain-support"

export class StoreAuditService {
  constructor(
    private readonly readState: ReadState,
    private readonly persist: PersistState,
  ) {}

  listAuditLogs() {
    return AuditRepo.listAllAuditLogs(this.readState())
  }

  async appendAuditLog(input: {
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
  }) {
    const auditLog = AuditRepo.appendAuditLog(this.readState(), input)
    await this.persist()
    return auditLog
  }
}
