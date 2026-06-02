import { spawnAcpProcess } from "../../acp/process-spawn"
import type { SandboxManager } from "./sandbox-manager"

export function createLocalProcessSandboxManager(): SandboxManager {
  return {
    prepare(input) {
      return {
        workspacePath: input.workspacePath,
        sandboxPath: input.sandboxPath,
      }
    },
    attachAcp(input) {
      return spawnAcpProcess(input.runtimeClientOptions)
    },
    async close(_input) {},
  }
}
