import { readFileSync } from "node:fs"
import mysql from "mysql2/promise"
import postgres from "postgres"
import type { DatabaseConfig } from "./config"

type DbParam = string | number | boolean | null

export type DatabaseClient = {
  execute: (sql: string, params?: DbParam[]) => Promise<void>
  queryRows: <T extends Record<string, unknown>>(sql: string, params?: DbParam[]) => Promise<T[]>
  queryFirst: <T extends Record<string, unknown>>(sql: string, params?: DbParam[]) => Promise<T | undefined>
  close: () => Promise<void>
}

function toPostgresStatement(statement: string) {
  let parameterIndex = 0
  return statement.replaceAll("?", () => `$${++parameterIndex}`)
}

export function createDatabaseClient(config: DatabaseConfig): DatabaseClient {
  if (config.dialect === "postgres") {
    const sql = postgres(config.url, {
      connect_timeout: config.connectTimeoutSeconds,
      max: 1,
      ssl: buildPostgresSslOptions(config),
    })
    return {
      async execute(statement, params: DbParam[] = []) {
        // 中文/English: runtime-shell keeps one SQL shape and rewrites placeholders for PostgreSQL.
        await sql.unsafe(toPostgresStatement(statement), params)
      },
      async queryRows<T extends Record<string, unknown>>(statement: string, params: DbParam[] = []) {
        const rows = await sql.unsafe<T[]>(toPostgresStatement(statement), params)
        return rows
      },
      async queryFirst<T extends Record<string, unknown>>(
        statement: string,
        params: DbParam[] = [],
      ): Promise<T | undefined> {
        const rows = await sql.unsafe<T[]>(toPostgresStatement(statement), params)
        return rows[0]
      },
      async close() {
        await sql.end()
      },
    }
  }

  const pool = mysql.createPool({
    uri: config.url,
    connectTimeout: config.connectTimeoutSeconds * 1000,
    connectionLimit: 1,
    multipleStatements: true,
    waitForConnections: true,
  })
  return {
    async execute(statement, params: DbParam[] = []) {
      await pool.query(statement, params)
    },
    async queryRows<T extends Record<string, unknown>>(statement: string, params: DbParam[] = []) {
      const [rows] = await pool.query(statement, params)
      return rows as T[]
    },
    async queryFirst<T extends Record<string, unknown>>(
      statement: string,
      params: DbParam[] = [],
    ): Promise<T | undefined> {
      const [rows] = await pool.query(statement, params)
      return (rows as T[])[0]
    },
    async close() {
      await pool.end()
    },
  }
}

function buildPostgresSslOptions(config: DatabaseConfig) {
  if (config.sslMode === "disable") return false
  if (config.sslMode === "no-verify") {
    // 中文/English: keep the TLS bypass scoped to the DB client only.
    return { rejectUnauthorized: false }
  }
  if (!config.sslCaFile) return config.sslMode
  // 中文/English: explicit CA loading keeps certificate validation deterministic in Docker and enterprise networks.
  return {
    ca: readFileSync(config.sslCaFile, "utf8"),
    rejectUnauthorized: true,
  }
}
