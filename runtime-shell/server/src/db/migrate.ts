import path from "node:path"
import { readDatabaseConfig } from "./config"
import { createDatabaseClient } from "./client"
import { createLogger } from "../log"
import { retryDatabaseConnection } from "./retry"

const log = createLogger("db-migrate")

type AppliedMigrationRow = {
  name: string
}

const migrationsDir = path.resolve(import.meta.dir, "./migrations")

const migrationTableSql = {
  postgres: `
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `,
  mysql: `
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `,
} as const

const appliedMigrationsSql = "SELECT name FROM schema_migrations ORDER BY name"

async function listMigrationNames(dialect: "postgres" | "mysql") {
  const pattern = `.${dialect}.sql`
  const entries = await Array.fromAsync(new Bun.Glob(`*${pattern}`).scan({
    cwd: migrationsDir,
    onlyFiles: true,
  }))
  return entries.sort()
}

async function readMigrationSql(fileName: string) {
  return Bun.file(path.join(migrationsDir, fileName)).text()
}

const config = readDatabaseConfig()
log.info("starting database migration", { dialect: config.dialect })
await retryDatabaseConnection(config, log, async () => {
  const client = createDatabaseClient(config)
  try {
    await client.execute(migrationTableSql[config.dialect])
    const appliedRows = await client.queryRows<AppliedMigrationRow>(appliedMigrationsSql)
    const appliedNames = new Set(appliedRows.map((row) => row.name))
    const migrationNames = await listMigrationNames(config.dialect)

    for (const migrationName of migrationNames) {
      if (appliedNames.has(migrationName)) {
        log.info("skipping applied migration", { migrationName })
        continue
      }
      const statement = await readMigrationSql(migrationName)
      log.info("applying migration", { migrationName })
      await client.execute(statement)
      await client.execute(`INSERT INTO schema_migrations (name) VALUES ('${migrationName}')`)
    }

    log.info("database migration completed", { appliedCount: migrationNames.length })
  } finally {
    await client.close()
  }
})
