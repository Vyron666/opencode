import path from "node:path"
import { type ParseError, parse } from "jsonc-parser"

export type CustomModel = {
  modelId: string
  name: string
  providerId?: string
}

export type LocalWorkerConfig = {
  id: string
  workerCode: string
  name: string
  baseUrl: string
  capacity: number
  version?: string
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

export function getCustomModelsFilePath() {
  return process.env.RUNTIME_SHELL_CUSTOM_MODELS_FILE || `${Config.dataFile}.custom-models.json`
}

export async function getCustomModels(): Promise<CustomModel[]> {
  if (customModelsCache !== null) return customModelsCache
  const envRaw = process.env.RUNTIME_SHELL_CUSTOM_MODELS
  if (envRaw) {
    customModelsCache = parseCustomModels(envRaw)
  } else {
    customModelsCache = []
  }
  const filePath = getCustomModelsFilePath()
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

function parseLocalWorkers(raw: string | undefined) {
  if (!raw) return []
  const errors: ParseError[] = []
  const parsed = parse(raw, errors)
  if (errors.length > 0 || !Array.isArray(parsed)) return []
  return parsed.flatMap((item) => {
    if (!item || typeof item !== "object") return []
    const baseUrl = typeof item.baseUrl === "string" ? item.baseUrl.replace(/\/+$/, "") : ""
    const id = typeof item.id === "string" ? item.id : ""
    const workerCode = typeof item.workerCode === "string" ? item.workerCode : id
    const name = typeof item.name === "string" ? item.name : workerCode
    const capacity = Number(item.capacity)
    if (!id || !workerCode || !name || !baseUrl || !Number.isFinite(capacity) || capacity <= 0) return []
    return [{
      id,
      workerCode,
      name,
      baseUrl,
      capacity,
      version: typeof item.version === "string" ? item.version : undefined,
    } satisfies LocalWorkerConfig]
  })
}

function readLocalWorkers() {
  const configured = parseLocalWorkers(process.env.RUNTIME_SHELL_LOCAL_WORKERS)
  if (configured.length > 0) return configured
  return [{
    id: "worker_local",
    workerCode: "worker_local",
    name: "opencode-worker",
    baseUrl: (process.env.OPENCODE_BASE_URL || "http://127.0.0.1:4096").replace(/\/+$/, ""),
    capacity: 16,
    version: "local",
  }] satisfies LocalWorkerConfig[]
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
  // 中文/English: keep a small explicit local worker list so scheduler and governance
  // can exercise multi-node behavior before remote execution is fully separated.
  localWorkers: readLocalWorkers(),
  workerHeartbeatTimeoutMs: Number(process.env.RUNTIME_SHELL_WORKER_HEARTBEAT_TIMEOUT_MS || "30000"),
  // 中文/English: keep runtime lease much longer than a brief user idle period so
  // reopening the same session/workspace usually continues without manual recovery.
  runtimeLeaseDurationMs: Number(process.env.RUNTIME_SHELL_RUNTIME_LEASE_DURATION_MS || "600000"),
  runtimeGovernanceIntervalMs: Number(process.env.RUNTIME_SHELL_RUNTIME_GOVERNANCE_INTERVAL_MS || "10000"),
}
