import { closeRuntime, getRuntime } from "../../acp-runtime-manager"
import { Config, getCustomModels, invalidateCustomModelsCache } from "../../config"
import { listProviderConfigs, saveProviderConfig } from "../../provider-config"
import type { User } from "../../types"
import { authorizeSettingsAction } from "../access/authorization-service"
import { buildAccessContext } from "../access/access-context-service"
import { resetSessionRuntime } from "../session/session-lifecycle-service"
import { auditService, sessionService } from "../store/store-singleton"

export async function listCustomModelsForUser(user: User) {
  const authorization = authorizeSettingsAction({
    user,
    resource: "custom_model",
    action: "list",
  })
  if (!authorization.ok) return { ok: false as const, reason: "forbidden" }
  const context = await buildAccessContext(user)
  return {
    ok: true as const,
    items: context.workspaceIds.size || context.sessionIds.size ? await getCustomModels() : [],
  }
}

export async function saveCustomModelsForUser(input: {
  user: User
  requestId: string
  models: unknown[]
}) {
  const authorization = authorizeSettingsAction({
    user: input.user,
    resource: "custom_model",
    action: "save",
  })
  if (!authorization.ok) return { ok: false as const, reason: "forbidden" }
  const filePath = process.env.RUNTIME_SHELL_CUSTOM_MODELS_FILE || `${Config.dataFile}.custom-models.json`
  await Bun.write(filePath, JSON.stringify(input.models, null, 2))
  invalidateCustomModelsCache()
  const auditLogTask = auditService.appendAuditLog({
    tenantId: input.user.tenantId,
    organizationId: input.user.organizationId,
    userId: input.user.id,
    requestId: input.requestId,
    action: "custom_model.save",
    resourceType: "custom_model",
    resourceId: "custom_models",
    detail: {
      modelCount: input.models.length,
    },
  })
  void auditLogTask
  return {
    ok: true as const,
    success: true,
    count: input.models.length,
  }
}

export async function listProviderConfigsForUser(user: User) {
  const authorization = authorizeSettingsAction({
    user,
    resource: "provider_config",
    action: "list",
  })
  if (!authorization.ok) return { ok: false as const, reason: "forbidden" }
  const context = await buildAccessContext(user)
  return {
    ok: true as const,
    items: context.workspaceIds.size || context.sessionIds.size ? await listProviderConfigs() : [],
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
  const saved = await saveProviderConfig(input.config)
  const affectedSessions = (await sessionService.listUserSessions(input.user))
    .filter(
      (session) =>
        session.status === "active" &&
        Boolean(getRuntime(session.id)) &&
        sessionUsesProvider(session, saved.providerId),
    )

  // 中文/English: config save only resets live runtimes in this process.
  // Historical created sessions stay untouched and reopen explicitly when needed.
  for (const session of affectedSessions) {
    await closeRuntime(session.id)
    await resetSessionRuntime(session.id, "created")
  }

  const auditLogTask = auditService.appendAuditLog({
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
  // 中文/English: provider save should return after reload work, not after audit persistence.
  void auditLogTask

  return {
    ok: true as const,
    success: true,
    providerId: saved.providerId,
    reloadedSessionCount: affectedSessions.length,
  }
}

function sessionUsesProvider(session: Awaited<ReturnType<typeof sessionService.getSession>> extends infer T ? Exclude<T, undefined> : never, providerId: string) {
  const currentModelId = readCurrentModelId(session)
  if (!currentModelId) return false
  return currentModelId.startsWith(`${providerId}/`)
}

function readCurrentModelId(session: Awaited<ReturnType<typeof sessionService.getSession>> extends infer T ? Exclude<T, undefined> : never) {
  const directModelId = session.capabilityState?.modelId
  if (typeof directModelId === "string" && directModelId) return directModelId
  const currentModelId = session.capabilityState?.models?.currentModelId
  if (typeof currentModelId === "string" && currentModelId) return currentModelId
  const modelOption = session.capabilityState?.configOptions?.find((item) => item.id === "model")
  if (typeof modelOption?.currentValue === "string" && modelOption.currentValue) {
    return modelOption.currentValue
  }
  return ""
}
