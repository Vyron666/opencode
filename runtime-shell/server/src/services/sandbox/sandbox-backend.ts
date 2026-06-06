import { Config } from "../../config"
import type { SandboxBackend } from "../../types"

export function readSandboxBackend(): SandboxBackend {
  if (Config.sandboxBackend === "gvisor") return "gvisor"
  if (Config.sandboxBackend === "kata") return "kata"
  if (Config.sandboxBackend === "docker") return "docker"
  return "local-process"
}
