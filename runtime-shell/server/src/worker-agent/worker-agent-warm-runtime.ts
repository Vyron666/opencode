import { createHash } from "node:crypto"
import { AcpProcessClient } from "../acp/acp-process-client"
import { attachDockerSandboxAcp } from "./sandbox/docker-sandbox-acp"
import { destroyWarmPoolSlot, getWarmPoolSlotById, prepareWarmPoolWorkspace, releaseWarmPoolSlot, reserveWarmPoolSlot, takeWarmPoolSlot } from "./sandbox/docker-sandbox-warm-pool"
import { WARM_POOL_RUNTIME_CWD, type WarmPoolSlot } from "./sandbox/docker-sandbox-state"
import type { SandboxHandle } from "./sandbox/sandbox-types"
import { bindRuntimeEntryClientContext, createRuntimeEntryFromClient } from "./worker-agent-runtime-support"

const pendingWarmRuntimeBySession = new Map<string, Promise<WarmPoolSlot | undefined>>()

type WarmRuntimeRequest = {
  runtimeShellBaseUrl: string
  workerToken: string
  businessSessionId: string
  workspaceId: string
  workspacePath: string
  sandboxPath: string
  workerId: string
  configContent?: string
}

export function computeRuntimeConfigFingerprint(configContent?: string) {
  return createHash("sha256").update(configContent || "").digest("hex").slice(0, 24)
}

export async function prewarmSessionRuntimeOnWorker(input: WarmRuntimeRequest) {
  const pending = pendingWarmRuntimeBySession.get(input.businessSessionId)
  if (pending) return pending
  const task = doPrewarmSessionRuntime(input)
  pendingWarmRuntimeBySession.set(input.businessSessionId, task)
  try {
    return await task
  } finally {
    if (pendingWarmRuntimeBySession.get(input.businessSessionId) === task) {
      pendingWarmRuntimeBySession.delete(input.businessSessionId)
    }
  }
}

export async function waitForWarmRuntimePrewarm(businessSessionId: string) {
  const pending = pendingWarmRuntimeBySession.get(businessSessionId)
  if (!pending) return
  await pending.catch(() => {})
}

export async function tryOpenWarmRuntimeEntry(input: WarmRuntimeRequest) {
  await waitForWarmRuntimePrewarm(input.businessSessionId)
  const slot = takeWarmPoolSlot(
    input.workerId,
    input.businessSessionId,
    input.workspaceId,
    computeRuntimeConfigFingerprint(input.configContent),
  )
  if (!slot) return
  const { handle, client } = await ensureWarmRuntimeSlotReady(slot, input)
  const entry = createRuntimeEntryFromClient({
    runtimeShellBaseUrl: input.runtimeShellBaseUrl,
    workerToken: input.workerToken,
    businessSessionId: input.businessSessionId,
    workspaceId: input.workspaceId,
    workspacePath: input.workspacePath,
    sandboxPath: input.sandboxPath,
    workerId: input.workerId,
    client,
    sandboxHandle: handle,
    closeSandbox: () => releaseWarmPoolSlot(handle),
    releaseRuntime: () => client.closeActiveSession(),
  })
  bindRuntimeEntryClientContext(entry, {
    runtimeShellBaseUrl: input.runtimeShellBaseUrl,
    workerToken: input.workerToken,
    cwd: WARM_POOL_RUNTIME_CWD,
    configContent: input.configContent,
  })
  return entry
}

async function doPrewarmSessionRuntime(input: WarmRuntimeRequest) {
  const slot = await ensureReservedWarmPoolSlot({
    workerId: input.workerId,
    businessSessionId: input.businessSessionId,
    workspaceId: input.workspaceId,
    configFingerprint: computeRuntimeConfigFingerprint(input.configContent),
  })
  if (!slot) return
  await ensureWarmRuntimeSlotReady(slot, input)
  return slot
}

async function ensureReservedWarmPoolSlot(input: {
  workerId: string
  businessSessionId: string
  workspaceId: string
  configFingerprint: string
}) {
  // 中文/English: prewarm must stay inside the configured warm-pool target.
  // If every slot is already leased, the later open path will use controlled cold start.
  return reserveWarmPoolSlot(input)
}

async function ensureWarmRuntimeClient(slot: WarmPoolSlot, input: {
  businessSessionId: string
  workspaceId: string
  workerId: string
  configContent?: string
}) {
  if (slot.runtimeClient) return slot.runtimeClient
  const handle = createWarmRuntimeClientHandle(slot, input)
  const client = new AcpProcessClient(
    {
      cwd: WARM_POOL_RUNTIME_CWD,
      businessSessionId: input.businessSessionId,
      workerId: input.workerId,
      configContent: input.configContent,
      onEvent: async () => {
        // 中文/English: warm runtime prewarm keeps the process hot without
        // binding business-session event delivery until a real open/load happens.
      },
    },
    () => Promise.resolve(),
    (options) =>
      attachDockerSandboxAcp({
        handle,
        runtimeClientOptions: options,
      }),
  )
  slot.preparingRuntime = true
  try {
    await client.initialize()
  } catch (error) {
    client.terminate("warm runtime initialize failed")
    throw error
  } finally {
    slot.preparingRuntime = false
  }
  slot.runtimeClient = client
  client.onExit(() => {
    if (getWarmPoolSlotById(slot.id)?.runtimeClient !== client) return
    slot.runtimeClient = undefined
    void destroyWarmPoolSlot(slot).catch(() => {})
  })
  return client
}

async function ensureWarmRuntimeSlotReady(slot: WarmPoolSlot, input: WarmRuntimeRequest) {
  const handle = toWarmSandboxHandle(slot, input)
  try {
    await prepareWarmPoolWorkspace(handle)
    const client = await ensureWarmRuntimeClient(slot, input)
    return {
      handle,
      client,
    }
  } catch (error) {
    await destroyWarmPoolSlot(slot).catch(() => {})
    throw error
  }
}

function createWarmRuntimeClientHandle(
  slot: WarmPoolSlot,
  input: {
    businessSessionId: string
    workspaceId: string
    workerId: string
  },
) {
  return toWarmSandboxHandle(slot, {
    businessSessionId: input.businessSessionId,
    workspaceId: input.workspaceId,
    workerId: input.workerId,
    sandboxPath: slot.visiblePath,
    workspacePath: slot.visiblePath,
  })
}

function toWarmSandboxHandle(
  slot: WarmPoolSlot,
  input: Pick<WarmRuntimeRequest, "businessSessionId" | "workspaceId" | "workerId" | "workspacePath" | "sandboxPath">,
): SandboxHandle {
  return {
    workerId: input.workerId,
    businessSessionId: input.businessSessionId,
    workspaceId: input.workspaceId,
    containerName: slot.containerName,
    workspacePath: slot.visiblePath,
    sandboxPath: input.sandboxPath,
    runtimeCwd: WARM_POOL_RUNTIME_CWD,
    poolSlotId: slot.id,
  }
}
