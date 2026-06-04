import Docker from "dockerode"
import path from "node:path"
import { Config } from "../../config"
import { createBridgeScript } from "./docker-sandbox-bridge"
import { SANDBOX_BRIDGE_PORT, WARM_POOL_RUNTIME_CWD, docker, log } from "./docker-sandbox-state"
import type { SandboxHandle, SandboxWorkspaceMountMode } from "./sandbox-types"

const CONTAINER_LABEL_KIND = "runtime-shell.kind"
const CONTAINER_LABEL_WORKER_ID = "runtime-shell.worker_id"
const CONTAINER_LABEL_BUSINESS_SESSION_ID = "runtime-shell.business_session_id"
const CONTAINER_LABEL_WORKSPACE_ID = "runtime-shell.workspace_id"
const CONTAINER_LABEL_POOL_SLOT_ID = "runtime-shell.pool_slot_id"

export async function ensureContainer(input: {
  containerName: string
  handle: SandboxHandle
  cwd: string
}) {
  const existingContainer = await findReusableContainer(input.containerName)
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
  if (existingContainer) return existingContainer
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
    Labels: {
      [CONTAINER_LABEL_KIND]: input.handle.poolSlotId ? "warm_pool" : "runtime",
      [CONTAINER_LABEL_WORKER_ID]: input.handle.workerId || "",
      ...(input.handle.businessSessionId
        ? { [CONTAINER_LABEL_BUSINESS_SESSION_ID]: input.handle.businessSessionId }
        : {}),
      ...(input.handle.workspaceId
        ? { [CONTAINER_LABEL_WORKSPACE_ID]: input.handle.workspaceId }
        : {}),
      ...(input.handle.poolSlotId
        ? { [CONTAINER_LABEL_POOL_SLOT_ID]: input.handle.poolSlotId }
        : {}),
    },
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

export async function ensureDockerReady() {
  try {
    await docker.ping()
  } catch (error) {
    throw new Error(
      `docker sandbox backend is unavailable: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

export async function removeContainer(containerName: string) {
  try {
    await docker.getContainer(containerName).remove({ force: true })
  } catch {}
}

export async function startContainerIfNeeded(container: Docker.Container) {
  try {
    const inspect = await container.inspect()
    if (inspect.State?.Running) return
    await container.start()
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()
    if (message.includes("already started") || message.includes("is already in progress")) return
    throw error
  }
}

export async function stopDockerSandbox(handle: SandboxHandle, signal?: NodeJS.Signals | number) {
  if (!handle.containerName) return
  try {
    await docker.getContainer(handle.containerName).stop({
      signal: typeof signal === "string" ? signal : undefined,
      t: 1,
    })
  } catch {}
}

export async function waitDockerSandboxExit(container: Docker.Container) {
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

export async function containerExists(containerName: string) {
  try {
    await docker.getContainer(containerName).inspect()
    return true
  } catch {
    return false
  }
}

export function readContainerName(container: Docker.ContainerInfo) {
  return (container.Names || [])
    .map((name) => name.replace(/^\/+/, ""))
    .find(Boolean)
}

export function readWarmPoolContainerIdentity(container: Docker.ContainerInfo, containerName?: string) {
  const labeledWorkerId = container.Labels?.[CONTAINER_LABEL_WORKER_ID]
  const labeledSlotId = container.Labels?.[CONTAINER_LABEL_POOL_SLOT_ID]
  const labeledKind = container.Labels?.[CONTAINER_LABEL_KIND]
  if (labeledKind === "warm_pool" && labeledWorkerId && labeledSlotId) {
    return {
      workerId: labeledWorkerId,
      slotId: labeledSlotId,
    }
  }
  if (!containerName) return
  const prefix = "runtime-shell-warm-"
  if (!containerName.startsWith(prefix)) return
  const suffix = containerName.slice(prefix.length)
  const slotMarker = "-warm_"
  const slotIndex = suffix.lastIndexOf(slotMarker)
  if (slotIndex < 0) return
  return {
    workerId: suffix.slice(0, slotIndex),
    slotId: suffix.slice(slotIndex + 1),
  }
}

export function readRuntimeContainerIdentity(container: Docker.ContainerInfo, containerName?: string) {
  const labeledWorkerId = container.Labels?.[CONTAINER_LABEL_WORKER_ID]
  const labeledWorkspaceId = container.Labels?.[CONTAINER_LABEL_WORKSPACE_ID]
  const labeledBusinessSessionId = container.Labels?.[CONTAINER_LABEL_BUSINESS_SESSION_ID]
  const labeledKind = container.Labels?.[CONTAINER_LABEL_KIND]
  if (labeledKind === "runtime" && labeledWorkerId && labeledWorkspaceId) {
    return {
      workerId: labeledWorkerId,
      workspaceId: labeledWorkspaceId,
      businessSessionId: labeledBusinessSessionId,
    }
  }
  if (!containerName) return
  const prefix = "runtime-shell-acp-"
  if (!containerName.startsWith(prefix)) return
  const suffix = containerName.slice(prefix.length)
  const workspaceMarker = "__ws__"
  const workspaceIndex = suffix.lastIndexOf(workspaceMarker)
  if (workspaceIndex < 0) return
  return {
    workerId: suffix.slice(0, workspaceIndex),
    workspaceId: suffix.slice(workspaceIndex + workspaceMarker.length),
  }
}

function buildSandboxEnv() {
  return [
    "OPENCODE_CLIENT=acp",
    "OPENCODE_DISABLE_MODELS_FETCH=1",
    `OPENCODE_MODELS_PATH=${Config.sandboxDockerModelsPath}`,
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

async function findReusableContainer(containerName: string) {
  try {
    const container = docker.getContainer(containerName)
    const inspect = await container.inspect()
    if (inspect.State?.Running || inspect.State?.Status === "created") {
      return container
    }
    await removeContainer(containerName)
    return
  } catch {
    return
  }
}
