import { closeRuntime } from "../../acp-runtime-manager"
import { listProviderConfigs } from "../../provider-config"
import type { User } from "../../types"
import { authorizeSettingsAction } from "../access/authorization-service"
import { previewPlatformProviderImpact, previewUserPrivateProviderImpact } from "../config-impact/config-impact-service"
import {
  createMaskedProviderSummary,
  listVisibleProviderConfigs,
  removePlatformProviderConfig,
  removeUserPrivateProviderConfig,
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
    const affected = await previewPlatformProviderImpact({
      tenantId: input.user.tenantId,
      organizationId: input.user.organizationId,
      providerId: normalizedConfig.providerId,
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
    const affectedSessionIds = new Set(affected.affectedSessionIds)
    const affectedSessions = (await sessionService.listSessionsByFilter({
      tenantId: input.user.tenantId,
      organizationId: input.user.organizationId,
      statuses: ["active"],
    })).filter((session) => affectedSessionIds.has(session.id))
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
  const affectedSessionIds = new Set(affected.affectedSessionIds)
  const affectedSessions = (await sessionService.listSessionsByFilter({
    tenantId: input.user.tenantId,
    organizationId: input.user.organizationId,
    createdBy: input.user.id,
    statuses: ["active"],
  })).filter((session) => affectedSessionIds.has(session.id))
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

export async function removeProviderConfigForUser(input: {
  user: User
  requestId: string
  providerId: string
  source: "platform_shared" | "user_private"
}) {
  const authorization = authorizeSettingsAction({
    user: input.user,
    resource: "provider_config",
    action: "save",
  })
  if (!authorization.ok) return { ok: false as const, reason: "forbidden" }
  if (input.user.role !== "admin" && input.source === "platform_shared") {
    return { ok: false as const, reason: "forbidden" }
  }

  const deleted = input.source === "platform_shared"
    ? await removePlatformProviderConfig({
        user: input.user,
        requestId: input.requestId,
        providerId: input.providerId,
      })
    : await removeUserPrivateProviderConfig({
        user: input.user,
        requestId: input.requestId,
        providerId: input.providerId,
      })
  if (!deleted) {
    return { ok: false as const, reason: "provider_not_found" }
  }

  const affected = input.source === "platform_shared"
    ? await previewPlatformProviderImpact({
        tenantId: input.user.tenantId,
        organizationId: input.user.organizationId,
        providerId: input.providerId,
      })
    : await previewUserPrivateProviderImpact({
        tenantId: input.user.tenantId,
        organizationId: input.user.organizationId,
      userId: input.user.id,
      providerId: input.providerId,
    })
  const affectedSessionIds = new Set(affected.affectedSessionIds)
  const affectedSessions = (await sessionService.listSessionsByFilter({
    tenantId: input.user.tenantId,
    organizationId: input.user.organizationId,
    ...(input.source === "platform_shared" ? {} : { createdBy: input.user.id }),
    statuses: ["active"],
  })).filter((session) => affectedSessionIds.has(session.id))
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
    action: "provider.delete",
    resourceType: "provider_config",
    resourceId: input.providerId,
    detail: {
      source: input.source,
      reloadedSessionCount: affectedSessions.length,
      affectedSessionIds: affected.affectedSessionIds,
    },
  })
  return {
    ok: true as const,
    success: true,
    providerId: input.providerId,
    reloadedSessionCount: affectedSessions.length,
  }
}
