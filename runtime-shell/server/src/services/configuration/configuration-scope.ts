import type { ConfigScopeLevel, User } from "../../types"

export type ConfigScope = {
  tenantId: string
  organizationId: string
  scopeLevel: ConfigScopeLevel
  scopeId: string
}

export function platformSharedScope(user: User): ConfigScope {
  return {
    tenantId: user.tenantId,
    organizationId: user.organizationId,
    scopeLevel: "platform",
    scopeId: "platform_shared",
  }
}

export function userPrivateScope(user: User): ConfigScope {
  return {
    tenantId: user.tenantId,
    organizationId: user.organizationId,
    // 中文/English: user-private settings must be stored with explicit user scope semantics
    // so audit, query, and future governance do not misclassify them as session config.
    scopeLevel: "user",
    scopeId: user.id,
  }
}
