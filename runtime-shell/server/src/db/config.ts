import { isDatabaseDialect, type DatabaseDialect } from "./dialect"

export type DatabaseSslMode = "disable" | "require" | "verify-full" | "no-verify"

export type DatabaseConfig = {
  dialect: DatabaseDialect
  url: string
  sslMode: DatabaseSslMode
  sslCaFile?: string
  connectTimeoutSeconds: number
  connectMaxAttempts: number
  connectRetryDelayMs: number
}

export function readDatabaseConfig(): DatabaseConfig {
  const dialect = process.env.RUNTIME_SHELL_DB_DIALECT?.trim().toLowerCase()
  if (!dialect) {
    throw new Error("missing RUNTIME_SHELL_DB_DIALECT")
  }
  if (!isDatabaseDialect(dialect)) {
    throw new Error(`unsupported RUNTIME_SHELL_DB_DIALECT: ${dialect}`)
  }
  const url = process.env.RUNTIME_SHELL_DB_URL?.trim()
  if (!url) {
    throw new Error("missing RUNTIME_SHELL_DB_URL")
  }
  return {
    dialect,
    url,
    sslMode: readDatabaseSslMode(),
    sslCaFile: readOptionalEnv("RUNTIME_SHELL_DB_SSL_CA_FILE"),
    connectTimeoutSeconds: readPositiveIntegerEnv("RUNTIME_SHELL_DB_CONNECT_TIMEOUT_SECONDS", 5),
    connectMaxAttempts: readPositiveIntegerEnv("RUNTIME_SHELL_DB_CONNECT_MAX_ATTEMPTS", 20),
    connectRetryDelayMs: readPositiveIntegerEnv("RUNTIME_SHELL_DB_CONNECT_RETRY_DELAY_MS", 1000),
  }
}

function readDatabaseSslMode(): DatabaseSslMode {
  const raw = process.env.RUNTIME_SHELL_DB_SSL_MODE?.trim().toLowerCase()
  if (!raw) return "disable"
  if (raw === "disable" || raw === "require" || raw === "verify-full" || raw === "no-verify") {
    return raw
  }
  throw new Error(`unsupported RUNTIME_SHELL_DB_SSL_MODE: ${raw}`)
}

function readOptionalEnv(name: string) {
  const value = process.env[name]?.trim()
  return value ? value : undefined
}

function readPositiveIntegerEnv(name: string, defaultValue: number) {
  const raw = process.env[name]?.trim()
  if (!raw) return defaultValue
  const value = Number.parseInt(raw, 10)
  if (Number.isInteger(value) && value > 0) return value
  throw new Error(`invalid ${name}: ${raw}`)
}
