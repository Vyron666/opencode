import { closeRuntime, getRuntime } from "../../acp-runtime-manager"
import { Config, getCustomModels, invalidateCustomModelsCache } from "../../config"
import { listProviderConfigs, saveProviderConfig } from "../../provider-config"
import type { User } from "../../types"
import { resetSessionRuntime } from "../session/session-lifecycle-service"
import { auditService, sessionService } from "../store/store-singleton"

export async function listCustomModelsForUser(_user: User) {
  return {
    items: await getCustomModels(),
  }
}

export async function saveCustomModelsForUser(input: {
  user: User
  models: unknown[]
}) {
  const filePath = process.env.RUNTIME_SHELL_CUSTOM_MODELS_FILE || `${Config.dataFile}.custom-models.json`
  await Bun.write(filePath, JSON.stringify(input.models, null, 2))
  invalidateCustomModelsCache()
  return {
    success: true,
    count: input.models.length,
  }
}

export async function listProviderConfigsForUser(_user: User) {
  return {
    items: await listProviderConfigs(),
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
  const saved = await saveProviderConfig(input.config)
  const affectedSessions = (await sessionService.listUserSessions(input.user))
    .filter((session) => session.status === "active" && Boolean(getRuntime(session.id)))

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
    success: true,
    providerId: saved.providerId,
    reloadedSessionCount: affectedSessions.length,
  }
}
