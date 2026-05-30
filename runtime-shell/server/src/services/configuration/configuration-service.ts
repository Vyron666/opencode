import type { RuntimeShellProviderConfig, RuntimeShellStoredProviderConfig } from "../../provider-config"
import * as ConfigRepo from "../../repos/config-repo"
import type { ConfigNamespace, ConfigScopeLevel, ConfigSource, User, UserMcpConfig, UserSkillConfig } from "../../types"

export type SourcedProviderConfig = RuntimeShellProviderConfig & {
  source: ConfigSource
}

export type SourcedMcpConfig = UserMcpConfig & {
  name: string
  source: ConfigSource
}

type ConfigScope = {
  tenantId: string
  organizationId: string
  scopeLevel: ConfigScopeLevel
  scopeId: string
}

function platformSharedScope(user: User): ConfigScope {
  return {
    tenantId: user.tenantId,
    organizationId: user.organizationId,
    scopeLevel: "platform",
    scopeId: "platform_shared",
  }
}

function userPrivateScope(user: User): ConfigScope {
  return {
    tenantId: user.tenantId,
    organizationId: user.organizationId,
    // 中文/English: user-private settings must be stored with explicit user scope semantics
    // so audit, query, and future governance do not misclassify them as session config.
    scopeLevel: "user",
    scopeId: user.id,
  }
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

async function listUserPrivateStoredProviderConfigs(user: User) {
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

export async function listVisibleProviderConfigs(user: User) {
  const [platformProviders, privateProviders] = await Promise.all([
    listPlatformProviderConfigs(user),
    listUserPrivateProviderConfigs(user),
  ])
  const platformIds = new Set(platformProviders.map((item) => item.providerId))
  return [
    ...platformProviders,
    ...privateProviders.filter((item) => !platformIds.has(item.providerId)),
  ]
}

export async function listVisibleMcpServers(user: User) {
  const [platformServers, privateServers] = await Promise.all([
    listPlatformMcpServers(user),
    listUserPrivateMcpServers(user),
  ])
  const platformNames = new Set(platformServers.map((item) => item.name))
  return [
    ...platformServers,
    ...privateServers.filter((item) => !platformNames.has(item.name)),
  ]
}

export async function listPlatformMcpServers(user: User) {
  const scope = platformSharedScope(user)
  const item = await ConfigRepo.findConfigItem({
    scopeLevel: scope.scopeLevel,
    scopeId: scope.scopeId,
    namespace: "mcp",
    configKey: "servers",
  })
  return readMcpConfigMap(item?.valueJson, "platform_shared")
}

export async function listUserPrivateMcpServers(user: User) {
  const scope = userPrivateScope(user)
  const item = await ConfigRepo.findConfigItem({
    scopeLevel: scope.scopeLevel,
    scopeId: scope.scopeId,
    namespace: "mcp",
    configKey: "servers",
  })
  return readMcpConfigMap(item?.valueJson, "user_private")
}

export async function getVisibleSkillConfig(user: User) {
  const [platformSkills, privateSkills] = await Promise.all([
    getPlatformSkillConfig(user),
    getUserPrivateSkillConfig(user),
  ])
  return {
    paths: [...new Set([...(platformSkills.paths ?? []), ...(privateSkills.paths ?? [])])],
    urls: [...new Set([...(platformSkills.urls ?? []), ...(privateSkills.urls ?? [])])],
  }
}

export async function getPlatformSkillConfig(user: User) {
  const scope = platformSharedScope(user)
  const item = await ConfigRepo.findConfigItem({
    scopeLevel: scope.scopeLevel,
    scopeId: scope.scopeId,
    namespace: "skill",
    configKey: "paths",
  })
  return normalizeSkillConfig(item?.valueJson)
}

export async function getUserPrivateSkillConfig(user: User) {
  const scope = userPrivateScope(user)
  const item = await ConfigRepo.findConfigItem({
    scopeLevel: scope.scopeLevel,
    scopeId: scope.scopeId,
    namespace: "skill",
    configKey: "paths",
  })
  return normalizeSkillConfig(item?.valueJson)
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
  const platformProviders = await listPlatformProviderConfigs(input.user)
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

export async function savePlatformMcpServers(input: {
  user: User
  requestId: string
  servers: Record<string, UserMcpConfig>
  summaryJson: Record<string, unknown>
}) {
  const scope = platformSharedScope(input.user)
  const result = await ConfigRepo.upsertConfigItem({
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    scopeLevel: scope.scopeLevel,
    scopeId: scope.scopeId,
    namespace: "mcp",
    configKey: "servers",
    valueJson: input.servers,
    updatedBy: input.user.id,
  })
  await ConfigRepo.appendConfigChangeLog({
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    requestId: input.requestId,
    scopeLevel: scope.scopeLevel,
    scopeId: scope.scopeId,
    namespace: "mcp",
    configKey: "servers",
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

export async function saveUserPrivateMcpServers(input: {
  user: User
  requestId: string
  servers: Record<string, UserMcpConfig>
  summaryJson: Record<string, unknown>
}) {
  const platformServers = await listPlatformMcpServers(input.user)
  const platformNames = new Set(platformServers.map((item) => item.name))
  const conflictedName = Object.keys(input.servers).find((name) => platformNames.has(name))
  if (conflictedName) {
    return {
      ok: false as const,
      reason: "conflict_with_platform_shared",
      name: conflictedName,
    }
  }

  const scope = userPrivateScope(input.user)
  const result = await ConfigRepo.upsertConfigItem({
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    scopeLevel: scope.scopeLevel,
    scopeId: scope.scopeId,
    namespace: "mcp",
    configKey: "servers",
    valueJson: input.servers,
    updatedBy: input.user.id,
  })
  await ConfigRepo.appendConfigChangeLog({
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    requestId: input.requestId,
    scopeLevel: scope.scopeLevel,
    scopeId: scope.scopeId,
    namespace: "mcp",
    configKey: "servers",
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

export async function savePlatformSkillConfig(input: {
  user: User
  requestId: string
  config: UserSkillConfig
  summaryJson: Record<string, unknown>
}) {
  const scope = platformSharedScope(input.user)
  const result = await ConfigRepo.upsertConfigItem({
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    scopeLevel: scope.scopeLevel,
    scopeId: scope.scopeId,
    namespace: "skill",
    configKey: "paths",
    valueJson: configToStableSkillValue(input.config),
    updatedBy: input.user.id,
  })
  await ConfigRepo.appendConfigChangeLog({
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    requestId: input.requestId,
    scopeLevel: scope.scopeLevel,
    scopeId: scope.scopeId,
    namespace: "skill",
    configKey: "paths",
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

export async function saveUserPrivateSkillConfig(input: {
  user: User
  requestId: string
  config: UserSkillConfig
  summaryJson: Record<string, unknown>
}) {
  const scope = userPrivateScope(input.user)
  const result = await ConfigRepo.upsertConfigItem({
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    scopeLevel: scope.scopeLevel,
    scopeId: scope.scopeId,
    namespace: "skill",
    configKey: "paths",
    valueJson: configToStableSkillValue(input.config),
    updatedBy: input.user.id,
  })
  await ConfigRepo.appendConfigChangeLog({
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    requestId: input.requestId,
    scopeLevel: scope.scopeLevel,
    scopeId: scope.scopeId,
    namespace: "skill",
    configKey: "paths",
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

export async function resolveSettingsSnapshot(user: User) {
  const [providerConfigs, mcpServers, skills] = await Promise.all([
    listVisibleProviderConfigs(user),
    listVisibleMcpServers(user),
    getVisibleSkillConfig(user),
  ])
  return {
    providerConfigs,
    mcpServers,
    skills,
  }
}

export async function buildSessionConfigOverride(user: User) {
  const [providers, mcpServers, skills] = await Promise.all([
    listUserPrivateStoredProviderConfigs(user),
    listVisibleMcpServers(user),
    getVisibleSkillConfig(user),
  ])

  return {
    ...(providers.length
      ? {
          provider: Object.fromEntries(
            providers.map((provider) => [
              provider.providerId,
              {
                name: provider.name,
                api: provider.api,
                ...(provider.npm ? { npm: provider.npm } : {}),
                options: {
                  baseURL: provider.baseURL,
                  ...(provider.apiKey?.trim() ? { apiKey: provider.apiKey.trim() } : {}),
                },
                models: Object.fromEntries(
                  provider.models.map((model) => [
                    model.id,
                    {
                      name: model.name,
                      ...(model.api ? { api: model.api } : {}),
                    },
                  ]),
                ),
              },
            ]),
          ),
          enabled_providers: providers.map((provider) => provider.providerId),
          model: providers[0]?.defaultModel,
        }
      : {}),
    ...(skills.paths?.length || skills.urls?.length
      ? {
          skills: {
            ...(skills.paths?.length ? { paths: skills.paths } : {}),
            ...(skills.urls?.length ? { urls: skills.urls } : {}),
          },
        }
      : {}),
    ...(mcpServers.length
      ? {
          mcp: Object.fromEntries(
            mcpServers.map((server) => [
              server.name,
              {
                ...(server.type === "local"
                  ? {
                      type: "local",
                      command: server.command ?? [],
                    }
                  : {
                      type: "remote",
                      url: server.url ?? "",
                    }),
                ...(server.enabled === undefined ? {} : { enabled: server.enabled }),
                ...(server.timeout === undefined ? {} : { timeout: server.timeout }),
                ...(server.headers ? { headers: server.headers } : {}),
              },
            ]),
          ),
        }
      : {}),
  }
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

function readMcpConfigMap(value: unknown, source: ConfigSource) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return []
  return Object.entries(value)
    .flatMap(([name, config]) => {
      if (!isMcpConfig(config)) return []
      return [{
        name,
        ...config,
        source,
      } satisfies SourcedMcpConfig]
    })
}

function normalizeSkillConfig(value: unknown): UserSkillConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  const record = value as Record<string, unknown>
  return {
    paths: Array.isArray(record.paths) ? record.paths.filter((item): item is string => typeof item === "string") : [],
    urls: Array.isArray(record.urls) ? record.urls.filter((item): item is string => typeof item === "string") : [],
  }
}

function configToStableSkillValue(value: UserSkillConfig) {
  return {
    paths: [...new Set((value.paths ?? []).filter((item) => item))],
    urls: [...new Set((value.urls ?? []).filter((item) => item))],
  }
}

function isProviderConfig(value: unknown): value is RuntimeShellProviderConfig {
  return isStoredProviderConfig(value)
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

function isMcpConfig(value: unknown): value is UserMcpConfig {
  return Boolean(
    value &&
      typeof value === "object" &&
      (((value as UserMcpConfig).type === "local" && Array.isArray((value as UserMcpConfig).command)) ||
        ((value as UserMcpConfig).type === "remote" && typeof (value as UserMcpConfig).url === "string")),
  )
}
