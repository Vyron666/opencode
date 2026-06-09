import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { cp, mkdir, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { Database } from "bun:sqlite"
import { Config } from "../../config"
import { ensureSandboxUserOwnership } from "../../lib/sandbox-user-ownership"
import { runColdStartRuntimeHomePrepare } from "./docker-sandbox-cold-start"

const RUNTIME_HOME_ROOT = path.join(Config.workspaceRootDir, ".runtime-home")
const RUNTIME_HOME_DATA_DIR = path.join(".local", "share", "opencode")
const RUNTIME_HOME_PRIMARY_DB_NAME = "opencode.db"
const RUNTIME_HOME_SEED_TIMEOUT_MS = 60_000
const RUNTIME_HOME_LAYOUT_VERSION_PREFIX = "runtime-home-v3"
const RUNTIME_HOME_LAYOUT_MARKER = ".runtime-shell-layout-version"
const DEFAULT_RUNTIME_HOME_DATA_MIGRATIONS = ["session_usage_from_messages"]

const runtimeHomeSeedPromiseByWorker = new Map<string, Promise<string>>()
const runtimeHomePreparationPromiseByTarget = new Map<string, Promise<string>>()

export function buildColdRuntimeHomePath(input: {
  workerId: string
  workspaceId: string
}) {
  return path.join(
    RUNTIME_HOME_ROOT,
    sanitizePathSegment(input.workerId),
    "runtime",
    sanitizePathSegment(input.workspaceId),
  )
}

export function buildWarmRuntimeHomePath(input: {
  workerId: string
  slotId: string
}) {
  return path.join(
    RUNTIME_HOME_ROOT,
    sanitizePathSegment(input.workerId),
    "warm",
    sanitizePathSegment(input.slotId),
  )
}

export function buildWarmRuntimeHomeRoot(workerId: string) {
  return path.join(
    RUNTIME_HOME_ROOT,
    sanitizePathSegment(workerId),
    "warm",
  )
}

export async function ensureRuntimeHomePrepared(runtimeHomePath: string) {
  return prepareRuntimeHome(runtimeHomePath, async () => runColdStartRuntimeHomePrepare(() => prepareRuntimeHomeFromSeed(runtimeHomePath)))
}

export async function ensureForkRuntimeHomePrepared(targetRuntimeHomePath: string, sourceRuntimeHomePath: string) {
  if (path.resolve(targetRuntimeHomePath) === path.resolve(sourceRuntimeHomePath)) {
    return ensureRuntimeHomePrepared(targetRuntimeHomePath)
  }
  return prepareRuntimeHome(targetRuntimeHomePath, async () => runColdStartRuntimeHomePrepare(async () => {
    if (!hasRuntimeHomeDatabase(sourceRuntimeHomePath)) {
      return prepareRuntimeHomeFromSeed(targetRuntimeHomePath)
    }
    // 中文/English: fork only needs the persisted ACP session database. Reusing
    // the whole warm runtime-home can drag transient process state into the new runtime.
    await prepareRuntimeHomeFromSeed(targetRuntimeHomePath)
    await copyRuntimeHomeDatabaseSnapshot(targetRuntimeHomePath, sourceRuntimeHomePath)
    return targetRuntimeHomePath
  }))
}

export async function removeRuntimeHome(runtimeHomePath?: string) {
  if (!runtimeHomePath) return
  await rm(runtimeHomePath, { recursive: true, force: true }).catch(() => {})
}

export async function removeColdRuntimeHomesByWorkspace(workspaceId: string) {
  await Promise.all(
    Config.localWorkers.map((worker) =>
      removeRuntimeHome(buildColdRuntimeHomePath({
        workerId: worker.id,
        workspaceId,
      })),
    ),
  )
}

async function ensureRuntimeHomeSeed(workerId: string) {
  const seedDir = buildRuntimeHomeSeedDir(workerId)
  if (hasRuntimeHomeDatabase(seedDir) && hasCurrentRuntimeHomeLayout(seedDir)) {
    await stabilizeRuntimeHomeDatabase(seedDir)
    return seedDir
  }
  const pending = runtimeHomeSeedPromiseByWorker.get(workerId)
  if (pending) return pending
  const task = (async () => {
    const seedDir = buildRuntimeHomeSeedDir(workerId)
    await rm(seedDir, { recursive: true, force: true }).catch(() => {})
    await mkdir(seedDir, { recursive: true })
    await mkdir(buildRuntimeHomeSeedCwd(workerId), { recursive: true })
    await createRuntimeHomeSeed(workerId)
    await stabilizeRuntimeHomeDatabase(seedDir)
    if (!hasRuntimeHomeDatabase(seedDir)) {
      throw new Error("runtime home seed database is missing after bootstrap")
    }
    return seedDir
  })()
  runtimeHomeSeedPromiseByWorker.set(workerId, task)
  try {
    return await task
  } catch (error) {
    runtimeHomeSeedPromiseByWorker.delete(workerId)
    await rm(buildRuntimeHomeSeedDir(workerId), { recursive: true, force: true }).catch(() => {})
    throw error
  }
}

async function prepareRuntimeHome(runtimeHomePath: string, prepare: () => Promise<string>) {
  const normalizedTargetPath = path.resolve(runtimeHomePath)
  const pending = runtimeHomePreparationPromiseByTarget.get(normalizedTargetPath)
  if (pending) return pending
  const task = prepare()
  runtimeHomePreparationPromiseByTarget.set(normalizedTargetPath, task)
  try {
    return await task
  } finally {
    if (runtimeHomePreparationPromiseByTarget.get(normalizedTargetPath) === task) {
      runtimeHomePreparationPromiseByTarget.delete(normalizedTargetPath)
    }
  }
}

async function prepareRuntimeHomeFromSeed(runtimeHomePath: string) {
  if (hasRuntimeHomeDatabase(runtimeHomePath) && hasCurrentRuntimeHomeLayout(runtimeHomePath)) {
    await ensureRuntimeHomeDatabaseMarker(runtimeHomePath)
    await ensureRuntimeHomeOwnership(runtimeHomePath)
    return runtimeHomePath
  }
  const seedPath = await ensureRuntimeHomeSeed(readWorkerIdFromRuntimeHomePath(runtimeHomePath))
  await replaceRuntimeHome(runtimeHomePath, seedPath)
  return runtimeHomePath
}

async function replaceRuntimeHome(targetRuntimeHomePath: string, sourceRuntimeHomePath: string) {
  await rm(targetRuntimeHomePath, { recursive: true, force: true }).catch(() => {})
  await mkdir(path.dirname(targetRuntimeHomePath), { recursive: true })
  await cp(sourceRuntimeHomePath, targetRuntimeHomePath, {
    recursive: true,
    force: true,
  })
  await ensureRuntimeHomeDatabaseMarker(targetRuntimeHomePath)
  await writeRuntimeHomeLayoutMarker(targetRuntimeHomePath)
  await ensureRuntimeHomeOwnership(targetRuntimeHomePath)
}

async function copyRuntimeHomeDatabaseSnapshot(targetRuntimeHomePath: string, sourceRuntimeHomePath: string) {
  const sourceDbPath = findRuntimeHomeDbPath(sourceRuntimeHomePath)
  const targetDbPath = findRuntimeHomeDbPath(targetRuntimeHomePath)
  if (!sourceDbPath || !targetDbPath) {
    throw new Error("runtime home database path is missing for fork preparation")
  }
  await exportRuntimeHomeDatabaseSnapshot(sourceDbPath, targetDbPath)
  await ensureRuntimeHomeDatabaseMarker(targetRuntimeHomePath)
  await writeRuntimeHomeLayoutMarker(targetRuntimeHomePath)
  await ensureRuntimeHomeOwnership(targetRuntimeHomePath)
}

async function exportRuntimeHomeDatabaseSnapshot(sourceDbPath: string, targetDbPath: string) {
  await removeOptionalRuntimeHomeSidecar(targetDbPath, "-wal")
  await removeOptionalRuntimeHomeSidecar(targetDbPath, "-shm")
  await rm(targetDbPath, { force: true }).catch(() => {})
  const sourceDb = new Database(sourceDbPath, { readonly: true })
  try {
    sourceDb.exec("PRAGMA busy_timeout = 5000")
    // 中文/English: fork snapshot must come from a consistent SQLite export.
    // Copying a live database file plus WAL/SHM directly can trap the new runtime
    // behind an incomplete checkpoint and block ACP initialize.
    sourceDb.exec(`VACUUM INTO ${toSqliteStringLiteral(targetDbPath)}`)
  } finally {
    sourceDb.close(false)
  }
}

async function removeOptionalRuntimeHomeSidecar(targetDbPath: string, suffix: "-wal" | "-shm") {
  const targetSidecarPath = `${targetDbPath}${suffix}`
  await rm(targetSidecarPath, { force: true }).catch(() => {})
}

async function stabilizeRuntimeHomeDatabase(runtimeHomePath: string) {
  const dbPath = findRuntimeHomeDbPath(runtimeHomePath)
  if (!dbPath) return
  const db = new Database(dbPath)
  try {
    // 中文/English: checkpoint the worker-local seed once so copied runtime homes
    // carry a durable main db file instead of relying on leftover WAL pages.
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)")
  } finally {
    db.close(false)
  }
  await removeOptionalRuntimeHomeSidecar(dbPath, "-wal")
  await removeOptionalRuntimeHomeSidecar(dbPath, "-shm")
  await ensureRuntimeHomeDatabaseMarker(runtimeHomePath)
  await writeRuntimeHomeLayoutMarker(runtimeHomePath)
}

async function createRuntimeHomeSeed(workerId: string) {
  const seedDir = buildRuntimeHomeSeedDir(workerId)
  await new Promise<void>((resolve, reject) => {
    const env = {
      ...process.env,
      PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin",
      LANG: process.env.LANG || "C.UTF-8",
      LC_ALL: process.env.LC_ALL || "C.UTF-8",
      HOME: seedDir,
      XDG_CONFIG_HOME: path.join(seedDir, ".config"),
      XDG_CACHE_HOME: path.join(seedDir, ".cache"),
      XDG_STATE_HOME: path.join(seedDir, ".local/state"),
      XDG_DATA_HOME: path.join(seedDir, ".local/share"),
      TMPDIR: "/tmp",
      OPENCODE_CLIENT: "acp",
      OPENCODE_ENABLE_QUESTION_TOOL: process.env.OPENCODE_ENABLE_QUESTION_TOOL || "1",
      OPENCODE_ACP_NEXT: process.env.OPENCODE_ACP_NEXT || "0",
      OPENCODE_DB: process.env.OPENCODE_DB || RUNTIME_HOME_PRIMARY_DB_NAME,
      OPENCODE_CONFIG: process.env.OPENCODE_CONFIG || path.join(Config.sandboxDockerSpawnCwd, "runtime-shell", "config", "opencode.example.jsonc"),
      OPENCODE_MODELS_PATH: process.env.OPENCODE_MODELS_PATH || Config.sandboxDockerModelsPath,
      // 中文/English: runtime-home seed only needs the ACP core schema/runtime path.
      // Disabling builtin default plugins keeps copied warm/cold runtime homes aligned
      // with the slimmer sandbox ACP process that will later attach to them.
      OPENCODE_DISABLE_DEFAULT_PLUGINS: process.env.OPENCODE_DISABLE_DEFAULT_PLUGINS || "1",
      OPENCODE_DISABLE_PROJECT_CONFIG: process.env.OPENCODE_DISABLE_PROJECT_CONFIG || "1",
      OPENCODE_DISABLE_MODELS_FETCH: process.env.OPENCODE_DISABLE_MODELS_FETCH || "1",
    }
    const proc = spawn(
      process.execPath,
      [Config.sandboxDockerAcpEntry, "acp", `--cwd=${buildRuntimeHomeSeedCwd(workerId)}`],
      {
        // 中文/English: seed bootstrap should use the same instance cwd as the
        // runtime-home payload it is creating, otherwise upstream can spend time
        // bootstrapping the repo root and polluting the seed with wrong state.
        cwd: buildRuntimeHomeSeedCwd(workerId),
        env,
        stdio: ["ignore", "ignore", "pipe"],
      },
    )
    let settled = false
    const timer = setTimeout(() => {
      finish(new Error("runtime home seed bootstrap timed out"))
    }, RUNTIME_HOME_SEED_TIMEOUT_MS)
    const readinessPoll = setInterval(() => {
      void confirmRuntimeHomeSeedReady(seedDir)
        .then((ready) => {
          if (ready) finish()
        })
        .catch((error) => {
          finish(error instanceof Error ? error : new Error(String(error)))
        })
    }, 200)
    proc.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8")
      // 中文/English: the seed is only truly reusable after ACP background
      // data-migration state is durable in the worker-local runtime-home DB.
      if (text.includes("failed to run data migrations")) {
        finish(new Error("runtime home seed data migration failed"))
      }
    })
    proc.on("exit", (code) => {
      if (settled) return
      if (code === 0) {
        void confirmRuntimeHomeSeedReady(seedDir)
          .then((ready) => {
            if (ready) {
              finish()
              return
            }
            finish(new Error("runtime home seed exited before data migration completed"))
          })
          .catch((error) => {
            finish(error instanceof Error ? error : new Error(String(error)))
          })
        return
      }
      finish(new Error(`runtime home seed bootstrap exited early: ${code ?? "unknown"}`))
    })
    proc.on("error", (error) => {
      finish(error)
    })

    function finish(error?: Error) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearInterval(readinessPoll)
      proc.kill("SIGTERM")
      setTimeout(() => {
        proc.kill("SIGKILL")
      }, 1000).unref?.()
      if (error) {
        reject(error)
        return
      }
      resolve()
    }
  })
}

function hasRuntimeHomeDatabase(runtimeHomePath: string) {
  return Boolean(findRuntimeHomeDbPath(runtimeHomePath))
}

function hasCurrentRuntimeHomeLayout(runtimeHomePath: string) {
  try {
    return readFileSync(path.join(runtimeHomePath, RUNTIME_HOME_LAYOUT_MARKER), "utf8").trim() === readRuntimeHomeLayoutVersion()
  } catch {
    return false
  }
}

function findRuntimeHomeDbPath(runtimeHomePath: string) {
  const dataDir = path.join(runtimeHomePath, RUNTIME_HOME_DATA_DIR)
  if (!existsSync(dataDir)) return
  const dbFileNames = readdirSync(dataDir).filter((fileName) => /^opencode(?:-[^.]+)?\.db$/i.test(fileName))
  const preferredDbPath = dbFileNames
    .map((fileName) => path.join(dataDir, fileName))
    .find((dbPath) =>
      path.basename(dbPath) === RUNTIME_HOME_PRIMARY_DB_NAME
      && readRuntimeHomeDbSize(dbPath) > 0,
    )
  if (preferredDbPath) return preferredDbPath
  const populatedDbPath = dbFileNames
    .map((fileName) => path.join(dataDir, fileName))
    .find((dbPath) => readRuntimeHomeDbSize(dbPath) > 0)
  if (populatedDbPath) return populatedDbPath
  return
}

async function ensureRuntimeHomeDatabaseMarker(runtimeHomePath: string) {
  const dbPath = findRuntimeHomeDbPath(runtimeHomePath)
  if (!dbPath) return
  const primaryDbPath = path.join(runtimeHomePath, RUNTIME_HOME_DATA_DIR, RUNTIME_HOME_PRIMARY_DB_NAME)
  if (path.resolve(dbPath) === path.resolve(primaryDbPath) && readRuntimeHomeDbSize(primaryDbPath) > 0) return
  await exportRuntimeHomeDatabaseSnapshot(dbPath, primaryDbPath)
}

async function writeRuntimeHomeLayoutMarker(runtimeHomePath: string) {
  await mkdir(runtimeHomePath, { recursive: true })
  await writeFile(
    path.join(runtimeHomePath, RUNTIME_HOME_LAYOUT_MARKER),
    `${readRuntimeHomeLayoutVersion()}\n`,
    "utf8",
  )
}

function readRuntimeHomeLayoutVersion() {
  const migrationRoot = path.join(Config.sandboxDockerSpawnCwd, "packages", "opencode", "migration")
  const latestMigration = readdirSync(migrationRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .at(-1)
  // 中文/English: sandbox ACP skips per-process migrations only when the copied
  // runtime-home seed matches the current upstream migration directory.
  const dataMigrationVersion = readRuntimeHomeDataMigrationVersion()
  return `${RUNTIME_HOME_LAYOUT_VERSION_PREFIX}:${latestMigration || "unknown"}:${dataMigrationVersion}`
}

async function ensureRuntimeHomeOwnership(runtimeHomePath: string) {
  if (!existsSync(runtimeHomePath)) return
  await ensureSandboxUserOwnership(runtimeHomePath)
}

function buildRuntimeHomeSeedDir(workerId: string) {
  return path.join(RUNTIME_HOME_ROOT, sanitizePathSegment(workerId), "_seed")
}

function buildRuntimeHomeSeedCwd(workerId: string) {
  return path.join(RUNTIME_HOME_ROOT, sanitizePathSegment(workerId), "_seed-cwd")
}

function readWorkerIdFromRuntimeHomePath(runtimeHomePath: string) {
  const relative = path.relative(RUNTIME_HOME_ROOT, runtimeHomePath)
  const [workerId] = relative.split(path.sep)
  if (!workerId || workerId.startsWith("..")) {
    throw new Error(`runtime home path is outside runtime-home root: ${runtimeHomePath}`)
  }
  return workerId
}

function sanitizePathSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9_.-]/g, "_")
}

function toSqliteStringLiteral(value: string) {
  return `'${value.replace(/'/g, "''")}'`
}

function readRuntimeHomeDbSize(dbPath: string) {
  try {
    return statSync(dbPath).size
  } catch {
    return 0
  }
}

async function confirmRuntimeHomeSeedReady(runtimeHomePath: string) {
  if (!hasRuntimeHomeDatabase(runtimeHomePath)) return false
  return hasCompletedRuntimeHomeDataMigrations(runtimeHomePath)
}

function hasCompletedRuntimeHomeDataMigrations(runtimeHomePath: string) {
  const dbPath = findRuntimeHomeDbPath(runtimeHomePath)
  if (!dbPath) return false
  const requiredNames = readRuntimeHomeDataMigrationNames()
  if (requiredNames.length === 0) return true
  const db = new Database(dbPath, { readonly: true })
  try {
    db.exec("PRAGMA busy_timeout = 1000")
    const hasMigrationTable = db
      .query("select 1 from sqlite_master where type = 'table' and name = 'data_migration' limit 1")
      .get()
    if (!hasMigrationTable) return false
    const completedNames = new Set(
      (db.query("select name from data_migration").all() as Array<{ name: string }>)
        .map((row) => row.name)
        .filter(Boolean),
    )
    return requiredNames.every((name) => completedNames.has(name))
  } catch {
    return false
  } finally {
    db.close(false)
  }
}

function readRuntimeHomeDataMigrationNames() {
  try {
    const source = readFileSync(readRuntimeHomeDataMigrationSourcePath(), "utf8")
    const names = [...source.matchAll(/name:\s*"([^"]+)"/g)]
      .map((match) => match[1]?.trim())
      .filter((name): name is string => Boolean(name))
    return names.length > 0 ? [...new Set(names)] : DEFAULT_RUNTIME_HOME_DATA_MIGRATIONS
  } catch {
    return DEFAULT_RUNTIME_HOME_DATA_MIGRATIONS
  }
}

function readRuntimeHomeDataMigrationVersion() {
  try {
    const source = readFileSync(readRuntimeHomeDataMigrationSourcePath(), "utf8")
    return createHash("sha1").update(source).digest("hex").slice(0, 12)
  } catch {
    return "unknown"
  }
}

function readRuntimeHomeDataMigrationSourcePath() {
  return path.join(Config.sandboxDockerSpawnCwd, "packages", "opencode", "src", "data-migration.ts")
}
