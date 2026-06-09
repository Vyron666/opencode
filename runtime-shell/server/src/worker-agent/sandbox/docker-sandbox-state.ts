import Docker from "dockerode"
import type { AcpProcessClient } from "../../acp/acp-process-client"
import { Config } from "../../config"
import { createConcurrencyGate } from "../../lib/concurrency-gate"
import { createLogger } from "../../log"

export const SANDBOX_CONFIG_PATH = "/tmp/runtime-shell-config.json"
export const SANDBOX_BRIDGE_PORT = 4100
export const WARM_POOL_RUNTIME_CWD = "/workspace/current"
export const WARM_SLOT_RUNTIME_MISSING_GRACE_MS = 45_000

export type WarmPoolSlot = {
  id: string
  workerId: string
  ownerInstanceId: string
  containerName: string
  visiblePath: string
  runtimeHomePath: string
  configFingerprint?: string
  ready: boolean
  leased: boolean
  createdAt: string
  leasedAt?: string
  leasedSessionId?: string
  leasedWorkspaceId?: string
  leaseRefCount?: number
  workspacePrepared?: boolean
  preparingRuntime?: boolean
  runtimeClient?: AcpProcessClient
  runtimeClientPromise?: Promise<AcpProcessClient>
}

export const log = createLogger("docker-sandbox")

export const docker = new Docker({
  socketPath: Config.sandboxDockerSocketPath,
})

const workerAgentInstanceId = `wkr_${crypto.randomUUID().replace(/-/g, "")}`
const workerAgentStartedAtMs = Date.now()
let workerAgentShuttingDown = false

export const warmPoolByWorker = new Map<string, WarmPoolSlot[]>()
export const warmPoolTargetByWorker = new Map<string, number>()
export const pendingWarmPoolCreateCountByWorker = new Map<string, number>()
export const pendingWarmPoolEnsureByWorker = new Map<string, Promise<unknown>>()
export const pendingWarmPoolReconcileByWorker = new Map<string, Promise<void>>()
export const pendingWarmPoolCleanupByWorker = new Map<string, Promise<void>>()
export const runWithRuntimeBootGate = createConcurrencyGate(Config.sandboxRuntimeBootConcurrency)
// 中文/English: cold-start heavy stages must share one global gate so workspace copy,
// runtime-home preparation and first container boot back-pressure the same budget.
export const runWithColdStartGate = createConcurrencyGate(Config.sandboxColdStartConcurrency)
// 中文/English: warm slot refill should scale with worker count so one slow slot
// does not serialize the whole cluster's replenishment window.
export const runWithWarmPoolBootGate = createConcurrencyGate(
  Math.max(1, Math.min(Config.localWorkers.length || 1, Config.sandboxRuntimeBootConcurrency)),
)
// 中文/English: background warm-runtime materialization must stay narrower than
// foreground runtime boot so heartbeat refill cannot starve real user opens.
export const runWithWarmRuntimeMaterializeGate = createConcurrencyGate(1)
export const runWithWarmPoolCopyGate = createConcurrencyGate(Config.sandboxWorkspacePrepareConcurrency)

export function getWorkerAgentInstanceId() {
  return workerAgentInstanceId
}

export function getWorkerAgentStartedAtMs() {
  return workerAgentStartedAtMs
}

export function isWorkerAgentShuttingDown() {
  return workerAgentShuttingDown
}

export function markWorkerAgentShuttingDown() {
  workerAgentShuttingDown = true
}
