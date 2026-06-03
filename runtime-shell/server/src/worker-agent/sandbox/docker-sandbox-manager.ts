import { mkdir, rm } from "node:fs/promises"
import { PassThrough, Writable } from "node:stream"
import net from "node:net"
import path from "node:path"
import { cp } from "node:fs/promises"
import Docker from "dockerode"
import type { ChildProcessWithoutNullStreams } from "node:child_process"
import { Config } from "../../config"
import { createConcurrencyGate } from "../../lib/concurrency-gate"
import { createLogger } from "../../log"
import { findRuntimeByBusinessSessionId } from "../worker-agent-store"
import type { SandboxManager } from "./sandbox-manager"
import type { SandboxAttachInput, SandboxCloseInput, SandboxHandle, SandboxPrepareInput, SandboxWorkspaceMountMode } from "./sandbox-types"

const SANDBOX_CONFIG_PATH = "/tmp/runtime-shell-config.json"
const SANDBOX_BRIDGE_PORT = 4100
const WARM_POOL_RUNTIME_CWD = "/workspace/current"
const WARM_SLOT_RUNTIME_MISSING_GRACE_MS = 45_000
const log = createLogger("docker-sandbox")

const docker = new Docker({
  socketPath: Config.sandboxDockerSocketPath,
})

type WarmPoolSlot = {
  id: string
  workerId: string
  containerName: string
  visiblePath: string
  ready: boolean
  leased: boolean
  createdAt: string
  leasedAt?: string
  leasedSessionId?: string
}

const warmPoolByWorker = new Map<string, WarmPoolSlot[]>()
const warmPoolTargetByWorker = new Map<string, number>()
const runWithSandboxBootGate = createConcurrencyGate(Config.sandboxRuntimeBootConcurrency)
const runWithWarmPoolCopyGate = createConcurrencyGate(Config.sandboxWorkspacePrepareConcurrency)

export function createDockerSandboxManager(): SandboxManager {
  return {
    prepare(input) {
      const warmSlot = takeWarmPoolSlot(input.workerId, input.businessSessionId)
      if (warmSlot) {
        return {
          containerName: warmSlot.containerName,
          workspacePath: warmSlot.visiblePath,
          sandboxPath: input.sandboxPath,
          runtimeCwd: WARM_POOL_RUNTIME_CWD,
          poolSlotId: warmSlot.id,
        }
      }
      return {
        containerName: toContainerName(input),
        workspacePath: input.workspacePath,
        sandboxPath: input.sandboxPath,
        runtimeCwd: input.sandboxPath || input.workspacePath,
      }
    },
    attachAcp(input) {
      return createDockerSandboxProcess(input)
    },
    async close(input) {
      await closeDockerSandbox(input.handle)
    },
  }
}

export async function ensureDockerWarmPool(input: {
  workerId: string
  target: number
}) {
  if (Config.sandboxBackend === "local-process") {
    return {
      workerId: input.workerId,
      target: 0,
      totalCount: 0,
      readyCount: 0,
      leasedCount: 0,
    }
  }
  warmPoolTargetByWorker.set(input.workerId, Math.max(0, input.target))
  await ensureDockerReady()
  await cleanupOrphanWarmPoolContainers(input.workerId)
  const workerPool = readWarmPool(input.workerId)
  await reclaimStaleLeasedWarmPoolSlots(input.workerId)
  await pruneMissingWarmPoolSlots(workerPool)
  while (workerPool.filter((slot) => slot.ready && !slot.leased).length < input.target) {
    workerPool.push(await createWarmPoolSlot(input.workerId))
  }
  const removable = workerPool.filter((slot) => slot.ready && !slot.leased)
  while (removable.length > input.target) {
    const slot = removable.pop()
    if (!slot) break
    await destroyWarmPoolSlot(slot)
  }
  const refreshedPool = readWarmPool(input.workerId)
  return toWarmPoolSnapshot(input.workerId, refreshedPool)
}

export async function cleanupDockerWarmPool(input: {
  workerId?: string
  recycleReady?: boolean
}) {
  if (Config.sandboxBackend === "local-process") {
    return {
      workers: [],
      cleanedReadyCount: 0,
      reclaimedStaleLeasedCount: 0,
    }
  }
  await ensureDockerReady()
  const workerIds = input.workerId
    ? [input.workerId]
    : [...new Set([...warmPoolByWorker.keys(), ...Config.localWorkers.map((worker) => worker.id)])]
  const workers = []
  let cleanedReadyCount = 0
  let reclaimedStaleLeasedCount = 0
  for (const workerId of workerIds) {
    cleanedReadyCount += await cleanupOrphanWarmPoolContainers(workerId)
    reclaimedStaleLeasedCount += await reclaimStaleLeasedWarmPoolSlots(workerId)
    const pool = readWarmPool(workerId)
    await pruneMissingWarmPoolSlots(pool)
    if (input.recycleReady) {
      const readySlots = [...readWarmPool(workerId)].filter((slot) => slot.ready && !slot.leased)
      cleanedReadyCount += readySlots.length
      for (const slot of readySlots) {
        await destroyWarmPoolSlot(slot)
      }
    }
    workers.push(toWarmPoolSnapshot(workerId, readWarmPool(workerId)))
  }
  return {
    workers,
    cleanedReadyCount,
    reclaimedStaleLeasedCount,
  }
}

export function getDockerWarmPoolSnapshot(workerId?: string) {
  if (Config.sandboxBackend === "local-process") {
    return workerId
      ? {
          workerId,
          target: 0,
          totalCount: 0,
          readyCount: 0,
          leasedCount: 0,
        }
      : {
          items: [],
          totalReady: 0,
          totalLeased: 0,
        }
  }
  if (workerId) return toWarmPoolSnapshot(workerId, readWarmPool(workerId))
  const items = [...warmPoolByWorker.entries()].map(([nextWorkerId, slots]) => toWarmPoolSnapshot(nextWorkerId, slots))
  return {
    items,
    totalReady: items.reduce((sum, item) => sum + item.readyCount, 0),
    totalLeased: items.reduce((sum, item) => sum + item.leasedCount, 0),
  }
}

export async function closeDockerWarmPoolSlot(input: {
  workerId: string
  slotId: string
}) {
  const slot = readWarmPool(input.workerId).find((item) => item.id === input.slotId)
  if (!slot) {
    return {
      workerId: input.workerId,
      slotId: input.slotId,
      closed: false,
      reason: "slot_not_found",
    }
  }
  // 中文/English: admin close should reclaim the exact warm slot immediately,
  // even when the slot is currently leased, so the DB view and worker pool stay aligned.
  await destroyWarmPoolSlot(slot)
  return {
    workerId: input.workerId,
    slotId: input.slotId,
    closed: true,
  }
}

function toContainerName(input: SandboxPrepareInput) {
  const suffix = `${input.workerId}_${input.businessSessionId}`.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(-80)
  return `runtime-shell-acp-${suffix}`
}

function createDockerSandboxProcess(input: SandboxAttachInput): ChildProcessWithoutNullStreams {
  if (!input.handle.containerName) {
    throw new Error("docker sandbox requires containerName")
  }
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  const exitState = createExitState()
  const proc = {
    stdin,
    stdout,
    stderr,
    kill(signal?: NodeJS.Signals | number) {
      // 中文/English: a leased warm-pool container is reused across sessions, so
      // killing the process adapter must only close the current ACP bridge.
      if (input.handle.poolSlotId) {
        input.handle.activeSocket?.end()
      } else {
        void stopDockerSandbox(input.handle, signal)
      }
      return true
    },
    once(event: "exit", handler: (code: number | null, signal: NodeJS.Signals | null) => void) {
      if (event !== "exit") return proc
      exitState.onExit(handler)
      return proc
    },
  } as unknown as ChildProcessWithoutNullStreams

  input.handle.bootPromise = bootContainer({
    handle: input.handle,
    runtimeClientOptions: input.runtimeClientOptions,
    stdin,
    stdout,
    stderr,
    exitState,
  })
  void input.handle.bootPromise

  return proc
}

async function bootContainer(input: {
  handle: SandboxHandle
  runtimeClientOptions: SandboxAttachInput["runtimeClientOptions"]
  stdin: PassThrough
  stdout: PassThrough
  stderr: PassThrough
  exitState: ReturnType<typeof createExitState>
}) {
  try {
    await ensureDockerReady()
    const cwd = input.handle.runtimeCwd || input.runtimeClientOptions.cwd
    if (input.handle.poolSlotId) {
      // 中文/English: warm-pool hits should wait on workspace sync only, not on the
      // cold container boot queue, so session open/reopen latency stays short.
      await prepareWarmPoolWorkspace(input.handle)
    } else {
      await runWithSandboxBootGate(async () => {
        const container = await ensureContainer({
          containerName: input.handle.containerName!,
          cwd,
          handle: input.handle,
        })
        await container.start()
        void followContainerStderr(container, input.stderr)
        void waitDockerSandboxExit(container).then((result) => {
          input.exitState.settle(result)
        })
      })
    }
    const container = docker.getContainer(input.handle.containerName!)
    const socket = await connectSandboxBridge(container)
    input.handle.activeSocket = socket
    socket.write(JSON.stringify({
      cwd,
      configB64: input.runtimeClientOptions.configContent
        ? Buffer.from(input.runtimeClientOptions.configContent).toString("base64")
        : "",
    }) + "\n")
    input.stdin.pipe(socket, { end: false })
    socket.pipe(input.stdout)
    socket.once("close", () => {
      input.handle.activeSocket = undefined
      input.stdout.end()
      input.stderr.end()
      if (input.handle.poolSlotId) {
        input.exitState.settle({ code: 0, signal: null })
      }
    })
    socket.once("error", (error) => {
      input.handle.activeSocket = undefined
      if (input.handle.poolSlotId) input.handle.invalidPoolSlot = true
      input.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
      input.exitState.settle({ code: 1, signal: null })
    })
  } catch (error) {
    if (input.handle.poolSlotId) {
      input.handle.invalidPoolSlot = true
    }
    if (input.handle.containerName && !input.handle.poolSlotId) {
      await removeContainer(input.handle.containerName)
    }
    input.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    input.stdout.end()
    input.stderr.end()
    input.exitState.settle({ code: 1, signal: null })
  }
}

async function ensureContainer(input: {
  containerName: string
  handle: SandboxHandle
  cwd: string
}) {
  await removeContainer(input.containerName)
  const workspaceMount = await toWorkspaceMount(input.handle, input.cwd)
  log.info("creating docker sandbox container", {
    containerName: input.containerName,
    image: Config.sandboxDockerImage,
    workingDir: Config.sandboxDockerSpawnCwd,
    sessionCwd: input.cwd,
    workspacePath: input.handle.workspacePath,
    workspaceMountMode: toWorkspaceMountMode(),
    runtimeHomeDir: Config.sandboxRuntimeHomeDir,
    networkMode: Config.sandboxDockerNetworkMode,
    user: Config.sandboxDockerUser,
  })
  return docker.createContainer({
    name: input.containerName,
    Image: Config.sandboxDockerImage,
    WorkingDir: Config.sandboxDockerSpawnCwd,
    Entrypoint: ["bun", "--eval"],
    Cmd: [createBridgeScript()],
    User: Config.sandboxDockerUser,
    OpenStdin: true,
    StdinOnce: false,
    Tty: false,
    AttachStdin: true,
    AttachStdout: true,
    AttachStderr: true,
    Env: buildSandboxEnv(),
    HostConfig: {
      AutoRemove: true,
      NetworkMode: Config.sandboxDockerNetworkMode,
      Runtime: readDockerRuntime(),
      ReadonlyRootfs: true,
      CapDrop: ["ALL"],
      SecurityOpt: toSecurityOptions(),
      Memory: Config.sandboxDockerMemoryBytes,
      NanoCpus: Config.sandboxDockerNanoCpus,
      PidsLimit: Config.sandboxDockerPidsLimit,
      Tmpfs: {
        "/tmp": "rw,noexec,nosuid,size=256m",
        [Config.sandboxRuntimeHomeDir]: "rw,noexec,nosuid,size=256m",
      },
      Mounts: [workspaceMount],
    },
  })
}

function buildSandboxEnv() {
  return [
    "OPENCODE_CLIENT=acp",
    `OPENCODE_ENABLE_QUESTION_TOOL=${process.env.OPENCODE_ENABLE_QUESTION_TOOL || "1"}`,
    `OPENCODE_ACP_NEXT=${process.env.OPENCODE_ACP_NEXT || "0"}`,
    `HOME=${Config.sandboxRuntimeHomeDir}`,
    `XDG_CONFIG_HOME=${Config.sandboxRuntimeHomeDir}/.config`,
    `XDG_CACHE_HOME=${Config.sandboxRuntimeHomeDir}/.cache`,
    `XDG_STATE_HOME=${Config.sandboxRuntimeHomeDir}/.local/state`,
    `XDG_DATA_HOME=${Config.sandboxRuntimeHomeDir}/.local/share`,
    "TMPDIR=/tmp",
    `RUNTIME_SHELL_BRIDGE_PORT=${SANDBOX_BRIDGE_PORT}`,
    `RUNTIME_SHELL_ACP_ENTRY=${Config.sandboxDockerAcpEntry}`,
    `RUNTIME_SHELL_ACP_SPAWN_CWD=${Config.sandboxDockerSpawnCwd}`,
  ]
}

function toWorkspaceMountMode(): SandboxWorkspaceMountMode {
  return Config.sandboxWorkspaceMountMode === "ro" ? "ro" : "rw"
}

async function toWorkspaceMount(handle: SandboxHandle, cwd: string) {
  const workspaceRoot = handle.poolSlotId
    ? handle.workspacePath || cwd
    : handle.sandboxPath || handle.workspacePath || cwd
  const mountMode = handle.poolSlotId ? "rw" : toWorkspaceMountMode()
  requireWorkspaceMountPath(workspaceRoot, handle.poolSlotId ? workspaceRoot : cwd)
  return {
    Type: "bind" as const,
    Source: await toDockerHostWorkspacePath(workspaceRoot),
    Target: handle.poolSlotId ? WARM_POOL_RUNTIME_CWD : workspaceRoot,
    ReadOnly: mountMode === "ro",
  }
}

function requireWorkspaceMountPath(workspaceRoot: string, cwd: string) {
  const normalizedRoot = path.resolve(workspaceRoot)
  const normalizedCwd = path.resolve(cwd)
  if (normalizedRoot !== normalizedCwd) {
    throw new Error(`sandbox cwd must match workspace root: cwd=${normalizedCwd} workspace=${normalizedRoot}`)
  }
  const relative = path.relative(Config.workspaceRootDir, normalizedRoot)
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`sandbox workspace path is outside workspace root: ${normalizedRoot}`)
  }
}

async function toDockerHostWorkspacePath(workspacePath: string) {
  const relative = path.relative(Config.workspaceRootDir, workspacePath)
  if (Config.sandboxDockerWorkspaceHostRoot) {
    return path.join(Config.sandboxDockerWorkspaceHostRoot, relative)
  }
  const self = await docker.getContainer(process.env.HOSTNAME || "").inspect()
  const workspaceMount = self.Mounts?.find((mount) => mount.Destination === Config.workspaceRootDir)
  if (!workspaceMount?.Source) {
    throw new Error(`docker sandbox workspace host root is unavailable: ${Config.workspaceRootDir}`)
  }
  return path.join(workspaceMount.Source, relative)
}

function toSecurityOptions() {
  return [
    "no-new-privileges:true",
    ...(Config.sandboxDockerSeccompProfile ? [`seccomp=${Config.sandboxDockerSeccompProfile}`] : []),
    ...(Config.sandboxDockerAppArmorProfile ? [`apparmor=${Config.sandboxDockerAppArmorProfile}`] : []),
  ]
}

function readDockerRuntime() {
  if (Config.sandboxBackend === "gvisor") return "runsc"
  if (Config.sandboxBackend === "kata") return Config.sandboxRuntimeClass || "kata"
  return undefined
}

async function ensureDockerReady() {
  try {
    await docker.ping()
  } catch (error) {
    throw new Error(
      `docker sandbox backend is unavailable: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

async function removeContainer(containerName: string) {
  try {
    const container = docker.getContainer(containerName)
    await container.remove({ force: true })
  } catch {}
}

async function closeDockerSandbox(handle: SandboxHandle) {
  if (handle.closePromise) return handle.closePromise
  handle.closePromise = (async () => {
    await handle.bootPromise?.catch(() => {})
    if (handle.poolSlotId) {
      await releaseWarmPoolSlot(handle)
      return
    }
    if (!handle.containerName) return
    await removeContainer(handle.containerName)
  })()
  return handle.closePromise
}

async function stopDockerSandbox(handle: SandboxHandle, signal?: NodeJS.Signals | number) {
  if (!handle.containerName) return
  try {
    const container = docker.getContainer(handle.containerName)
    await container.stop({
      signal: typeof signal === "string" ? signal : undefined,
      t: 1,
    })
  } catch {}
}

async function waitDockerSandboxExit(container: Docker.Container) {
  try {
    const result = await container.wait()
    return {
      code: typeof result.StatusCode === "number" ? result.StatusCode : null,
      signal: null,
    }
  } catch {
    return {
      code: null,
      signal: null,
    }
  }
}

async function connectSandboxBridge(container: Docker.Container) {
  const info = await container.inspect()
  const host = Object.values(info.NetworkSettings?.Networks || {}).find((network) => network.IPAddress)?.IPAddress
  if (!host) throw new Error("docker sandbox bridge address is unavailable")
  return connectTcp(host, SANDBOX_BRIDGE_PORT, 50)
}

async function connectTcp(host: string, port: number, attempts: number): Promise<net.Socket> {
  try {
    return await new Promise<net.Socket>((resolve, reject) => {
      const socket = net.connect({ host, port })
      socket.once("connect", () => resolve(socket))
      socket.once("error", reject)
    })
  } catch (error) {
    if (attempts <= 1) throw error
    await delay(200)
    return connectTcp(host, port, attempts - 1)
  }
}

function createBridgeScript() {
  return `
const fs = require("node:fs")
const net = require("node:net")
const { spawn } = require("node:child_process")
const server = net.createServer((socket) => {
  let handshakeBuffer = ""
  const onHandshakeData = (chunk) => {
    handshakeBuffer += chunk.toString("utf8")
    const newlineIndex = handshakeBuffer.indexOf("\\n")
    if (newlineIndex < 0) return
    socket.off("data", onHandshakeData)
    const line = handshakeBuffer.slice(0, newlineIndex)
    const rest = handshakeBuffer.slice(newlineIndex + 1)
    const handshake = line ? JSON.parse(line) : {}
    const childEnv = { ...process.env }
    if (handshake.configB64) {
      fs.writeFileSync("${SANDBOX_CONFIG_PATH}", Buffer.from(handshake.configB64, "base64"), { mode: 0o600 })
      childEnv.OPENCODE_CONFIG = "${SANDBOX_CONFIG_PATH}"
    } else {
      delete childEnv.OPENCODE_CONFIG
    }
    let childStopTimer
    let child = spawn("bun", [process.env.RUNTIME_SHELL_ACP_ENTRY, "acp", "--print-logs", "--cwd=" + (handshake.cwd || "${WARM_POOL_RUNTIME_CWD}")], {
      cwd: process.env.RUNTIME_SHELL_ACP_SPAWN_CWD,
      env: childEnv,
      stdio: ["pipe", "pipe", "pipe"],
    })
    const stopChild = () => {
      if (!child || child.exitCode !== null || child.killed) return
      child.kill("SIGTERM")
      childStopTimer = setTimeout(() => {
        if (!child || child.exitCode !== null || child.killed) return
        child.kill("SIGKILL")
      }, 1000)
      childStopTimer.unref?.()
    }
    child.stderr.pipe(process.stderr)
    if (rest) child.stdin.write(rest)
    socket.pipe(child.stdin)
    child.stdout.pipe(socket)
    child.on("exit", () => {
      if (childStopTimer) clearTimeout(childStopTimer)
      socket.end()
    })
    // 中文/English: a warm container can outlive many ACP sessions, so when the
    // bridge socket goes away we must also stop the child process or memory usage drifts upward.
    socket.once("close", stopChild)
    socket.once("end", stopChild)
    socket.once("error", stopChild)
  }
  socket.on("data", onHandshakeData)
})
server.listen(Number(process.env.RUNTIME_SHELL_BRIDGE_PORT || "${SANDBOX_BRIDGE_PORT}"), "0.0.0.0")
`.trim()
}

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function followContainerStderr(container: Docker.Container, stderr: PassThrough) {
  try {
    const stream = await container.logs({
      follow: true,
      stdout: true,
      stderr: true,
    })
    const discard = new Writable({
      write(_chunk, _encoding, callback) {
        callback()
      },
    })
    docker.modem.demuxStream(stream, discard, stderr)
    stream.once("end", () => {
      discard.end()
    })
    stream.once("error", () => {
      discard.end()
    })
  } catch (error) {
    stderr.write(`failed to follow sandbox stderr: ${error instanceof Error ? error.message : String(error)}\n`)
  }
}

function createExitState() {
  let settled:
    | {
        code: number | null
        signal: NodeJS.Signals | null
      }
    | undefined
  const handlers: Array<(code: number | null, signal: NodeJS.Signals | null) => void> = []
  return {
    onExit(handler: (code: number | null, signal: NodeJS.Signals | null) => void) {
      if (settled) {
        handler(settled.code, settled.signal)
        return
      }
      handlers.push(handler)
    },
    settle(result: { code: number | null; signal: NodeJS.Signals | null }) {
      if (settled) return
      settled = result
      while (handlers.length > 0) {
        const next = handlers.shift()
        next?.(result.code, result.signal)
      }
    },
  }
}

function readWarmPool(workerId: string) {
  const existing = warmPoolByWorker.get(workerId)
  if (existing) return existing
  const created: WarmPoolSlot[] = []
  warmPoolByWorker.set(workerId, created)
  return created
}

function takeWarmPoolSlot(workerId: string, businessSessionId: string) {
  const slot = readWarmPool(workerId).find((item) => item.ready && !item.leased)
  if (!slot) return
  slot.leased = true
  slot.ready = false
  slot.leasedAt = new Date().toISOString()
  slot.leasedSessionId = businessSessionId
  return slot
}

async function createWarmPoolSlot(workerId: string) {
  return runWithSandboxBootGate(async () => {
    const slotId = `warm_${crypto.randomUUID().replace(/-/g, "")}`
    const visiblePath = path.join(Config.workspaceRootDir, ".warm-pool", workerId, slotId)
    await rm(visiblePath, { recursive: true, force: true }).catch(() => {})
    await mkdir(visiblePath, { recursive: true })
    const containerName = `runtime-shell-warm-${workerId}-${slotId}`.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(-120)
    const handle: SandboxHandle = {
      containerName,
      workspacePath: visiblePath,
      runtimeCwd: WARM_POOL_RUNTIME_CWD,
      poolSlotId: slotId,
    }
    const container = await ensureContainer({
      containerName,
      handle,
      cwd: visiblePath,
    })
    await container.start()
    const slot: WarmPoolSlot = {
      id: slotId,
      workerId,
      containerName,
      visiblePath,
      ready: true,
      leased: false,
      createdAt: new Date().toISOString(),
    }
    return slot
  })
}

async function destroyWarmPoolSlot(slot: WarmPoolSlot) {
  const pool = readWarmPool(slot.workerId)
  const index = pool.findIndex((item) => item.id === slot.id)
  if (index >= 0) pool.splice(index, 1)
  await removeContainer(slot.containerName)
  await rm(slot.visiblePath, { recursive: true, force: true }).catch(() => {})
}

async function cleanupOrphanWarmPoolContainers(workerId: string) {
  const trackedContainerNames = new Set(readWarmPool(workerId).map((slot) => slot.containerName))
  const prefix = readWarmPoolContainerPrefix(workerId)
  const containers = await docker.listContainers({ all: true })
  let cleaned = 0
  for (const container of containers) {
    const matchedName = (container.Names || [])
      .map((name) => name.replace(/^\/+/, ""))
      .find((name) => name.startsWith(prefix))
    if (!matchedName || trackedContainerNames.has(matchedName)) continue
    const slotId = matchedName.slice(prefix.length)
    const visiblePath = path.join(Config.workspaceRootDir, ".warm-pool", workerId, slotId)
    log.info("cleaning orphan warm pool container", {
      workerId,
      containerName: matchedName,
      visiblePath,
    })
    await removeContainer(matchedName)
    await rm(visiblePath, { recursive: true, force: true }).catch(() => {})
    cleaned += 1
  }
  return cleaned
}

async function pruneMissingWarmPoolSlots(slots: WarmPoolSlot[]) {
  await Promise.all([...slots]
    .filter((slot) => !slot.leased)
    .map(async (slot) => {
      if (await containerExists(slot.containerName)) return
      await destroyWarmPoolSlot(slot)
    }))
}

async function prepareWarmPoolWorkspace(handle: SandboxHandle) {
  const slot = [...warmPoolByWorker.values()].flat().find((item) => item.id === handle.poolSlotId)
  const sandboxPath = handle.sandboxPath
  if (!slot || !sandboxPath) return
  await runWithWarmPoolCopyGate(async () => {
    await rm(slot.visiblePath, { recursive: true, force: true }).catch(() => {})
    await mkdir(slot.visiblePath, { recursive: true })
    await cp(sandboxPath, slot.visiblePath, {
      recursive: true,
      force: true,
      filter: (source) => !isInnerSandboxPath(source),
    })
  })
}

async function releaseWarmPoolSlot(handle: SandboxHandle) {
  const slot = [...warmPoolByWorker.values()].flat().find((item) => item.id === handle.poolSlotId)
  if (!slot) return
  if (handle.invalidPoolSlot || !await containerExists(slot.containerName)) {
    await destroyWarmPoolSlot(slot)
    return
  }
  try {
    await syncWarmPoolWorkspaceBack(handle, slot)
  } catch (error) {
    log.warn("warm pool workspace sync back failed", {
      workerId: slot.workerId,
      slotId: slot.id,
      businessSessionId: slot.leasedSessionId,
      message: error instanceof Error ? error.message : String(error),
    })
    await destroyWarmPoolSlot(slot)
    return
  }
  await rm(slot.visiblePath, { recursive: true, force: true }).catch(() => {})
  await mkdir(slot.visiblePath, { recursive: true })
  slot.leased = false
  slot.ready = true
  slot.leasedAt = undefined
  slot.leasedSessionId = undefined
  const target = warmPoolTargetByWorker.get(slot.workerId) ?? 0
  const readyCount = readWarmPool(slot.workerId).filter((item) => item.ready && !item.leased).length
  if (readyCount > target && target >= 0) {
    await destroyWarmPoolSlot(slot)
  }
}

function toWarmPoolSnapshot(workerId: string, slots: WarmPoolSlot[]) {
  return {
    workerId,
    target: warmPoolTargetByWorker.get(workerId) ?? 0,
    totalCount: slots.length,
    readyCount: slots.filter((slot) => slot.ready && !slot.leased).length,
    leasedCount: slots.filter((slot) => slot.leased).length,
    slots: slots.map((slot) => ({
      slotId: slot.id,
      containerName: slot.containerName,
      visiblePath: slot.visiblePath,
      status: slot.leased ? "leased" : slot.ready ? "warm" : "preparing",
      createdAt: slot.createdAt,
      leasedAt: slot.leasedAt,
      leasedSessionId: slot.leasedSessionId,
    })),
  }
}

function isInnerSandboxPath(source: string) {
  const relative = path.relative(path.join(Config.workspaceRootDir, ".sandbox"), source)
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

async function containerExists(containerName: string) {
  try {
    await docker.getContainer(containerName).inspect()
    return true
  } catch {
    return false
  }
}

async function syncWarmPoolWorkspaceBack(handle: SandboxHandle, slot: WarmPoolSlot) {
  const sandboxPath = handle.sandboxPath
  if (!sandboxPath) return
  // 中文/English: ACP writes into the warm slot mount; copy it back into the
  // session sandbox copy so diff generation observes the user's changes.
  await runWithWarmPoolCopyGate(async () => {
    await rm(sandboxPath, { recursive: true, force: true }).catch(() => {})
    await mkdir(sandboxPath, { recursive: true })
    await cp(slot.visiblePath, sandboxPath, {
      recursive: true,
      force: true,
      filter: (source) => !isInnerSandboxPath(source),
    })
  })
}

async function reclaimStaleLeasedWarmPoolSlots(workerId: string) {
  let reclaimed = 0
  for (const slot of [...readWarmPool(workerId)].filter((item) => item.leased)) {
    if (!shouldReclaimLeasedWarmPoolSlot(slot)) continue
    log.warn("reclaiming stale leased warm pool slot", {
      workerId,
      slotId: slot.id,
      leasedAt: slot.leasedAt,
      leasedSessionId: slot.leasedSessionId,
    })
    await destroyWarmPoolSlot(slot)
    reclaimed += 1
  }
  return reclaimed
}

function shouldReclaimLeasedWarmPoolSlot(slot: WarmPoolSlot) {
  if (!slot.leased) return false
  if (!slot.leasedAt || !slot.leasedSessionId) return true
  if (Date.now() - new Date(slot.leasedAt).getTime() < WARM_SLOT_RUNTIME_MISSING_GRACE_MS) return false
  return !findRuntimeByBusinessSessionId(slot.leasedSessionId)
}

function readWarmPoolContainerPrefix(workerId: string) {
  return `runtime-shell-warm-${workerId}-`
}
