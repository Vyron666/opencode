import type {
  ForkSessionResponse,
  LoadSessionResponse,
  NewSessionResponse,
  ResumeSessionResponse,
} from "@agentclientprotocol/sdk"
import type { AcpProcessClient } from "../acp/acp-process-client"
import type { PendingPermission, PendingQuestion } from "../types"

export type RuntimeSnapshot = {
  configOptions?: NewSessionResponse["configOptions"] | LoadSessionResponse["configOptions"] | ResumeSessionResponse["configOptions"] | ForkSessionResponse["configOptions"]
  models?: NewSessionResponse["models"] | LoadSessionResponse["models"] | ResumeSessionResponse["models"] | ForkSessionResponse["models"]
  modes?: NewSessionResponse["modes"] | LoadSessionResponse["modes"] | ResumeSessionResponse["modes"] | ForkSessionResponse["modes"]
}

export type RuntimeEntry = {
  remoteRuntimeId: string
  businessSessionId: string
  workerId: string
  workspacePath: string
  client: AcpProcessClient
  snapshot: RuntimeSnapshot
  closing: boolean
  openedAt: string
  lastEventAt?: string
  lastFailure?: {
    at: string
    message: string
    detail?: Record<string, unknown>
  }
  activePromptTrace?: {
    acceptedAt: string
    acceptedAtMs: number
    firstUpstreamEventAt?: string
    firstVisibleEventAt?: string
  }
  pendingPermissions: Map<string, PendingPermission>
  pendingQuestions: Map<string, PendingQuestion>
}
