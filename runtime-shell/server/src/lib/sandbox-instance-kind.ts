import type { SandboxInstance } from "../types"

export function isSystemWarmPoolSandboxInstance(
  sandbox: Pick<SandboxInstance, "projectId" | "businessSessionId"> & {
    detail?: Record<string, unknown>
  },
) {
  if (sandbox.detail?.source !== "warm_pool") return false
  return sandbox.projectId === "__warm_pool__" || sandbox.businessSessionId.startsWith("warm_pool:")
}
