import path from "node:path"
import { type ParseError, parse } from "jsonc-parser"

export type CustomModel = {
  modelId: string
  name: string
  providerId?: string
}

function parseCustomModels(raw: string): CustomModel[] {
  const errors: ParseError[] = []
  const parsed = parse(raw, errors)
  if (errors.length > 0 || !Array.isArray(parsed)) return []
  return parsed.filter(
    (item): item is CustomModel =>
      typeof item === "object" && item !== null && typeof item.modelId === "string" && typeof item.name === "string",
  )
}

async function loadCustomModelsFile(filePath: string): Promise<CustomModel[]> {
  const file = Bun.file(filePath)
  if (!(await file.exists())) return []
  return parseCustomModels(await file.text())
}

let customModelsCache: CustomModel[] | null = null

export async function getCustomModels(): Promise<CustomModel[]> {
  if (customModelsCache !== null) return customModelsCache
  const envRaw = process.env.RUNTIME_SHELL_CUSTOM_MODELS
  if (envRaw) {
    customModelsCache = parseCustomModels(envRaw)
  } else {
    customModelsCache = []
  }
  const filePath = process.env.RUNTIME_SHELL_CUSTOM_MODELS_FILE || path.resolve(process.cwd(), "./data/custom-models.json")
  const fileModels = await loadCustomModelsFile(filePath)
  const merged = new Map<string, CustomModel>()
  customModelsCache.forEach((m) => merged.set(m.modelId, m))
  fileModels.forEach((m) => merged.set(m.modelId, m))
  customModelsCache = [...merged.values()]
  return customModelsCache
}

export function invalidateCustomModelsCache() {
  customModelsCache = null
}

export const Config = {
  host: process.env.RUNTIME_SHELL_HOST || "0.0.0.0",
  port: Number(process.env.RUNTIME_SHELL_PORT || "3000"),
  adminUsername: process.env.RUNTIME_SHELL_ADMIN_USERNAME || "admin",
  adminPassword: process.env.RUNTIME_SHELL_ADMIN_PASSWORD || "change-me",
  sessionCookie: process.env.RUNTIME_SHELL_SESSION_COOKIE || "runtime_shell_session",
  sessionSecret: process.env.RUNTIME_SHELL_SESSION_SECRET || "change-me",
  dataFile: path.resolve(process.cwd(), process.env.RUNTIME_SHELL_DATA_FILE || "./data/runtime-shell.json"),
  workspaceRootDir: path.resolve(process.env.RUNTIME_SHELL_WORKSPACE_ROOT_DIR || "/workspace/workspaces"),
  opencodeBaseUrl: (process.env.OPENCODE_BASE_URL || "http://127.0.0.1:4096").replace(/\/+$/, ""),
  opencodeUsername: process.env.OPENCODE_SERVER_USERNAME || "opencode",
  opencodePassword: process.env.OPENCODE_SERVER_PASSWORD || "",
  workerHeartbeatTimeoutMs: Number(process.env.RUNTIME_SHELL_WORKER_HEARTBEAT_TIMEOUT_MS || "30000"),
  // 中文/English: keep runtime lease much longer than a brief user idle period so
  // reopening the same session/workspace usually continues without manual recovery.
  runtimeLeaseDurationMs: Number(process.env.RUNTIME_SHELL_RUNTIME_LEASE_DURATION_MS || "600000"),
  runtimeGovernanceIntervalMs: Number(process.env.RUNTIME_SHELL_RUNTIME_GOVERNANCE_INTERVAL_MS || "10000"),
}
