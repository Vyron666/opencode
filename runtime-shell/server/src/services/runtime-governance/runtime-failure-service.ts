import * as RuntimeFailureLogRepo from "../../repos/runtime-failure-log-repo"
import type { RuntimeFailureType } from "../../types"

export async function recordRuntimeFailure(input: {
  businessSessionId?: string
  workerId?: string
  failureType: RuntimeFailureType
  message?: string
  detail?: Record<string, unknown>
}) {
  return RuntimeFailureLogRepo.createRuntimeFailureLog(input)
}
