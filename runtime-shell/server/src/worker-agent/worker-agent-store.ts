import type { RuntimeEntry } from "./worker-agent-types"

const runtimesById = new Map<string, RuntimeEntry>()
const runtimesByBusinessSessionId = new Map<string, RuntimeEntry>()
const runtimeClaimsByWorkspaceId = new Map<string, Array<{
  workerId: string
  containerName?: string
}>>()

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

export function rememberRuntimeClaim(input: {
  businessSessionId: string
  workspaceId: string
  workerId: string
  containerName?: string
}) {
  const claims = runtimeClaimsByWorkspaceId.get(input.workspaceId) || []
  claims.push({
    workerId: input.workerId,
    containerName: input.containerName,
  })
  runtimeClaimsByWorkspaceId.set(input.workspaceId, claims)
}

export function releaseRuntimeClaim(input: {
  businessSessionId: string
  workspaceId: string
  workerId: string
  containerName?: string
}) {
  const claims = runtimeClaimsByWorkspaceId.get(input.workspaceId) || []
  const nextClaims = claims.filter((claim) =>
    claim.workerId !== input.workerId || claim.containerName !== input.containerName,
  )
  if (nextClaims.length === 0) {
    runtimeClaimsByWorkspaceId.delete(input.workspaceId)
    return
  }
  runtimeClaimsByWorkspaceId.set(input.workspaceId, nextClaims)
}

export function requireRuntime(remoteRuntimeId: unknown) {
  const runtimeId = requireString(remoteRuntimeId, "remoteRuntimeId")
  const entry = runtimesById.get(runtimeId)
  if (!entry) throw new Error(`runtime not found: ${runtimeId}`)
  return entry
}

export function findRuntimeById(remoteRuntimeId: string) {
  return runtimesById.get(remoteRuntimeId)
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

export function listRuntimeContainerNames(workerId?: string) {
  return [...runtimesById.values()]
    .filter((entry) => !workerId || entry.workerId === workerId)
    .map((entry) => entry.sandboxHandle?.containerName)
    .filter((containerName): containerName is string => Boolean(containerName))
}

export function findRuntimeByBusinessSessionId(businessSessionId: string) {
  return runtimesByBusinessSessionId.get(businessSessionId)
}

export function hasRuntimeActivityByBusinessSessionId(businessSessionId: string) {
  return runtimesByBusinessSessionId.has(businessSessionId)
}

export function hasRuntimeActivityByWorkspaceId(workspaceId: string) {
  return [...runtimesById.values()].some((entry) => entry.workspaceId === workspaceId)
    || runtimeClaimsByWorkspaceId.has(workspaceId)
}

export function listClaimedContainerNames(workerId?: string) {
  return [...runtimeClaimsByWorkspaceId.values()]
    .flatMap((claims) => claims)
    .filter((claim) => !workerId || claim.workerId === workerId)
    .map((claim) => claim.containerName)
    .filter((containerName): containerName is string => Boolean(containerName))
}

export function requireString(value: unknown, field: string) {
  if (typeof value === "string" && value.trim()) return value
  throw new Error(`${field} is required`)
}
