import type {
  ForkSessionResponse,
  LoadSessionResponse,
  NewSessionResponse,
  ResumeSessionResponse,
} from "@agentclientprotocol/sdk"
import type { AcpProcessClient } from "../acp/acp-process-client"
import type { PendingPermission, PendingQuestion } from "../types"
import type { SandboxHandle } from "./sandbox/sandbox-types"

export type RuntimeSnapshot = {
  configOptions?: NewSessionResponse["configOptions"] | LoadSessionResponse["configOptions"] | ResumeSessionResponse["configOptions"] | ForkSessionResponse["configOptions"]
  models?: NewSessionResponse["models"] | LoadSessionResponse["models"] | ResumeSessionResponse["models"] | ForkSessionResponse["models"]
  modes?: NewSessionResponse["modes"] | LoadSessionResponse["modes"] | ResumeSessionResponse["modes"] | ForkSessionResponse["modes"]
}

export type RuntimeEntry = {
  remoteRuntimeId: string
  businessSessionId: string
  workspaceId: string
  workerId: string
  workspacePath: string
  sandboxPath?: string
  sandboxHandle?: SandboxHandle
  closeSandbox?: () => Promise<void>
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
