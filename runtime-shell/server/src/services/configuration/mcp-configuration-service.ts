import * as ConfigRepo from "../../repos/config-repo"
import type { ConfigSource, User, UserMcpConfig } from "../../types"
import { platformSharedScope, userPrivateScope } from "./configuration-scope"

export type SourcedMcpConfig = UserMcpConfig & {
  name: string
  source: ConfigSource
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

function isMcpConfig(value: unknown): value is UserMcpConfig {
  return Boolean(
    value &&
      typeof value === "object" &&
      (((value as UserMcpConfig).type === "local" && Array.isArray((value as UserMcpConfig).command)) ||
        ((value as UserMcpConfig).type === "remote" && typeof (value as UserMcpConfig).url === "string")),
  )
}
