import { createDatabaseClient, type DatabaseClient } from "./client"
import { readDatabaseConfig } from "./config"

let runtimeDatabaseClient: DatabaseClient | null = null

export function getRuntimeDatabaseClient() {
  if (runtimeDatabaseClient) return runtimeDatabaseClient
  runtimeDatabaseClient = createDatabaseClient(readDatabaseConfig())
  return runtimeDatabaseClient
}
