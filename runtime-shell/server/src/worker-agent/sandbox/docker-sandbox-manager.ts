import { PassThrough, Writable } from "node:stream"
import net from "node:net"
import path from "node:path"
import Docker from "dockerode"
import type { ChildProcessWithoutNullStreams } from "node:child_process"
import { Config } from "../../config"
import { createLogger } from "../../log"
import type { SandboxManager } from "./sandbox-manager"
import type { SandboxAttachInput, SandboxCloseInput, SandboxHandle, SandboxPrepareInput, SandboxWorkspaceMountMode } from "./sandbox-types"

const SANDBOX_CONFIG_PATH = "/tmp/runtime-shell-config.json"
const SANDBOX_BRIDGE_PORT = 4100
const log = createLogger("docker-sandbox")

const docker = new Docker({
  socketPath: Config.sandboxDockerSocketPath,
})

export function createDockerSandboxManager(): SandboxManager {
  return {
    prepare(input) {
      return {
        containerName: toContainerName(input),
        workspacePath: input.workspacePath,
        sandboxPath: input.sandboxPath,
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
      void stopDockerSandbox(input.handle, signal)
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
    const cwd = input.runtimeClientOptions.cwd
    const container = await ensureContainer({
      containerName: input.handle.containerName!,
      cwd,
      handle: input.handle,
      configContent: input.runtimeClientOptions.configContent,
    })
    await container.start()
    void followContainerStderr(container, input.stderr)
    const socket = await connectSandboxBridge(container)
    input.stdin.pipe(socket)
    socket.pipe(input.stdout)
    socket.once("close", () => {
      input.stdout.end()
      input.stderr.end()
    })
    socket.once("error", (error) => {
      input.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
      input.exitState.settle({ code: 1, signal: null })
    })
    void waitDockerSandboxExit(container).then((result) => {
      input.exitState.settle(result)
    })
  } catch (error) {
    if (input.handle.containerName) {
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
  configContent?: string
}) {
  await removeContainer(input.containerName)
  const workspaceMount = await toWorkspaceMount(input.handle, input.cwd)
  log.info("creating docker sandbox container", {
    containerName: input.containerName,
    image: Config.sandboxDockerImage,
    workingDir: Config.sandboxDockerSpawnCwd,
    cmd: ["bun", "--eval", "<runtime-shell-bridge>"],
    execCmd: ["bun", Config.sandboxDockerAcpEntry, "acp", `--cwd=${input.cwd}`],
    execArgs: ["--print-logs"],
    sessionCwd: input.cwd,
    workspacePath: input.handle.workspacePath,
    workspaceMountMode: toWorkspaceMountMode(),
    runtimeHomeDir: Config.sandboxRuntimeHomeDir,
    configPath: input.configContent ? SANDBOX_CONFIG_PATH : undefined,
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
    Env: [
      "OPENCODE_CLIENT=acp",
      `OPENCODE_ENABLE_QUESTION_TOOL=${process.env.OPENCODE_ENABLE_QUESTION_TOOL || "1"}`,
      `OPENCODE_ACP_NEXT=${process.env.OPENCODE_ACP_NEXT || "0"}`,
      // 中文/English: redirect all user-scoped runtime writes into one controlled
      // tmpfs-backed home so read-only rootfs does not require piecemeal exceptions.
      `HOME=${Config.sandboxRuntimeHomeDir}`,
      `XDG_CONFIG_HOME=${Config.sandboxRuntimeHomeDir}/.config`,
      `XDG_CACHE_HOME=${Config.sandboxRuntimeHomeDir}/.cache`,
      `XDG_STATE_HOME=${Config.sandboxRuntimeHomeDir}/.local/state`,
      `XDG_DATA_HOME=${Config.sandboxRuntimeHomeDir}/.local/share`,
      "TMPDIR=/tmp",
      ...(input.configContent ? [`OPENCODE_CONFIG=${SANDBOX_CONFIG_PATH}`] : []),
      ...(input.configContent ? [`RUNTIME_SHELL_CONFIG_B64=${Buffer.from(input.configContent).toString("base64")}`] : []),
      `RUNTIME_SHELL_BRIDGE_PORT=${SANDBOX_BRIDGE_PORT}`,
      `RUNTIME_SHELL_ACP_ENTRY=${Config.sandboxDockerAcpEntry}`,
      `RUNTIME_SHELL_ACP_CWD=${input.cwd}`,
      `RUNTIME_SHELL_ACP_SPAWN_CWD=${Config.sandboxDockerSpawnCwd}`,
    ],
    HostConfig: {
      AutoRemove: true,
      NetworkMode: Config.sandboxDockerNetworkMode,
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

function toWorkspaceMountMode(): SandboxWorkspaceMountMode {
  return Config.sandboxWorkspaceMountMode === "ro" ? "ro" : "rw"
}

async function toWorkspaceMount(handle: SandboxHandle, cwd: string) {
  const workspaceRoot = handle.sandboxPath || handle.workspacePath || cwd
  const mountMode = toWorkspaceMountMode()
  requireWorkspaceMountPath(workspaceRoot, cwd)
  return {
    Type: "bind" as const,
    Source: await toDockerHostWorkspacePath(workspaceRoot),
    Target: workspaceRoot,
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
  // 中文/English: allow either the workspace root itself or one of its child
  // workspaces, but never anything outside the configured workspace tree.
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
  // 中文/English: Docker daemon resolves bind sources in the host namespace,
  // so derive the source from the worker container mount instead of reusing its path.
  return path.join(workspaceMount.Source, relative)
}

function toSecurityOptions() {
  return [
    "no-new-privileges:true",
    ...(Config.sandboxDockerSeccompProfile ? [`seccomp=${Config.sandboxDockerSeccompProfile}`] : []),
    ...(Config.sandboxDockerAppArmorProfile ? [`apparmor=${Config.sandboxDockerAppArmorProfile}`] : []),
  ]
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
const config = process.env.RUNTIME_SHELL_CONFIG_B64
if (config) {
  fs.writeFileSync("${SANDBOX_CONFIG_PATH}", Buffer.from(config, "base64"), { mode: 0o600 })
  delete process.env.RUNTIME_SHELL_CONFIG_B64
}
const server = net.createServer((socket) => {
  const child = spawn("bun", [process.env.RUNTIME_SHELL_ACP_ENTRY, "acp", "--print-logs", "--cwd=" + process.env.RUNTIME_SHELL_ACP_CWD], {
    cwd: process.env.RUNTIME_SHELL_ACP_SPAWN_CWD,
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
  })
  child.stderr.pipe(process.stderr)
  socket.pipe(child.stdin)
  child.stdout.pipe(socket)
  child.on("exit", (code) => {
    socket.end()
    server.close(() => process.exit(typeof code === "number" ? code : 1))
  })
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
