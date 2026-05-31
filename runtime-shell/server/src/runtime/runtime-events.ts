import { sessionService, stateService } from "../services/store/store-singleton"
import type { BusinessSession, SessionEvent, SessionEventType } from "../types"
import { deriveCapabilityPatch } from "./runtime-capabilities"
import { publishToSubscribers } from "./runtime-registry"

const pendingSessionEventWrites = new Map<string, Promise<void>>()

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
  const previousWrite = pendingSessionEventWrites.get(event.businessSessionId) || Promise.resolve()
  const nextWrite = previousWrite.catch(() => undefined).then(async () => {
    const session = await sessionService.getSession(event.businessSessionId)
    const capabilityPatch = deriveCapabilityPatch(event)
    let sessionPatch: Partial<BusinessSession> | undefined
    if (session) {
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
    await sessionService.stageSessionEvent(event, sessionPatch)
    // 中文/English: keep event ordering in memory, but let disk flush coalesce in
    // the background so high-frequency chunks do not hold turn completion open.
    stateService.saveEventually()
  })
  pendingSessionEventWrites.set(event.businessSessionId, nextWrite)
  try {
    await nextWrite
  } finally {
    if (pendingSessionEventWrites.get(event.businessSessionId) === nextWrite) {
      pendingSessionEventWrites.delete(event.businessSessionId)
    }
  }
}

export async function waitForSessionEventWrites(sessionId: string) {
  const pendingWrite = pendingSessionEventWrites.get(sessionId)
  if (!pendingWrite) return
  await pendingWrite.catch(() => undefined)
}

export function nextId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`
}
