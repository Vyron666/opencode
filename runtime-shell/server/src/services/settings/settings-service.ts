import { closeRuntime, getRuntime } from "../../acp-runtime-manager"
import { listProviderConfigs, saveProviderConfig } from "../../provider-config"
import type { User, UserMcpConfig, UserSkillConfig } from "../../types"
import { authorizeSettingsAction } from "../access/authorization-service"
import {
  createMaskedProviderSummary,
  getVisibleSkillConfig,
  listVisibleMcpServers,
  listVisibleProviderConfigs,
  listVisibleProviderConfigs as listProviderConfigsForPreview,
  resolveSettingsSnapshot,
  savePlatformMcpServers,
  savePlatformProviderConfig,
  savePlatformSkillConfig,
  saveUserPrivateMcpServers,
  saveUserPrivateProviderConfig,
  saveUserPrivateSkillConfig,
} from "../configuration/configuration-service"
import { previewConfigImpact, previewPlatformProviderImpact, previewUserPrivateProviderImpact } from "../config-impact/config-impact-service"
import { resetSessionRuntime } from "../session/session-lifecycle-service"
import { markSessionCreated } from "../session/session-status-machine-service"
import { auditService, sessionService } from "../store/store-singleton"

export async function listProviderConfigsForUser(user: User) {
  const authorization = authorizeSettingsAction({
    user,
    resource: "provider_config",
    action: "list",
  })
  if (!authorization.ok) return { ok: false as const, reason: "forbidden" }
  const configured = await listVisibleProviderConfigs(user)
  if (configured.length > 0) {
    return {
      ok: true as const,
      items: configured,
    }
  }
  return {
    ok: true as const,
    items: await listProviderConfigs(),
  }
}

export async function listMcpConfigsForUser(user: User) {
  const authorization = authorizeSettingsAction({
    user,
    resource: "mcp_config",
    action: "list",
  })
  if (!authorization.ok) return { ok: false as const, reason: "forbidden" }
  return {
    ok: true as const,
    items: await listVisibleMcpServers(user),
  }
}

export async function saveMcpConfigsForUser(input: {
  user: User
  requestId: string
  servers: Record<string, UserMcpConfig>
}) {
  const authorization = authorizeSettingsAction({
    user: input.user,
    resource: "mcp_config",
    action: "save",
  })
  if (!authorization.ok) return { ok: false as const, reason: "forbidden" }
  if (input.user.role === "admin") {
    await savePlatformMcpServers({
      user: input.user,
      requestId: input.requestId,
      servers: input.servers,
      summaryJson: {
        namespace: "mcp",
        serverCount: Object.keys(input.servers).length,
      },
    })
  } else {
    const saved = await saveUserPrivateMcpServers({
      user: input.user,
      requestId: input.requestId,
      servers: input.servers,
      summaryJson: {
        namespace: "mcp",
        serverCount: Object.keys(input.servers).length,
      },
    })
    if (!saved.ok) {
      return {
        ok: false as const,
        reason: "conflict_with_platform_shared",
        name: saved.name,
      }
    }
  }
  return {
    ok: true as const,
    success: true,
    approvalRequired: false,
    approval: undefined,
    count: Object.keys(input.servers).length,
  }
}

export async function listSkillConfigForUser(user: User) {
  const authorization = authorizeSettingsAction({
    user,
    resource: "skill_config",
    action: "list",
  })
  if (!authorization.ok) return { ok: false as const, reason: "forbidden" }
  return {
    ok: true as const,
    config: await getVisibleSkillConfig(user),
  }
}

export async function saveSkillConfigForUser(input: {
  user: User
  requestId: string
  config: UserSkillConfig
}) {
  const authorization = authorizeSettingsAction({
    user: input.user,
    resource: "skill_config",
    action: "save",
  })
  if (!authorization.ok) return { ok: false as const, reason: "forbidden" }
  if (input.user.role === "admin") {
    await savePlatformSkillConfig({
      user: input.user,
      requestId: input.requestId,
      config: input.config,
      summaryJson: {
        namespace: "skill",
        pathCount: input.config.paths?.length ?? 0,
        urlCount: input.config.urls?.length ?? 0,
      },
    })
  } else {
    await saveUserPrivateSkillConfig({
      user: input.user,
      requestId: input.requestId,
      config: input.config,
      summaryJson: {
        namespace: "skill",
        pathCount: input.config.paths?.length ?? 0,
        urlCount: input.config.urls?.length ?? 0,
      },
    })
  }
  return {
    ok: true as const,
    success: true,
    approvalRequired: false,
    approval: undefined,
  }
}

export async function saveProviderConfigForUser(input: {
  user: User
  requestId: string
  config: {
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
  }
}) {
  const authorization = authorizeSettingsAction({
    user: input.user,
    resource: "provider_config",
    action: "save",
  })
  if (!authorization.ok) return { ok: false as const, reason: "forbidden" }

  const snapshotBeforeSave = await resolveSettingsSnapshot(input.user)
  const normalizedConfig = {
    ...input.config,
    ...(input.config.apiKey?.trim() ? { apiKey: input.config.apiKey.trim() } : {}),
    apiKeyMasked: maskApiKey(input.config.apiKey),
    apiKeyConfigured: Boolean(input.config.apiKey?.trim()),
  }

  if (input.user.role === "admin") {
    const saved = await saveProviderConfig(input.config)
    const affected = await previewPlatformProviderImpact({
      tenantId: input.user.tenantId,
      organizationId: input.user.organizationId,
      providerId: saved.providerId,
    })
    await savePlatformProviderConfig({
      user: input.user,
      requestId: input.requestId,
      config: normalizedConfig,
      summaryJson: {
        ...createMaskedProviderSummary(normalizedConfig),
        previousProviderCount: snapshotBeforeSave.providerConfigs.length,
        affectedSessionIds: affected.affectedSessionIds,
        affectedWorkerIds: affected.affectedWorkerIds,
      },
    })
    const affectedSessions = (await sessionService.listSessions()).filter((session) =>
      affected.affectedSessionIds.includes(session.id),
    )
    for (const session of affectedSessions) {
      await closeRuntime(session.id)
      await markSessionCreated(session.id)
      await resetSessionRuntime(session.id, "created")
    }
    void auditService.appendAuditLog({
      tenantId: input.user.tenantId,
      organizationId: input.user.organizationId,
      userId: input.user.id,
      requestId: input.requestId,
      action: "provider.save",
      resourceType: "provider_config",
      resourceId: saved.providerId,
      detail: {
        reloadedSessionCount: affectedSessions.length,
      },
    })
    return {
      ok: true as const,
      success: true,
      approvalRequired: false,
      approval: undefined,
      providerId: saved.providerId,
      reloadedSessionCount: affectedSessions.length,
    }
  }

  const saved = await saveUserPrivateProviderConfig({
    user: input.user,
    requestId: input.requestId,
    config: normalizedConfig,
    summaryJson: {
      ...createMaskedProviderSummary(normalizedConfig),
      previousProviderCount: snapshotBeforeSave.providerConfigs.length,
    },
  })
  if (!saved.ok) {
    return {
      ok: false as const,
      reason: "conflict_with_platform_shared",
      providerId: saved.providerId,
    }
  }

  const affected = await previewUserPrivateProviderImpact({
    tenantId: input.user.tenantId,
    organizationId: input.user.organizationId,
    userId: input.user.id,
    providerId: normalizedConfig.providerId,
  })
  const affectedSessions = (await sessionService.listSessions()).filter((session) =>
    affected.affectedSessionIds.includes(session.id),
  )
  for (const session of affectedSessions) {
    await closeRuntime(session.id)
    await markSessionCreated(session.id)
    await resetSessionRuntime(session.id, "created")
  }
  const auditLogTask = auditService.appendAuditLog({
    tenantId: input.user.tenantId,
    organizationId: input.user.organizationId,
    userId: input.user.id,
    requestId: input.requestId,
    action: "provider.save",
    resourceType: "provider_config",
    resourceId: normalizedConfig.providerId,
    detail: {
      reloadedSessionCount: affectedSessions.length,
      affectedSessionIds: affected.affectedSessionIds,
    },
  })
  void auditLogTask
  return {
    ok: true as const,
    success: true,
    approvalRequired: false,
    approval: undefined,
    providerId: normalizedConfig.providerId,
    reloadedSessionCount: affectedSessions.length,
  }
}

export async function previewConfigImpactForUser(input: {
  user: User
  namespace: "provider" | "mcp" | "skill"
  targetId?: string
}) {
  const resource =
    input.namespace === "provider"
      ? "provider_config"
      : input.namespace === "mcp"
        ? "mcp_config"
        : "skill_config"
  const authorization = authorizeSettingsAction({
    user: input.user,
    resource,
    action: "list",
  })
  if (!authorization.ok) return { ok: false as const, reason: "forbidden" }
  if (input.namespace === "provider" && input.targetId) {
    const visibleProviders = await listProviderConfigsForPreview(input.user)
    const exists = visibleProviders.some((item) => item.providerId === input.targetId)
    if (!exists && input.user.role === "developer") {
      return { ok: false as const, reason: "forbidden" }
    }
  }
  const preview = await previewConfigImpact(input)
  return {
    ok: true as const,
    preview,
  }
}

export async function applyApprovedPlatformProviderConfig(input: {
  user: User
  requestId: string
  config: {
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
  }
}) {
  const snapshotBeforeSave = await resolveSettingsSnapshot(input.user)
  const normalizedConfig = {
    ...input.config,
    ...(input.config.apiKey?.trim() ? { apiKey: input.config.apiKey.trim() } : {}),
    apiKeyMasked: maskApiKey(input.config.apiKey),
    apiKeyConfigured: Boolean(input.config.apiKey?.trim()),
  }
  const saved = await saveProviderConfig(input.config)
  const affected = await previewPlatformProviderImpact({
    tenantId: input.user.tenantId,
    organizationId: input.user.organizationId,
    providerId: saved.providerId,
  })
  await savePlatformProviderConfig({
    user: input.user,
    requestId: input.requestId,
    config: normalizedConfig,
    summaryJson: {
      ...createMaskedProviderSummary(normalizedConfig),
      previousProviderCount: snapshotBeforeSave.providerConfigs.length,
      affectedSessionIds: affected.affectedSessionIds,
      affectedWorkerIds: affected.affectedWorkerIds,
    },
  })
  const affectedSessions = (await sessionService.listSessions()).filter((session) =>
    affected.affectedSessionIds.includes(session.id),
  )
  for (const session of affectedSessions) {
    await closeRuntime(session.id)
    await markSessionCreated(session.id)
    await resetSessionRuntime(session.id, "created")
  }
  void auditService.appendAuditLog({
    tenantId: input.user.tenantId,
    organizationId: input.user.organizationId,
    userId: input.user.id,
    requestId: input.requestId,
    action: "provider.save",
    resourceType: "provider_config",
    resourceId: saved.providerId,
    detail: {
      reloadedSessionCount: affectedSessions.length,
      approvalApplied: true,
    },
  })
  return {
    providerId: saved.providerId,
    reloadedSessionCount: affectedSessions.length,
  }
}

export async function applyApprovedPlatformMcpConfig(input: {
  user: User
  requestId: string
  servers: Record<string, UserMcpConfig>
}) {
  await savePlatformMcpServers({
    user: input.user,
    requestId: input.requestId,
    servers: input.servers,
    summaryJson: {
      namespace: "mcp",
      serverCount: Object.keys(input.servers).length,
      approvalApplied: true,
    },
  })
  return {
    count: Object.keys(input.servers).length,
  }
}

export async function applyApprovedPlatformSkillConfig(input: {
  user: User
  requestId: string
  config: UserSkillConfig
}) {
  await savePlatformSkillConfig({
    user: input.user,
    requestId: input.requestId,
    config: input.config,
    summaryJson: {
      namespace: "skill",
      pathCount: input.config.paths?.length ?? 0,
      urlCount: input.config.urls?.length ?? 0,
      approvalApplied: true,
    },
  })
  return {
    pathCount: input.config.paths?.length ?? 0,
    urlCount: input.config.urls?.length ?? 0,
  }
}

function maskApiKey(secret?: string) {
  if (!secret) return ""
  if (secret.length <= 8) return "********"
  return `${secret.slice(0, 4)}****${secret.slice(-4)}`
}
