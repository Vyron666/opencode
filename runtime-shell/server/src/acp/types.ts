import type {
  CreateElicitationResponse,
  RequestPermissionResponse,
} from "@agentclientprotocol/sdk"
import type { PendingPermission, PendingQuestion, SessionEvent } from "../types"

export type OnEvent = (event: SessionEvent) => void | Promise<void>

export type PermissionResolution = {
  outcome: RequestPermissionResponse["outcome"]
  optionKind?: string
}

export type RuntimeClientOptions = {
  cwd: string
  onEvent: OnEvent
  workerId: string
  businessSessionId: string
  configContent?: string
}

export type RuntimeClientHooks = {
  onPermissionRequested: (permission: PendingPermission) => void
  waitForPermission: (requestId: string) => Promise<PermissionResolution>
  onQuestionRequested: (question: PendingQuestion) => void
  waitForQuestion: (requestId: string) => Promise<CreateElicitationResponse>
}

export type PendingResolver<T> = {
  resolve: (value: T) => void
  reject: (error?: unknown) => void
}
