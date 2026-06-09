import path from "node:path"
import { parse, type ParseError } from "jsonc-parser"

type LocalWorkerComposeConfig = {
  count: number
  capacity: number
  warmPoolTarget: number
  sandboxMemoryBytes: number
  sandboxNanoCpus: number
  sandboxPidsLimit: number
}

const runtimeShellDir = path.resolve(import.meta.dir, "..")
const configPath = path.join(runtimeShellDir, "config", "local-workers.jsonc")
const composePath = path.join(runtimeShellDir, "docker-compose.yml")
const composeWorkspaceDir = "../docker-data/runtime-shell-workspaces"
const composeRuntimeDataDir = "../docker-data/runtime-shell-data"
const containerWorkspaceDir = "/workspace/workspaces"
const containerRuntimeDataDir = "/runtime-shell-data"

const config = await readConfig()
const composeText = buildCompose(config)
await Bun.write(composePath, composeText)
console.log(
  JSON.stringify({
    ok: true,
    composePath,
    workerCount: config.count,
    workerCapacity: config.capacity,
  }),
)

async function readConfig() {
  const raw = await Bun.file(configPath).text()
  const errors: ParseError[] = []
  const parsed = parse(raw, errors)
  if (errors.length > 0 || !parsed || typeof parsed !== "object") {
    throw new Error(`invalid local worker config: ${configPath}`)
  }
  const count = Number(parsed.count)
  const capacity = Number(parsed.capacity)
  const warmPoolTarget = Number(parsed.warmPoolTarget ?? 0)
  const sandboxMemoryBytes = Number(parsed.sandboxMemoryBytes ?? 1536 * 1024 * 1024)
  const sandboxNanoCpus = Number(parsed.sandboxNanoCpus ?? 1_000_000_000)
  const sandboxPidsLimit = Number(parsed.sandboxPidsLimit ?? 256)
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`local worker count must be a positive integer: ${count}`)
  }
  if (!Number.isInteger(capacity) || capacity < 1) {
    throw new Error(`local worker capacity must be a positive integer: ${capacity}`)
  }
  if (!Number.isInteger(warmPoolTarget) || warmPoolTarget < 0) {
    throw new Error(`local worker warmPoolTarget must be a non-negative integer: ${warmPoolTarget}`)
  }
  if (!Number.isInteger(sandboxMemoryBytes) || sandboxMemoryBytes < 268435456) {
    throw new Error(`sandboxMemoryBytes must be an integer >= 268435456: ${sandboxMemoryBytes}`)
  }
  if (!Number.isInteger(sandboxNanoCpus) || sandboxNanoCpus < 250000000) {
    throw new Error(`sandboxNanoCpus must be an integer >= 250000000: ${sandboxNanoCpus}`)
  }
  if (!Number.isInteger(sandboxPidsLimit) || sandboxPidsLimit < 64) {
    throw new Error(`sandboxPidsLimit must be an integer >= 64: ${sandboxPidsLimit}`)
  }
  return {
    count,
    capacity,
    warmPoolTarget,
    sandboxMemoryBytes,
    sandboxNanoCpus,
    sandboxPidsLimit,
  } satisfies LocalWorkerComposeConfig
}

function buildCompose(config: LocalWorkerComposeConfig) {
  const workerServices = Array.from({ length: config.count }, (_, index) => buildWorkerService(index + 1, config)).join("\n\n")
  const dependsOn = Array.from({ length: config.count }, (_, index) => {
    const serviceName = readWorkerServiceName(index + 1)
    return `      ${serviceName}:\n        condition: service_started`
  }).join("\n")
  const localWorkers = JSON.stringify(
    Array.from({ length: config.count }, (_, index) => {
      const workerIndex = index + 1
      return {
        id: readWorkerId(workerIndex),
        workerCode: readWorkerId(workerIndex),
        name: readWorkerServiceName(workerIndex),
        baseUrl: `http://${readWorkerServiceName(workerIndex)}:4097`,
        agentBaseUrl: `http://${readWorkerServiceName(workerIndex)}:4097`,
        capacity: config.capacity,
        version: `local-${workerIndex}`,
        warmPoolTarget: config.warmPoolTarget,
      }
    }),
  )

  return `services:
  postgres:
    image: postgres:16
    container_name: runtime-shell-postgres
    restart: unless-stopped
    environment:
      POSTGRES_DB: runtime_shell
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: change-me
      # 中文/English: local compose needs host auth for runtime-shell over the Docker network.
      POSTGRES_HOST_AUTH_METHOD: trust
    ports:
      - "5433:5432"
    volumes:
      - ../docker-data/runtime-shell-postgres:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d runtime_shell"]
      interval: 3s
      timeout: 3s
      retries: 20
      start_period: 3s

${workerServices}

  runtime-shell:
    build:
      context: ..
      dockerfile: runtime-shell/Dockerfile
    container_name: runtime-shell
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
${dependsOn}
    environment:
      RUNTIME_SHELL_HOST: 0.0.0.0
      RUNTIME_SHELL_PORT: 3000
      # 中文/English: browser-facing package URLs must use the published host port.
      RUNTIME_SHELL_PUBLIC_BASE_URL: http://127.0.0.1:3100
      RUNTIME_SHELL_INTERNAL_BASE_URL: http://runtime-shell:3000
      RUNTIME_SHELL_ADMIN_USERNAME: admin
      RUNTIME_SHELL_ADMIN_PASSWORD: change-me
      RUNTIME_SHELL_SESSION_COOKIE: runtime_shell_session
      RUNTIME_SHELL_SESSION_SECRET: change-me
      RUNTIME_SHELL_DATA_FILE: ${containerRuntimeDataDir}/runtime-shell.json
      RUNTIME_SHELL_STORAGE_DIR: ${containerRuntimeDataDir}/storage
      RUNTIME_SHELL_DB_DIALECT: postgres
      RUNTIME_SHELL_DB_URL: postgresql://postgres:change-me@postgres:5432/runtime_shell
      RUNTIME_SHELL_DB_SSL_MODE: disable
      OPENCODE_BASE_URL: http://${readWorkerServiceName(1)}:4097
      RUNTIME_SHELL_WORKER_EXECUTION_MODE: remote
      RUNTIME_SHELL_WORKER_AGENT_TOKEN: change-me-worker-agent
      # 中文/English: runtime-shell must observe the same sandbox backend as workers,
      # otherwise system sandbox records fall back to local-process on the server side.
      RUNTIME_SHELL_SANDBOX_BACKEND: docker
      RUNTIME_SHELL_LOCAL_WORKERS: >-
        ${localWorkers}
      OPENCODE_SERVER_USERNAME: opencode
      OPENCODE_SERVER_PASSWORD: change-me
      OPENCODE_DISABLE_MODELS_FETCH: "1"
      OPENCODE_MODELS_PATH: /app/config/models-api.runtime.json
      OPENCODE_CONFIG: /app/config/opencode.example.jsonc
      OPENCODE_DISABLE_PROJECT_CONFIG: "1"
      # 中文/English: ACP subprocesses still need the runtime-shell config file to load custom providers and models.
      OPENCODE_ACP_ENTRY: /workspace/packages/opencode/src/index.ts
      OPENCODE_ACP_SPAWN_CWD: /workspace
      # 中文/English: runtime-shell now defaults to the ACP-next entrypoint.
      OPENCODE_ACP_NEXT: "0"
      # 中文/English: log level: debug | info | warn | error (default info).
      RUNTIME_SHELL_LOG_LEVEL: info
    ports:
      - "3100:3000"
    volumes:
      - ${composeRuntimeDataDir}:${containerRuntimeDataDir}
      - ../.opencode:/workspace/.opencode
      - ${composeWorkspaceDir}:${containerWorkspaceDir}
      # 中文/English: runtime-shell spawned ACP uses its own local OpenCode data directory.
      # Do not share db/auth state with opencode-worker, otherwise two local instances can conflict.
      - ../docker-data/runtime-shell-opencode:/root/.local/share/opencode
    working_dir: /app
`
}

function buildWorkerService(workerIndex: number, config: LocalWorkerComposeConfig) {
  const serviceName = readWorkerServiceName(workerIndex)
  return `  ${serviceName}:
    build:
      context: ..
      dockerfile: Dockerfile
    container_name: ${serviceName}
    restart: unless-stopped
    environment:
      OPENCODE_SERVER_USERNAME: opencode
      OPENCODE_SERVER_PASSWORD: change-me
      OPENCODE_DISABLE_MODELS_FETCH: "1"
      OPENCODE_MODELS_PATH: /workspace/runtime-shell/config/models-api.runtime.json
      OPENCODE_CONFIG: /workspace/runtime-shell/config/opencode.example.jsonc
      OPENCODE_DISABLE_PROJECT_CONFIG: "1"
      # 中文/English: keep QuestionTool enabled on every worker node so runtime-shell sees the same interaction surface.
      OPENCODE_ENABLE_QUESTION_TOOL: "1"
      OPENCODE_ACP_ENTRY: /workspace/packages/opencode/src/index.ts
      OPENCODE_ACP_SPAWN_CWD: /workspace
      OPENCODE_ACP_NEXT: "0"
      RUNTIME_SHELL_WORKER_AGENT_PORT: "4097"
      RUNTIME_SHELL_INTERNAL_BASE_URL: http://runtime-shell:3000
      RUNTIME_SHELL_WORKER_AGENT_TOKEN: change-me-worker-agent
      RUNTIME_SHELL_SANDBOX_BACKEND: docker
      RUNTIME_SHELL_SANDBOX_IMAGE: opencode-local:latest
      RUNTIME_SHELL_SANDBOX_DOCKER_SOCKET: /var/run/docker.sock
      # 中文/English: local verification allows outbound access for model APIs, remote MCP, Git and package registries.
      # Production must replace this with an egress proxy or a network policy allowlist.
      RUNTIME_SHELL_SANDBOX_NETWORK_MODE: runtime-shell_default
      RUNTIME_SHELL_SANDBOX_USER: "1000:1000"
      RUNTIME_SHELL_SANDBOX_MEMORY_BYTES: "${config.sandboxMemoryBytes}"
      RUNTIME_SHELL_SANDBOX_NANO_CPUS: "${config.sandboxNanoCpus}"
      RUNTIME_SHELL_SANDBOX_PIDS_LIMIT: "${config.sandboxPidsLimit}"
    # 中文/English: do not publish the worker port to host by default.
    # runtime-shell connects via the compose network (${`http://${serviceName}:4097`}),
    # avoiding "port already allocated" on developer machines.
    expose:
      - "4097"
    volumes:
      - ${readWorkerDataDir(workerIndex)}:/root/.local/share/opencode
      - ../.opencode:/workspace/.opencode
      - ${composeWorkspaceDir}:${containerWorkspaceDir}
      - /var/run/docker.sock:/var/run/docker.sock
    working_dir: /workspace
    entrypoint: ["bun", "/workspace/runtime-shell/server/src/worker-agent/index.ts"]`
}

function readWorkerServiceName(workerIndex: number) {
  if (workerIndex === 1) return "opencode-worker"
  return `opencode-worker-${workerIndex}`
}

function readWorkerId(workerIndex: number) {
  if (workerIndex === 1) return "worker_local"
  return `worker_local_${workerIndex}`
}

function readWorkerDataDir(workerIndex: number) {
  if (workerIndex === 1) return "../docker-data/opencode"
  return `../docker-data/opencode-${workerIndex}`
}
