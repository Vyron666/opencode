import * as ConfigRepo from "../../repos/config-repo"
import type { SourcedSkillConfigItem, User, UserSkillConfig } from "../../types"
import { platformSharedScope, userPrivateScope } from "./configuration-scope"

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

export async function listVisibleSkillConfigItems(user: User) {
  const [platformSkills, privateSkills] = await Promise.all([
    getPlatformSkillConfig(user),
    getUserPrivateSkillConfig(user),
  ])
  const platformPathSet = new Set(platformSkills.paths ?? [])
  const platformUrlSet = new Set(platformSkills.urls ?? [])

  return [
    ...(platformSkills.paths ?? []).map((value) => ({
      type: "path",
      value,
      source: "platform_shared",
    } satisfies SourcedSkillConfigItem)),
    ...(platformSkills.urls ?? []).map((value) => ({
      type: "url",
      value,
      source: "platform_shared",
    } satisfies SourcedSkillConfigItem)),
    ...(privateSkills.paths ?? [])
      .filter((value) => !platformPathSet.has(value))
      .map((value) => ({
        type: "path",
        value,
        source: "user_private",
      } satisfies SourcedSkillConfigItem)),
    ...(privateSkills.urls ?? [])
      .filter((value) => !platformUrlSet.has(value))
      .map((value) => ({
        type: "url",
        value,
        source: "user_private",
      } satisfies SourcedSkillConfigItem)),
  ]
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
