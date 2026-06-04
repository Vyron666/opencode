import { PassThrough } from "node:stream"
import type { ChildProcessWithoutNullStreams } from "node:child_process"
import type { SandboxAttachInput, SandboxHandle } from "./sandbox-types"
import { connectSandboxBridge, createExitState, followContainerStderr } from "./docker-sandbox-bridge"
import { docker, runWithRuntimeBootGate } from "./docker-sandbox-state"
import { ensureContainer, ensureDockerReady, removeContainer, startContainerIfNeeded, stopDockerSandbox, waitDockerSandboxExit } from "./docker-sandbox-container"
import { prepareWarmPoolWorkspace } from "./docker-sandbox-warm-pool"

export function attachDockerSandboxAcp(input: SandboxAttachInput): ChildProcessWithoutNullStreams {
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
      // 中文/English: leased warm-pool containers are reused across sessions, so
      // killing the adapter should only tear down the current ACP bridge socket.
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
    on(event: "exit", handler: (code: number | null, signal: NodeJS.Signals | null) => void) {
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
    const runtimeSessionCwd = input.handle.runtimeCwd || input.runtimeClientOptions.cwd
    if (input.handle.poolSlotId) {
      // 中文/English: warm-pool hits should wait only on workspace sync instead
      // of joining the cold-container boot gate again.
      await prepareWarmPoolWorkspace(input.handle)
    } else {
      await runWithRuntimeBootGate(async () => {
        const container = await ensureContainer({
          containerName: input.handle.containerName!,
          cwd: runtimeSessionCwd,
          handle: input.handle,
        })
        await startContainerIfNeeded(container)
        void followContainerStderr(container, input.stderr)
        void waitDockerSandboxExit(container).then((result) => {
          input.exitState.settle(result)
        })
      })
    }
    const socket = await connectSandboxBridge(docker.getContainer(input.handle.containerName!))
    input.handle.activeSocket = socket
    socket.write(JSON.stringify({
      cwd: runtimeSessionCwd,
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
