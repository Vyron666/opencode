export type AuditAction =
  | "auth.login"
  | "auth.logout"
  | "workspace.register"
  | "workspace.create"
  | "workspace.share"
  | "workspace.unshare"
  | "session.create"
  | "session.open"
  | "session.close"
  | "session.prompt"
  | "session.cancel"
  | "sandbox.create"
  | "sandbox.close"
  | "sandbox.exit"
  | "sandbox.resource_exceeded"
  | "file.diff.generated"
  | "file.diff.applied"
  | "file.diff.rejected"
  | "policy.denied"
  | "provider.save"
  | "config.approval.create"
  | "config.approval.approve"
  | "config.approval.reject"

export type AuditResourceType =
  | "auth_session"
  | "workspace"
  | "workspace_share_binding"
  | "business_session"
  | "sandbox_instance"
  | "sandbox_diff"
  | "policy"
  | "provider_config"
  | "config_approval_request"

export type AuditLog = {
  id: string
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
  createdAt: string
}
