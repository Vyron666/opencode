import type {
  ContentBlock,
  CreateElicitationResponse,
  ForkSessionResponse,
  LoadSessionResponse,
  NewSessionResponse,
  PromptResponse,
  ResumeSessionResponse,
  SetSessionConfigOptionResponse,
  SetSessionModeResponse,
  SetSessionModelResponse,
} from "@agentclientprotocol/sdk"
import type { PendingPermission, PendingQuestion } from "../types"

export type RuntimeForkSource = {
  sourceBusinessSessionId?: string
  preserveSourceSessionBinding?: boolean
}

export type ManagedRuntimeClient = {
  onPermissionRequested: (handler: (permission: PendingPermission) => void) => void
  onQuestionRequested: (handler: (question: PendingQuestion) => void) => void
  newSession: (cwd: string) => Promise<NewSessionResponse>
  loadSession: (cwd: string, sessionId: string) => Promise<LoadSessionResponse>
  resumeSession: (cwd: string, sessionId: string) => Promise<ResumeSessionResponse>
  forkSession: (cwd: string, sessionId: string, source?: RuntimeForkSource) => Promise<ForkSessionResponse>
  rebuildSession?: (cwd: string, sessionId: string) => Promise<LoadSessionResponse>
  prompt: (parts: ContentBlock[]) => Promise<PromptResponse>
  flushPendingEvents: () => Promise<void>
  cancel: () => Promise<void>
  hasActivePrompt: () => boolean
  setSessionMode: (modeId: string) => Promise<SetSessionModeResponse>
  setSessionModel: (modelId: string) => Promise<SetSessionModelResponse>
  setSessionConfigOption: (configId: string, value: string | boolean) => Promise<SetSessionConfigOptionResponse>
  resolvePermission: (requestId: string, optionId: string) => boolean
  rejectPermission: (requestId: string) => boolean
  resolveQuestion: (requestId: string, response: CreateElicitationResponse) => boolean
  prewarm?: () => Promise<void>
  close: () => Promise<void>
  closeSession: (sessionId: string) => Promise<void>
  getSessionId: () => string
  onExit: (handler: (code: number | null, signal: NodeJS.Signals | null) => void) => () => void
}
