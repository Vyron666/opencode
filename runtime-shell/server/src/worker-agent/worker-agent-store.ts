import type { RuntimeEntry } from "./worker-agent-types"

const runtimesById = new Map<string, RuntimeEntry>()
const runtimesByBusinessSessionId = new Map<string, RuntimeEntry>()

export function rememberRuntime(entry: RuntimeEntry) {
  runtimesById.set(entry.remoteRuntimeId, entry)
  runtimesByBusinessSessionId.set(entry.businessSessionId, entry)
}

export function forgetRuntime(entry: RuntimeEntry) {
  runtimesById.delete(entry.remoteRuntimeId)
  if (runtimesByBusinessSessionId.get(entry.businessSessionId)?.remoteRuntimeId === entry.remoteRuntimeId) {
    runtimesByBusinessSessionId.delete(entry.businessSessionId)
  }
}

export function requireRuntime(remoteRuntimeId: unknown) {
  const runtimeId = requireString(remoteRuntimeId, "remoteRuntimeId")
  const entry = runtimesById.get(runtimeId)
  if (!entry) throw new Error(`runtime not found: ${runtimeId}`)
  return entry
}

export function findRuntimeForQuery(url: URL) {
  const remoteRuntimeId = url.searchParams.get("remoteRuntimeId")
  if (remoteRuntimeId) return runtimesById.get(remoteRuntimeId)
  const businessSessionId = url.searchParams.get("businessSessionId")
  if (businessSessionId) return runtimesByBusinessSessionId.get(businessSessionId)
  throw new Error("remoteRuntimeId or businessSessionId is required")
}

export function findRuntimeByPermissionRequestId(requestId: string) {
  return [...runtimesById.values()].find((entry) => entry.pendingPermissions.has(requestId))
}

export function findRuntimeByQuestionRequestId(requestId: string) {
  return [...runtimesById.values()].find((entry) => entry.pendingQuestions.has(requestId))
}

export function listRuntimes() {
  return [...runtimesById.values()]
}

export function findRuntimeByBusinessSessionId(businessSessionId: string) {
  return runtimesByBusinessSessionId.get(businessSessionId)
}

export function requireString(value: unknown, field: string) {
  if (typeof value === "string" && value.trim()) return value
  throw new Error(`${field} is required`)
}
