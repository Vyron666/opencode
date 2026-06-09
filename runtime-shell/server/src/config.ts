import path from "node:path"
import { type ParseError, parse } from "jsonc-parser"

export type LocalWorkerConfig = {
  id: string
  workerCode: string
  name: string
  baseUrl: string
  agentBaseUrl?: string
  capacity: number
  version?: string
  warmPoolTarget?: number
}

function parseLocalWorkers(raw: string | undefined) {
  if (!raw) return []
  const errors: ParseError[] = []
  const parsed = parse(raw, errors)
  if (errors.length > 0 || !Array.isArray(parsed)) return []
  return parsed.flatMap((item) => {
    if (!item || typeof item !== "object") return []
    const baseUrl = typeof item.baseUrl === "string" ? item.baseUrl.replace(/\/+$/, "") : ""
    const agentBaseUrl =
      typeof item.agentBaseUrl === "string" && item.agentBaseUrl
        ? item.agentBaseUrl.replace(/\/+$/, "")
        : baseUrl
          ? baseUrl.replace(/:\d+$/, ":4097")
          : ""
    const id = typeof item.id === "string" ? item.id : ""
    const workerCode = typeof item.workerCode === "string" ? item.workerCode : id
    const name = typeof item.name === "string" ? item.name : workerCode
    const capacity = Number(item.capacity)
    const warmPoolTarget = Number(item.warmPoolTarget)
    if (!id || !workerCode || !name || !baseUrl || !Number.isFinite(capacity) || capacity <= 0) return []
    return [{
      id,
      workerCode,
      name,
      baseUrl,
      agentBaseUrl,
      capacity,
      version: typeof item.version === "string" ? item.version : undefined,
      warmPoolTarget: Number.isFinite(warmPoolTarget) && warmPoolTarget >= 0 ? warmPoolTarget : undefined,
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
    agentBaseUrl: (process.env.RUNTIME_SHELL_WORKER_AGENT_BASE_URL || "http://127.0.0.1:4097").replace(/\/+$/, ""),
    capacity: 16,
    version: "local",
    warmPoolTarget: Number(process.env.RUNTIME_SHELL_SANDBOX_WARM_POOL_TARGET || "0"),
  }] satisfies LocalWorkerConfig[]
}

export function findLocalWorkerConfig(workerId: string) {
  return Config.localWorkers.find((worker) => worker.id === workerId)
}

export const Config = {
  host: process.env.RUNTIME_SHELL_HOST || "0.0.0.0",
  port: Number(process.env.RUNTIME_SHELL_PORT || "3000"),
  publicBaseUrl: (process.env.RUNTIME_SHELL_PUBLIC_BASE_URL || "http://127.0.0.1:3000").replace(/\/+$/, ""),
  // 中文/English: sandboxed ACP must call runtime-shell through the Docker network,
  // not the browser-facing loopback URL published on the host.
  internalBaseUrl: (process.env.RUNTIME_SHELL_INTERNAL_BASE_URL || process.env.RUNTIME_SHELL_PUBLIC_BASE_URL || "http://127.0.0.1:3000").replace(/\/+$/, ""),
  adminUsername: process.env.RUNTIME_SHELL_ADMIN_USERNAME || "admin",
  adminPassword: process.env.RUNTIME_SHELL_ADMIN_PASSWORD || "change-me",
  sessionCookie: process.env.RUNTIME_SHELL_SESSION_COOKIE || "runtime_shell_session",
  sessionSecret: process.env.RUNTIME_SHELL_SESSION_SECRET || "change-me",
  dataFile: path.resolve(process.cwd(), process.env.RUNTIME_SHELL_DATA_FILE || "./data/runtime-shell.json"),
  storageDir: path.resolve(process.cwd(), process.env.RUNTIME_SHELL_STORAGE_DIR || "./data/storage"),
  workspaceRootDir: path.resolve(process.env.RUNTIME_SHELL_WORKSPACE_ROOT_DIR || "/workspace/workspaces"),
  opencodeBaseUrl: (process.env.OPENCODE_BASE_URL || "http://127.0.0.1:4096").replace(/\/+$/, ""),
  sandboxWorkspaceTtlMs: Number(process.env.RUNTIME_SHELL_SANDBOX_WORKSPACE_TTL_MS || `${24 * 60 * 60 * 1000}`),
  opencodeUsername: process.env.OPENCODE_SERVER_USERNAME || "opencode",
  opencodePassword: process.env.OPENCODE_SERVER_PASSWORD || "",
  workerAgentToken: process.env.RUNTIME_SHELL_WORKER_AGENT_TOKEN || "change-me-worker-agent",
  workerAgentRequestTimeoutMs: Number(process.env.RUNTIME_SHELL_WORKER_AGENT_REQUEST_TIMEOUT_MS || "45000"),
  workerExecutionMode: process.env.RUNTIME_SHELL_WORKER_EXECUTION_MODE || "local",
  sandboxBackend: process.env.RUNTIME_SHELL_SANDBOX_BACKEND || "local-process",
  sandboxDockerImage: process.env.RUNTIME_SHELL_SANDBOX_IMAGE || "opencode-local:latest",
  sandboxDockerAcpEntry: process.env.OPENCODE_ACP_ENTRY || "/workspace/packages/opencode/src/index.ts",
  sandboxDockerSpawnCwd: process.env.OPENCODE_ACP_SPAWN_CWD || "/workspace",
  // 中文/English: docker sandboxes must reuse the same local models catalog path
  // as the worker runtime when remote catalog fetch is intentionally disabled.
  sandboxDockerModelsPath: process.env.OPENCODE_MODELS_PATH || "/workspace/runtime-shell/config/models-api.runtime.json",
  sandboxDockerSocketPath: process.env.RUNTIME_SHELL_SANDBOX_DOCKER_SOCKET || "/var/run/docker.sock",
  sandboxDockerNetworkMode: process.env.RUNTIME_SHELL_SANDBOX_NETWORK_MODE || "runtime-shell_default",
  sandboxDockerUser: process.env.RUNTIME_SHELL_SANDBOX_USER || "1000:1000",
  sandboxDockerWorkspaceHostRoot: process.env.RUNTIME_SHELL_SANDBOX_WORKSPACE_HOST_ROOT || "",
  sandboxDockerSeccompProfile: process.env.RUNTIME_SHELL_SANDBOX_SECCOMP_PROFILE || "",
  sandboxDockerAppArmorProfile: process.env.RUNTIME_SHELL_SANDBOX_APPARMOR_PROFILE || "",
  // 中文/English: keep default sandbox resources modest so local multi-user bursts
  // queue under governance instead of exhausting the Docker host outright.
  sandboxDockerMemoryBytes: Number(process.env.RUNTIME_SHELL_SANDBOX_MEMORY_BYTES || `${1536 * 1024 * 1024}`),
  sandboxDockerNanoCpus: Number(process.env.RUNTIME_SHELL_SANDBOX_NANO_CPUS || `${1_000_000_000}`),
  sandboxDockerPidsLimit: Number(process.env.RUNTIME_SHELL_SANDBOX_PIDS_LIMIT || "256"),
  sandboxWorkspaceMountMode: process.env.RUNTIME_SHELL_SANDBOX_WORKSPACE_MOUNT_MODE || "rw",
  sandboxRuntimeHomeDir: process.env.RUNTIME_SHELL_SANDBOX_RUNTIME_HOME_DIR || "/tmp/runtime-shell-home",
  sandboxRuntimeClass: process.env.RUNTIME_SHELL_SANDBOX_RUNTIME_CLASS || "",
  sandboxIsolationMode: process.env.RUNTIME_SHELL_SANDBOX_ISOLATION_MODE || "",
  sandboxWorkspacePrepareConcurrency: Number(process.env.RUNTIME_SHELL_SANDBOX_PREPARE_CONCURRENCY || "4"),
  // 中文/English: ACP bootstrap is CPU/IO heavy; a small per-worker default keeps
  // cold starts fast under bursts instead of letting many bootstraps thrash together.
  sandboxRuntimeBootConcurrency: Number(process.env.RUNTIME_SHELL_SANDBOX_RUNTIME_BOOT_CONCURRENCY || "2"),
  sandboxColdStartConcurrency: Number(process.env.RUNTIME_SHELL_SANDBOX_COLD_START_CONCURRENCY || "4"),
  // 中文/English: keep a small explicit local worker list so scheduler and governance
  // can exercise multi-node behavior before remote execution is fully separated.
  localWorkers: readLocalWorkers(),
  workerHeartbeatTimeoutMs: Number(process.env.RUNTIME_SHELL_WORKER_HEARTBEAT_TIMEOUT_MS || "15000"),
  // 中文/English: keep runtime lease much longer than a brief user idle period so
  // reopening the same session/workspace usually continues without manual recovery.
  runtimeLeaseDurationMs: Number(process.env.RUNTIME_SHELL_RUNTIME_LEASE_DURATION_MS || "600000"),
  runtimeGovernanceIntervalMs: Number(process.env.RUNTIME_SHELL_RUNTIME_GOVERNANCE_INTERVAL_MS || "5000"),
  sessionClientPresenceGraceMs: Number(process.env.RUNTIME_SHELL_SESSION_CLIENT_PRESENCE_GRACE_MS || "1800000"),
}
