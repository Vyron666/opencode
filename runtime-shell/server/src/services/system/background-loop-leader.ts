import { readFileSync } from "node:fs"
import mysql from "mysql2/promise"
import type { RowDataPacket } from "mysql2/promise"
import postgres from "postgres"
import { Config } from "../../config"
import { readDatabaseConfig } from "../../db/config"
import { createLogger } from "../../log"
import { startRuntimeGovernanceLoop, stopRuntimeGovernanceLoop } from "../runtime-governance/runtime-governance-loop"
import { startLocalWorkerHeartbeatLoop, stopLocalWorkerHeartbeatLoop } from "../worker/local-worker-heartbeat-loop"

const log = createLogger("background-loop-leader")
const LEADER_LOCK_NAME = "runtime-shell:background-loops"
const POSTGRES_LEADER_LOCK_KEY = 80608001

let leaderTimer: Timer | undefined
let leaderActive = false
let pendingLeaderCheck: Promise<void> | undefined
let leaderGate: BackgroundLeaderGate | undefined

type BackgroundLeaderGate = {
  ensureLeadership: () => Promise<boolean>
}

export function startBackgroundLoopLeader() {
  if (leaderTimer) return
  void reconcileBackgroundLeadership()
  leaderTimer = setInterval(() => {
    void reconcileBackgroundLeadership()
  }, readLeaderCheckIntervalMs())
}

function readLeaderCheckIntervalMs() {
  return Math.min(Math.max(Math.floor(Config.runtimeGovernanceIntervalMs / 2), 2000), 5000)
}

function reconcileBackgroundLeadership() {
  if (pendingLeaderCheck) return pendingLeaderCheck
  const task = ensureBackgroundLeadership().catch((error) => {
    stopBackgroundLoops()
    leaderGate = undefined
    log.warn("background leader check failed", {
      error: error instanceof Error ? error.message : String(error),
    })
  })
  const trackedTask = task.finally(() => {
    if (pendingLeaderCheck === trackedTask) {
      pendingLeaderCheck = undefined
    }
  })
  pendingLeaderCheck = trackedTask
  return trackedTask
}

async function ensureBackgroundLeadership() {
  leaderGate = leaderGate || createBackgroundLeaderGate()
  if (await leaderGate.ensureLeadership()) {
    if (leaderActive) return
    leaderActive = true
    startLocalWorkerHeartbeatLoop()
    startRuntimeGovernanceLoop()
    log.info("background loop leadership acquired", {
      lockName: LEADER_LOCK_NAME,
    })
    return
  }
  if (!leaderActive) return
  stopBackgroundLoops()
  log.info("background loop leadership released", {
    lockName: LEADER_LOCK_NAME,
  })
}

function stopBackgroundLoops() {
  if (!leaderActive) return
  leaderActive = false
  stopLocalWorkerHeartbeatLoop()
  stopRuntimeGovernanceLoop()
}

function createBackgroundLeaderGate(): BackgroundLeaderGate {
  const config = readDatabaseConfig()
  if (config.dialect === "postgres") {
    return createPostgresLeaderGate(config)
  }
  return createMysqlLeaderGate(config)
}

function createPostgresLeaderGate(config: ReturnType<typeof readDatabaseConfig>): BackgroundLeaderGate {
  let sqlClient: postgres.Sql | undefined

  return {
    async ensureLeadership() {
      sqlClient = sqlClient || postgres(config.url, {
        connect_timeout: config.connectTimeoutSeconds,
        max: 1,
        ssl: buildPostgresSslOptions(config),
      })
      await sqlClient`SELECT 1`
      const rows = await sqlClient<{ locked: boolean }[]>`SELECT pg_try_advisory_lock(${POSTGRES_LEADER_LOCK_KEY}) AS locked`
      return Boolean(rows[0]?.locked)
    },
  }
}

function createMysqlLeaderGate(config: ReturnType<typeof readDatabaseConfig>): BackgroundLeaderGate {
  let connection: mysql.Connection | undefined

  return {
    async ensureLeadership() {
      connection = connection || await mysql.createConnection({
        uri: config.url,
        connectTimeout: config.connectTimeoutSeconds * 1000,
      })
      await connection.query("SELECT 1")
      const [rows] = await connection.query<RowDataPacket[]>(
        "SELECT GET_LOCK(?, 0) AS locked",
        [LEADER_LOCK_NAME],
      )
      return typeof rows[0]?.locked === "number" && rows[0].locked === 1
    },
  }
}

function buildPostgresSslOptions(config: ReturnType<typeof readDatabaseConfig>) {
  if (config.sslMode === "disable") return false
  if (config.sslMode === "no-verify") {
    // 中文/English: keep the TLS bypass scoped to the DB leader gate only.
    return { rejectUnauthorized: false }
  }
  if (!config.sslCaFile) return config.sslMode
  return {
    // 中文/English: explicit CA loading keeps leader-lock TLS behavior aligned with the main DB client.
    ca: readFileSync(config.sslCaFile, "utf8"),
    rejectUnauthorized: true,
  }
}
