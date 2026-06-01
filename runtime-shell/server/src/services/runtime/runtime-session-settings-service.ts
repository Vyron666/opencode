import { getRuntime } from "../../acp-runtime-manager"
import type { User } from "../../types"
import { renewRuntimeLeaseForSession } from "../runtime-governance/runtime-lease-service"
import { requireSessionAction } from "../session/session-access-service"
import { sessionService } from "../store/store-singleton"

export async function updateSessionModeForUser(input: {
  user: User
  businessSessionId: string
  modeId: string
}) {
  const result = await requireSessionAction({
    user: input.user,
    sessionId: input.businessSessionId,
    action: "mode_update",
  })
  if (!result.ok) return result
  const runtime = getRuntime(result.session.id)
  if (!runtime || runtime.transport !== "real") {
    return { ok: false as const, reason: "runtime_not_active" }
  }
  await renewRuntimeLeaseForSession(result.session.id)
  await runtime.client.setSessionMode(input.modeId)
  const current = await sessionService.getSession(result.session.id)
  await sessionService.updateSession(result.session.id, {
    capabilityState: {
      ...current?.capabilityState,
      modeId: input.modeId,
      modes: {
        ...(current?.capabilityState?.modes ?? {}),
        currentModeId: input.modeId,
      },
      configOptions: Array.isArray(current?.capabilityState?.configOptions)
        ? current.capabilityState.configOptions.map((item) =>
            item.id === "mode" ? { ...item, currentValue: input.modeId } : item,
          )
        : current?.capabilityState?.configOptions,
    },
  })
  return { ok: true as const, success: true }
}

export async function updateSessionModelForUser(input: {
  user: User
  businessSessionId: string
  modelId: string
}) {
  const result = await requireSessionAction({
    user: input.user,
    sessionId: input.businessSessionId,
    action: "model_update",
  })
  if (!result.ok) return result
  const runtime = getRuntime(result.session.id)
  if (!runtime || runtime.transport !== "real") {
    return { ok: false as const, reason: "runtime_not_active" }
  }
  await renewRuntimeLeaseForSession(result.session.id)
  await runtime.client.setSessionModel(input.modelId)
  const current = await sessionService.getSession(result.session.id)
  await sessionService.updateSession(result.session.id, {
    capabilityState: {
      ...current?.capabilityState,
      modelId: input.modelId,
      models: {
        ...(current?.capabilityState?.models ?? {}),
        currentModelId: input.modelId,
      },
      configOptions: Array.isArray(current?.capabilityState?.configOptions)
        ? current.capabilityState.configOptions.map((item) =>
            item.id === "model" ? { ...item, currentValue: input.modelId } : item,
          )
        : current?.capabilityState?.configOptions,
    },
  })
  return { ok: true as const, success: true }
}

export async function updateSessionConfigForUser(input: {
  user: User
  businessSessionId: string
  configId: string
  value: string | boolean
}) {
  const result = await requireSessionAction({
    user: input.user,
    sessionId: input.businessSessionId,
    action: "config_update",
  })
  if (!result.ok) return result
  const runtime = getRuntime(result.session.id)
  if (!runtime || runtime.transport !== "real") {
    return { ok: false as const, reason: "runtime_not_active" }
  }
  await renewRuntimeLeaseForSession(result.session.id)
  const response = await runtime.client.setSessionConfigOption(input.configId, input.value)
  const current = await sessionService.getSession(result.session.id)
  await sessionService.updateSession(result.session.id, {
    capabilityState: {
      ...current?.capabilityState,
      configOptions: response.configOptions
        ? response.configOptions.map((item) => item as Record<string, unknown>)
        : current?.capabilityState?.configOptions,
    },
  })
  return { ok: true as const, success: true }
}
