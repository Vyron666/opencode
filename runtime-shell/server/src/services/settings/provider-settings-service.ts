import { closeRuntime } from "../../acp-runtime-manager"
import { listProviderConfigs, saveProviderConfig } from "../../provider-config"
import type { User } from "../../types"
import { authorizeSettingsAction } from "../access/authorization-service"
import { previewPlatformProviderImpact, previewUserPrivateProviderImpact } from "../config-impact/config-impact-service"
import {
  createMaskedProviderSummary,
  listVisibleProviderConfigs,
  resolveSettingsSnapshot,
  savePlatformProviderConfig,
  saveUserPrivateProviderConfig,
} from "../configuration/configuration-service"
import { resetSessionRuntime } from "../session/session-lifecycle-service"
import { markSessionCreated } from "../session/session-status-machine-service"
import { auditService, sessionService } from "../store/store-singleton"
import { maskApiKey, type ProviderConfigInput } from "./settings-support"

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

export async function saveProviderConfigForUser(input: {
  user: User
  requestId: string
  config: ProviderConfigInput
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
  void auditService.appendAuditLog({
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
  return {
    ok: true as const,
    success: true,
    approvalRequired: false,
    approval: undefined,
    providerId: normalizedConfig.providerId,
    reloadedSessionCount: affectedSessions.length,
  }
}
