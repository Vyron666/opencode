import type {
  CreateElicitationResponse,
  ElicitationContentValue,
  ForkSessionResponse,
  LoadSessionResponse,
  NewSessionResponse,
  ResumeSessionResponse,
} from "@agentclientprotocol/sdk"
import type { ManagedRuntimeClient } from "./runtime-client"

export type RuntimeEntry = {
  client: ManagedRuntimeClient
  // 中文/English: runtime-shell 只接真实 ACP runtime，不提供 mock transport。
  transport: "real"
}

export type SessionBootstrap = {
  sessionId: string
  configOptions?: NewSessionResponse["configOptions"]
  models?: NewSessionResponse["models"] | LoadSessionResponse["models"] | ResumeSessionResponse["models"] | ForkSessionResponse["models"]
  modes?: NewSessionResponse["modes"] | LoadSessionResponse["modes"] | ResumeSessionResponse["modes"] | ForkSessionResponse["modes"]
}

export type PermissionResponder = {
  resolve: (decision: { approved: boolean; optionId?: string }) => boolean | Promise<boolean>
}

export type QuestionResponder = {
  resolve: (res: { action: "accept" | "decline" | "cancel"; content?: Record<string, ElicitationContentValue> }) => boolean | Promise<boolean>
}

export function toElicitationContent(input?: Record<string, unknown>) {
  if (!input) return {}
  const out: Record<string, ElicitationContentValue> = {}
  Object.entries(input).forEach(([key, value]) => {
    const mapped = toElicitationContentValue(value)
    if (mapped === undefined) return
    out[key] = mapped
  })
  return out
}

function toElicitationContentValue(value: unknown): ElicitationContentValue | undefined {
  if (typeof value === "string") return value
  if (typeof value === "number") return value
  if (typeof value === "boolean") return value
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) return value
  return undefined
}
