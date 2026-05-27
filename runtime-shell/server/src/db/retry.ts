import type { Logger } from "../log"
import type { DatabaseConfig } from "./config"

export async function retryDatabaseConnection<T>(
  config: DatabaseConfig,
  log: Logger,
  operation: () => Promise<T>,
) {
  let attempt = 0
  while (true) {
    attempt += 1
    try {
      return await operation()
    } catch (error) {
      if (!isRetryableDatabaseError(error) || attempt >= config.connectMaxAttempts) {
        throw error
      }
      log.warn("database connection not ready, retrying", {
        attempt,
        maxAttempts: config.connectMaxAttempts,
        retryDelayMs: config.connectRetryDelayMs,
        reason: describeDatabaseError(error),
      })
      await Bun.sleep(config.connectRetryDelayMs)
    }
  }
}

function isRetryableDatabaseError(error: unknown) {
  const code = readErrorCode(error)
  return code === "ECONNREFUSED" || code === "57P03" || code === "CONNECT_TIMEOUT"
}

function describeDatabaseError(error: unknown) {
  if (error instanceof Error) return error.message
  return String(error)
}

function readErrorCode(error: unknown) {
  if (!error || typeof error !== "object") return undefined
  const code = "code" in error ? error.code : undefined
  return typeof code === "string" ? code : undefined
}
