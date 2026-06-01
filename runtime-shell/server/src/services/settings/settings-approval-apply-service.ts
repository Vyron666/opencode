import { closeRuntime } from "../../acp-runtime-manager"
import { saveProviderConfig } from "../../provider-config"
import type { User, UserMcpConfig, UserSkillConfig } from "../../types"
import { previewPlatformProviderImpact } from "../config-impact/config-impact-service"
import {
  createMaskedProviderSummary,
  resolveSettingsSnapshot,
  savePlatformMcpServers,
  savePlatformProviderConfig,
  savePlatformSkillConfig,
} from "../configuration/configuration-service"
import { resetSessionRuntime } from "../session/session-lifecycle-service"
import { markSessionCreated } from "../session/session-status-machine-service"
import { auditService, sessionService } from "../store/store-singleton"
import { maskApiKey, type ProviderConfigInput } from "./settings-support"

export async function applyApprovedPlatformProviderConfig(input: {
  user: User
  requestId: string
  config: ProviderConfigInput
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
