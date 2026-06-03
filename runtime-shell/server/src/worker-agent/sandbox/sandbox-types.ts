import type { ChildProcessWithoutNullStreams } from "node:child_process"
import type { Socket } from "node:net"
import type { RuntimeClientOptions } from "../../acp/types"

export type SandboxBackend = "local-process" | "docker" | "gvisor" | "kata"

export type SandboxPrepareInput = {
  businessSessionId: string
  workerId: string
  workspacePath: string
  sandboxPath?: string
}

export type SandboxWorkspaceMountMode = "rw" | "ro"

export type SandboxHandle = {
  containerName?: string
  workspacePath?: string
  sandboxPath?: string
  runtimeCwd?: string
  poolSlotId?: string
  activeSocket?: Socket
  invalidPoolSlot?: boolean
  bootPromise?: Promise<void>
  closePromise?: Promise<void>
}

export type SandboxAttachInput = {
  handle: SandboxHandle
  runtimeClientOptions: RuntimeClientOptions
}

export type SandboxCloseInput = {
  handle: SandboxHandle
}

export type SandboxAcpProcess = ChildProcessWithoutNullStreams
