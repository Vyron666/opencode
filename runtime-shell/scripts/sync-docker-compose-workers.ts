import path from "node:path"
import { parse, type ParseError } from "jsonc-parser"

type LocalWorkerComposeConfig = {
  count: number
  capacity: number
}

const runtimeShellDir = path.resolve(import.meta.dir, "..")
const configPath = path.join(runtimeShellDir, "config", "local-workers.jsonc")
const composePath = path.join(runtimeShellDir, "docker-compose.yml")

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
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`local worker count must be a positive integer: ${count}`)
  }
  if (!Number.isInteger(capacity) || capacity < 1) {
    throw new Error(`local worker capacity must be a positive integer: ${capacity}`)
  }
  return {
    count,
    capacity,
  } satisfies LocalWorkerComposeConfig
}

function buildCompose(config: LocalWorkerComposeConfig) {
  const workerServices = Array.from({ length: config.count }, (_, index) => buildWorkerService(index + 1)).join("\n\n")
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
        baseUrl: `http://${readWorkerServiceName(workerIndex)}:4096`,
        agentBaseUrl: `http://${readWorkerServiceName(workerIndex)}:4097`,
        capacity: config.capacity,
        version: `local-${workerIndex}`,
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
      - "55432:5432"
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
      RUNTIME_SHELL_ADMIN_USERNAME: admin
      RUNTIME_SHELL_ADMIN_PASSWORD: change-me
      RUNTIME_SHELL_SESSION_COOKIE: runtime_shell_session
      RUNTIME_SHELL_SESSION_SECRET: change-me
      RUNTIME_SHELL_DATA_FILE: /app/data/runtime-shell.json
      RUNTIME_SHELL_DB_DIALECT: postgres
      RUNTIME_SHELL_DB_URL: postgresql://postgres:change-me@postgres:5432/runtime_shell
      RUNTIME_SHELL_DB_SSL_MODE: disable
      OPENCODE_BASE_URL: http://${readWorkerServiceName(1)}:4096
      RUNTIME_SHELL_WORKER_EXECUTION_MODE: remote
      RUNTIME_SHELL_WORKER_AGENT_TOKEN: change-me-worker-agent
      RUNTIME_SHELL_LOCAL_WORKERS: >-
        ${localWorkers}
      OPENCODE_SERVER_USERNAME: opencode
      OPENCODE_SERVER_PASSWORD: change-me
      # ACP 子进程需要读取 opencode 配置来加载自定义 provider/model
      OPENCODE_ACP_ENTRY: /workspace/packages/opencode/src/index.ts
      OPENCODE_ACP_SPAWN_CWD: /workspace
      # 中文/English: runtime-shell now defaults to the ACP-next entrypoint.
      OPENCODE_ACP_NEXT: "0"
      # 日志级别: debug | info | warn | error (默认 info)
      RUNTIME_SHELL_LOG_LEVEL: info
    ports:
      - "3100:3000"
    volumes:
      - ./data:/app/data
      - ../.opencode:/workspace/.opencode
      - ../workspaces:/workspace/workspaces
      # 中文/English: runtime-shell spawned ACP uses its own local OpenCode data directory.
      # Do not share db/auth state with opencode-worker, otherwise two local instances can conflict.
      - ../docker-data/runtime-shell-opencode:/root/.local/share/opencode
    working_dir: /app
`
}

function buildWorkerService(workerIndex: number) {
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
      OPENCODE_DISABLE_MODELS_FETCH: "0"
      # 中文/English: keep QuestionTool enabled on every worker node so runtime-shell sees the same interaction surface.
      OPENCODE_ENABLE_QUESTION_TOOL: "1"
      OPENCODE_ACP_ENTRY: /workspace/packages/opencode/src/index.ts
      OPENCODE_ACP_SPAWN_CWD: /workspace
      OPENCODE_ACP_NEXT: "0"
      RUNTIME_SHELL_WORKER_AGENT_PORT: "4097"
      RUNTIME_SHELL_INTERNAL_BASE_URL: http://runtime-shell:3000
      RUNTIME_SHELL_WORKER_AGENT_TOKEN: change-me-worker-agent
    # 中文/English: do not publish the worker port to host by default.
    # runtime-shell connects via the compose network (${`http://${serviceName}:4096`}),
    # avoiding "port already allocated" on developer machines.
    expose:
      - "4096"
      - "4097"
    volumes:
      - ${readWorkerDataDir(workerIndex)}:/root/.local/share/opencode
      - ../.opencode:/workspace/.opencode
      - ../workspaces:/workspace/workspaces
    working_dir: /workspace
    entrypoint: ["bash", "/workspace/runtime-shell/server/src/worker-agent/start-worker.sh"]`
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
