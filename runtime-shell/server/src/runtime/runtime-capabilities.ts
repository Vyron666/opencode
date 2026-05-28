import type { NewSessionResponse } from "@agentclientprotocol/sdk"
import { getCustomModels, type CustomModel } from "../config"
import type { BusinessSession, SessionEvent } from "../types"

export function extractUpstreamError(payload: Record<string, unknown>) {
  const meta = payload._meta
  if (!meta || typeof meta !== "object") return
  const opencode = (meta as Record<string, unknown>).opencode
  if (!opencode || typeof opencode !== "object") return
  const upstreamError = (opencode as Record<string, unknown>).upstreamError
  if (!upstreamError || typeof upstreamError !== "object") return
  return upstreamError as Record<string, unknown>
}

export function deriveCapabilityPatch(event: SessionEvent) {
  if (event.eventType === "session_opened") {
    const modes =
      event.payload.modes && typeof event.payload.modes === "object"
        ? (event.payload.modes as Record<string, unknown>)
        : undefined
    const models =
      event.payload.models && typeof event.payload.models === "object"
        ? (event.payload.models as Record<string, unknown>)
        : undefined
    const configOptions = Array.isArray(event.payload.configOptions)
      ? event.payload.configOptions.map((item) => item as Record<string, unknown>)
      : undefined
    const modeOption =
      Array.isArray(configOptions) &&
      configOptions.find((item) => typeof item === "object" && item && (item as Record<string, unknown>).id === "mode")
    const modelOption =
      Array.isArray(configOptions) &&
      configOptions.find((item) => typeof item === "object" && item && (item as Record<string, unknown>).id === "model")
    return {
      modeId:
        typeof modes?.currentModeId === "string"
          ? (modes.currentModeId as string)
          : typeof (modeOption as Record<string, unknown> | undefined)?.currentValue === "string"
            ? ((modeOption as Record<string, unknown>).currentValue as string)
            : undefined,
      modelId:
        typeof models?.currentModelId === "string"
          ? (models.currentModelId as string)
          : typeof (modelOption as Record<string, unknown> | undefined)?.currentValue === "string"
            ? ((modelOption as Record<string, unknown>).currentValue as string)
            : undefined,
      models,
      modes,
      configOptions,
      sessionInfo: {
        title: typeof event.payload.title === "string" ? event.payload.title : undefined,
      },
    }
  }

  if (event.eventType === "available_commands_update") {
    const commands = Array.isArray(event.payload.commands)
      ? event.payload.commands
      : Array.isArray(event.payload.availableCommands)
        ? event.payload.availableCommands
        : undefined
    if (!Array.isArray(commands)) return
    return {
      availableCommands: commands
        .map((item) =>
          typeof item === "string"
            ? item
            : typeof item === "object" && item && typeof (item as Record<string, unknown>).name === "string"
              ? ((item as Record<string, unknown>).name as string)
              : undefined,
        )
        .filter((item): item is string => !!item),
    }
  }

  if (event.eventType === "usage_update") {
    return { usage: event.payload }
  }

  if (event.eventType === "current_mode_update") {
    return {
      modeId: typeof event.payload.modeId === "string" ? event.payload.modeId : undefined,
      modes: event.payload,
    }
  }

  if (event.eventType === "config_option_update") {
    const configOptions = event.payload.configOptions
    const modeOption =
      Array.isArray(configOptions) &&
      configOptions.find((item) => typeof item === "object" && item && (item as Record<string, unknown>).id === "mode")
    const modelOption =
      Array.isArray(configOptions) &&
      configOptions.find((item) => typeof item === "object" && item && (item as Record<string, unknown>).id === "model")
    return {
      modeId:
        typeof (modeOption as Record<string, unknown> | undefined)?.currentValue === "string"
          ? ((modeOption as Record<string, unknown>).currentValue as string)
          : undefined,
      modelId:
        typeof (modelOption as Record<string, unknown> | undefined)?.currentValue === "string"
          ? ((modelOption as Record<string, unknown>).currentValue as string)
          : undefined,
      configOptions: Array.isArray(configOptions)
        ? configOptions.map((item) => item as Record<string, unknown>)
        : undefined,
    }
  }

  if (event.eventType === "session_info_update") {
    if (extractUpstreamError(event.payload)) return
    return { sessionInfo: event.payload }
  }

  if (event.eventType === "agent_message_chunk" || event.eventType === "agent_thought_chunk" || event.eventType === "user_message_chunk") {
    const text = extractContentText(event.payload)
    if (!text) return
    return {
      sessionInfo: {
        lastMessagePreview: text,
      },
    }
  }
}

export async function mergeConfigOptionsWithCustomModels(configOptions?: Array<Record<string, unknown>>) {
  if (!configOptions) return configOptions
  const customModels = await getCustomModels()
  const modelOption = configOptions.find((item) => item.id === "model")
  if (!modelOption || !Array.isArray(modelOption.options)) return configOptions
  const existingIds = new Set((modelOption.options as Array<{ value: string }>).map((option) => option.value))
  customModels.forEach((custom) => {
    if (existingIds.has(custom.modelId)) return
    existingIds.add(custom.modelId)
    ;(modelOption.options as Array<{ value: string; name: string }>).push({
      value: custom.modelId,
      name: custom.name,
    })
  })
  return configOptions
}

export async function normalizeBootstrap(session: BusinessSession, response: SessionBootstrapInput) {
  const customModels = await getCustomModels()
  const configOptions = (response.configOptions ?? []).map((item) => item as Record<string, unknown>)
  return {
    sessionInfo: {
      title: session.title,
      cwd: session.workspacePath,
    },
    models: mergeCustomModels(response.models ? (response.models as Record<string, unknown>) : undefined, customModels),
    modes: response.modes ? (response.modes as Record<string, unknown>) : undefined,
    configOptions,
    modeId:
      typeof response.modes?.currentModeId === "string"
        ? response.modes.currentModeId
        : typeof configOptions.find((item) => item.id === "mode")?.currentValue === "string"
          ? (configOptions.find((item) => item.id === "mode")?.currentValue as string)
          : undefined,
    modelId:
      typeof response.models?.currentModelId === "string"
        ? response.models.currentModelId
        : typeof configOptions.find((item) => item.id === "model")?.currentValue === "string"
          ? (configOptions.find((item) => item.id === "model")?.currentValue as string)
          : undefined,
    availableCommands: [],
  }
}

type SessionBootstrapInput = {
  configOptions?: NewSessionResponse["configOptions"]
  models?: NewSessionResponse["models"]
  modes?: NewSessionResponse["modes"]
}

function extractContentText(payload: Record<string, unknown>) {
  const content = payload.content
  if (!content || typeof content !== "object") return
  const block = content as Record<string, unknown>
  if (block.type !== "text") return
  return typeof block.text === "string" ? block.text : undefined
}

function mergeCustomModels(acpModels: Record<string, unknown> | undefined, customModels: CustomModel[]) {
  const existing = acpModels ?? {}
  const available = Array.isArray(existing.availableModels)
    ? [...(existing.availableModels as Array<{ modelId: string; name: string }>)]
    : []
  const existingIds = new Set(available.map((model) => model.modelId))
  customModels.forEach((custom) => {
    if (existingIds.has(custom.modelId)) return
    existingIds.add(custom.modelId)
    available.push({
      modelId: custom.modelId,
      name: custom.name,
    })
  })
  return {
    ...existing,
    availableModels: available,
    currentModelId: existing.currentModelId || customModels[0]?.modelId,
  }
}
