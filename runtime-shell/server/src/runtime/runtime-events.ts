import { getCustomModels } from "../config"
import { store } from "../store"
import type { BusinessSession, SessionEvent, SessionEventType } from "../types"
import { deriveCapabilityPatch, mergeConfigOptionsWithCustomModels } from "./runtime-capabilities"
import { publishToSubscribers } from "./runtime-registry"

export function createEvent(
  session: BusinessSession,
  eventType: SessionEventType,
  payload: Record<string, unknown>,
  acpSessionId?: string,
): SessionEvent {
  return {
    eventId: nextId("evt"),
    eventType,
    businessSessionId: session.id,
    acpSessionId: acpSessionId || session.binding?.acpSessionId,
    workerId: session.workerId,
    timestamp: new Date().toISOString(),
    payload,
  }
}

export async function persistAndFanout(event: SessionEvent) {
  publishToSubscribers(event)
  const session = store.getSession(event.businessSessionId)
  const capabilityPatch = deriveCapabilityPatch(event)
  let sessionPatch: Partial<BusinessSession> | undefined
  if (session) {
    if (event.eventType === "config_option_update" && capabilityPatch?.configOptions) {
      capabilityPatch.configOptions = await mergeConfigOptionsWithCustomModels(
        capabilityPatch.configOptions as Array<Record<string, unknown>>,
      )
    }
    sessionPatch = {
      lastEventAt: event.timestamp,
      ...(capabilityPatch
        ? {
            capabilityState: {
              ...session.capabilityState,
              ...capabilityPatch,
            },
          }
        : {}),
    }
  }
  store.stageSessionEvent(event, sessionPatch)
  await store.save()
}

export function nextId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`
}
