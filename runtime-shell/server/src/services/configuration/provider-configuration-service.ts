import { listProviderConfigs, type RuntimeShellProviderConfig, type RuntimeShellStoredProviderConfig } from "../../provider-config"
import * as ConfigRepo from "../../repos/config-repo"
import type { ConfigNamespace, ConfigSource, User } from "../../types"
import { platformSharedScope, userPrivateScope } from "./configuration-scope"

export type SourcedProviderConfig = RuntimeShellProviderConfig & {
  source: ConfigSource
}

export async function listPlatformProviderConfigs(user: User) {
  const scope = platformSharedScope(user)
  const items = await ConfigRepo.listConfigItems({
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    scopeLevel: scope.scopeLevel,
    scopeId: scope.scopeId,
    namespace: "provider",
  })
  return items
    .map((item) => item.valueJson)
    .filter((value): value is RuntimeShellStoredProviderConfig => isStoredProviderConfig(value))
    .map((value) => ({
      ...toVisibleProviderConfig(value),
      source: "platform_shared" as const,
    }))
}

export async function listUserPrivateProviderConfigs(user: User) {
  const scope = userPrivateScope(user)
  const items = await ConfigRepo.listConfigItems({
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    scopeLevel: scope.scopeLevel,
    scopeId: scope.scopeId,
    namespace: "provider",
  })
  return items
    .map((item) => item.valueJson)
    .filter((value): value is RuntimeShellStoredProviderConfig => isStoredProviderConfig(value))
    .map((value) => ({
      ...toVisibleProviderConfig(value),
      source: "user_private" as const,
    }))
}

export async function listUserPrivateStoredProviderConfigs(user: User) {
  const scope = userPrivateScope(user)
  const items = await ConfigRepo.listConfigItems({
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    scopeLevel: scope.scopeLevel,
    scopeId: scope.scopeId,
    namespace: "provider",
  })
  return items
    .map((item) => item.valueJson)
    .filter((value): value is RuntimeShellStoredProviderConfig => isStoredProviderConfig(value))
}

export async function listPlatformStoredProviderConfigs(user: User) {
  const scope = platformSharedScope(user)
  const items = await ConfigRepo.listConfigItems({
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    scopeLevel: scope.scopeLevel,
    scopeId: scope.scopeId,
    namespace: "provider",
  })
  return items
    .map((item) => item.valueJson)
    .filter((value): value is RuntimeShellStoredProviderConfig => isStoredProviderConfig(value))
}

export async function listVisibleStoredProviderConfigs(user: User) {
  const [platformProviders, privateProviders] = await Promise.all([
    listPlatformStoredProviderConfigs(user),
    listUserPrivateStoredProviderConfigs(user),
  ])
  const platformIds = new Set(platformProviders.map((item) => item.providerId))
  return [
    ...platformProviders,
    ...privateProviders.filter((item) => !platformIds.has(item.providerId)),
  ]
}

export async function listVisibleProviderConfigs(user: User) {
  const [platformProviders, privateProviders] = await Promise.all([
    listReservedPlatformProviderConfigs(user),
    listUserPrivateProviderConfigs(user),
  ])
  const platformIds = new Set(platformProviders.map((item) => item.providerId))
  return [
    ...platformProviders,
    ...privateProviders.filter((item) => !platformIds.has(item.providerId)),
  ]
}

export async function listReservedPlatformProviderConfigs(user: User) {
  const [savedPlatformProviders, builtinProviders] = await Promise.all([
    listPlatformProviderConfigs(user),
    listProviderConfigs(),
  ])
  const savedIds = new Set(savedPlatformProviders.map((item) => item.providerId))
  return [
    ...savedPlatformProviders,
    ...builtinProviders
      .filter((item) => !savedIds.has(item.providerId))
      .map((item) => ({
        ...item,
        source: "platform_shared" as const,
      })),
  ]
}

export async function savePlatformProviderConfig(input: {
  user: User
  requestId: string
  config: RuntimeShellProviderConfig
  summaryJson: Record<string, unknown>
}) {
  const scope = platformSharedScope(input.user)
  const result = await ConfigRepo.upsertConfigItem({
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    scopeLevel: scope.scopeLevel,
    scopeId: scope.scopeId,
    namespace: "provider",
    configKey: input.config.providerId,
    valueJson: input.config,
    updatedBy: input.user.id,
  })
  await ConfigRepo.appendConfigChangeLog({
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    requestId: input.requestId,
    scopeLevel: scope.scopeLevel,
    scopeId: scope.scopeId,
    namespace: "provider",
    configKey: input.config.providerId,
    changeType: result.previous ? "update" : "create",
    previousVersion: result.previous?.version,
    nextVersion: result.current.version,
    summaryJson: {
      ...input.summaryJson,
      source: "platform_shared",
    },
    createdBy: input.user.id,
  })
  return result.current
}

export async function saveUserPrivateProviderConfig(input: {
  user: User
  requestId: string
  config: RuntimeShellProviderConfig
  summaryJson: Record<string, unknown>
}) {
  const platformProviders = await listReservedPlatformProviderConfigs(input.user)
  const platformIds = new Set(platformProviders.map((item) => item.providerId))
  if (platformIds.has(input.config.providerId)) {
    return {
      ok: false as const,
      reason: "conflict_with_platform_shared",
      providerId: input.config.providerId,
    }
  }

  const scope = userPrivateScope(input.user)
  const result = await ConfigRepo.upsertConfigItem({
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    scopeLevel: scope.scopeLevel,
    scopeId: scope.scopeId,
    namespace: "provider",
    configKey: input.config.providerId,
    valueJson: input.config,
    updatedBy: input.user.id,
  })
  await ConfigRepo.appendConfigChangeLog({
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    requestId: input.requestId,
    scopeLevel: scope.scopeLevel,
    scopeId: scope.scopeId,
    namespace: "provider",
    configKey: input.config.providerId,
    changeType: result.previous ? "update" : "create",
    previousVersion: result.previous?.version,
    nextVersion: result.current.version,
    summaryJson: {
      ...input.summaryJson,
      source: "user_private",
    },
    createdBy: input.user.id,
  })
  return {
    ok: true as const,
    current: result.current,
  }
}

export async function removePlatformProviderConfig(input: {
  user: User
  requestId: string
  providerId: string
}) {
  const scope = platformSharedScope(input.user)
  const deleted = await ConfigRepo.deleteConfigItem({
    scopeLevel: scope.scopeLevel,
    scopeId: scope.scopeId,
    namespace: "provider",
    configKey: input.providerId,
    deletedBy: input.user.id,
  })
  if (!deleted) return
  await ConfigRepo.appendConfigChangeLog({
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    requestId: input.requestId,
    scopeLevel: scope.scopeLevel,
    scopeId: scope.scopeId,
    namespace: "provider",
    configKey: input.providerId,
    changeType: "delete",
    previousVersion: deleted.previous.version,
    nextVersion: deleted.nextVersion,
    summaryJson: {
      namespace: "provider" satisfies ConfigNamespace,
      providerId: input.providerId,
      source: "platform_shared",
    },
    createdBy: input.user.id,
  })
  return deleted
}

export async function removeUserPrivateProviderConfig(input: {
  user: User
  requestId: string
  providerId: string
}) {
  const scope = userPrivateScope(input.user)
  const deleted = await ConfigRepo.deleteConfigItem({
    scopeLevel: scope.scopeLevel,
    scopeId: scope.scopeId,
    namespace: "provider",
    configKey: input.providerId,
    deletedBy: input.user.id,
  })
  if (!deleted) return
  await ConfigRepo.appendConfigChangeLog({
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    requestId: input.requestId,
    scopeLevel: scope.scopeLevel,
    scopeId: scope.scopeId,
    namespace: "provider",
    configKey: input.providerId,
    changeType: "delete",
    previousVersion: deleted.previous.version,
    nextVersion: deleted.nextVersion,
    summaryJson: {
      namespace: "provider" satisfies ConfigNamespace,
      providerId: input.providerId,
      source: "user_private",
    },
    createdBy: input.user.id,
  })
  return deleted
}

export function createMaskedProviderSummary(config: RuntimeShellProviderConfig) {
  return {
    namespace: "provider" satisfies ConfigNamespace,
    providerId: config.providerId,
    modelCount: config.models.length,
    defaultModel: config.defaultModel,
    apiKeyConfigured: config.apiKeyConfigured,
  }
}

function isStoredProviderConfig(value: unknown): value is RuntimeShellStoredProviderConfig {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as RuntimeShellStoredProviderConfig).providerId === "string" &&
      Array.isArray((value as RuntimeShellStoredProviderConfig).models),
  )
}

function toVisibleProviderConfig(value: RuntimeShellStoredProviderConfig): RuntimeShellProviderConfig {
  return {
    providerId: value.providerId,
    name: value.name,
    ...(value.npm ? { npm: value.npm } : {}),
    api: value.api,
    baseURL: value.baseURL,
    apiKeyMasked: value.apiKeyMasked,
    apiKeyConfigured: value.apiKeyConfigured,
    defaultModel: value.defaultModel,
    models: value.models,
  }
}
