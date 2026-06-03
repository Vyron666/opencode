import type { RuntimeClientOptions } from "../../acp/types"
import type {
  SandboxAcpProcess,
  SandboxAttachInput,
  SandboxCloseInput,
  SandboxHandle,
  SandboxPrepareInput,
} from "./sandbox-types"
import { createDockerSandboxManager } from "./docker-sandbox-manager"
import { createLocalProcessSandboxManager } from "./local-process-sandbox-manager"

export type SandboxManager = {
  prepare: (input: SandboxPrepareInput) => SandboxHandle
  attachAcp: (input: SandboxAttachInput) => SandboxAcpProcess
  close: (input: SandboxCloseInput) => Promise<void>
}

export type RuntimeProcessFactory = (options: RuntimeClientOptions) => SandboxAcpProcess

export function createSandboxManager(backend: string): SandboxManager {
  if (backend === "local-process") return createLocalProcessSandboxManager()
  if (backend === "docker" || backend === "gvisor" || backend === "kata") return createDockerSandboxManager()
  throw new Error(`unsupported sandbox backend: ${backend}`)
}
