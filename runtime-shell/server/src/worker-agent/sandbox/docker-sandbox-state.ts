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
  containerName: string
  visiblePath: string
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
}

export const log = createLogger("docker-sandbox")

export const docker = new Docker({
  socketPath: Config.sandboxDockerSocketPath,
})

export const warmPoolByWorker = new Map<string, WarmPoolSlot[]>()
export const warmPoolTargetByWorker = new Map<string, number>()
export const runWithRuntimeBootGate = createConcurrencyGate(Config.sandboxRuntimeBootConcurrency)
export const runWithWarmPoolBootGate = createConcurrencyGate(1)
export const runWithWarmPoolCopyGate = createConcurrencyGate(Config.sandboxWorkspacePrepareConcurrency)
