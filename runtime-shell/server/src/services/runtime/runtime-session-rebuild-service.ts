import { existsSync, readdirSync } from "node:fs"
import path from "node:path"
import { Database } from "bun:sqlite"
import { Config } from "../../config"
import { createLogger } from "../../log"
import type { BusinessSession } from "../../types"

const log = createLogger("runtime-session-rebuild")
const RUNTIME_HOME_DATA_DIR = path.join(".local", "share", "opencode")
const PRIMARY_DB_NAME = "opencode.db"

export async function rebuildMissingAcpSessionFromRuntimeHome(input: {
  session: Pick<BusinessSession, "id" | "workerId" | "workspaceId">
  missingAcpSessionId: string
  runtimeHomeRootDir?: string
}) {
  const selected = findRuntimeHomeDatabase(input.session, input.missingAcpSessionId, input.runtimeHomeRootDir)
  if (!selected) {
    throw new Error(`runtime home database not found for missing ACP session: ${input.missingAcpSessionId}`)
  }
  const rebuilt = cloneAcpSessionHistory(selected.dbPath, input.missingAcpSessionId)
  log.warn("rebuilt missing ACP session from runtime home database", {
    businessSessionId: input.session.id,
    workerId: input.session.workerId,
    workspaceId: input.session.workspaceId,
    previousAcpSessionId: input.missingAcpSessionId,
    rebuiltAcpSessionId: rebuilt.sessionId,
    runtimeHomeDbPath: selected.dbPath,
    sourceReplicaScore: selected.score,
  })
  return rebuilt
}

function cloneAcpSessionHistory(dbPath: string, missingAcpSessionId: string) {
  const db = new Database(dbPath)
  try {
    db.exec("PRAGMA busy_timeout = 5000")
    db.exec("BEGIN IMMEDIATE")
    const sourceSession = db.query("select * from session where id = ? limit 1").get(missingAcpSessionId) as Record<string, unknown> | null
    if (!sourceSession) {
      throw new Error(`missing ACP session not found in runtime home database: ${missingAcpSessionId}`)
    }
    const rebuiltSessionId = createSessionId()
    const now = Date.now()
    const sourceRevert = sourceSession.revert
    db.query(`
      insert into session (
        id, project_id, workspace_id, parent_id, slug, directory, path, title, version,
        share_url, summary_additions, summary_deletions, summary_files, summary_diffs,
        cost, tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write,
        revert, permission, agent, model, time_created, time_updated, time_compacting, time_archived
      ) values (
        ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?
      )
    `).run(...toSqlBindings([
      rebuiltSessionId,
      sourceSession.project_id,
      sourceSession.workspace_id ?? null,
      sourceSession.parent_id ?? null,
      sourceSession.slug,
      sourceSession.directory,
      sourceSession.path ?? null,
      sourceSession.title,
      sourceSession.version,
      sourceSession.share_url ?? null,
      sourceSession.summary_additions ?? null,
      sourceSession.summary_deletions ?? null,
      sourceSession.summary_files ?? null,
      sourceSession.summary_diffs ?? null,
      sourceSession.cost ?? 0,
      sourceSession.tokens_input ?? 0,
      sourceSession.tokens_output ?? 0,
      sourceSession.tokens_reasoning ?? 0,
      sourceSession.tokens_cache_read ?? 0,
      sourceSession.tokens_cache_write ?? 0,
      null,
      sourceSession.permission ?? null,
      sourceSession.agent ?? null,
      sourceSession.model ?? null,
      now,
      now,
      null,
      sourceSession.time_archived ?? null,
    ]))

    const messageIdMap = new Map<string, string>()
    const partIdMap = new Map<string, string>()
    const messageRows = db.query("select * from message where session_id = ? order by time_created asc, id asc").all(missingAcpSessionId) as Array<Record<string, unknown>>
    for (const [messageIndex, messageRow] of messageRows.entries()) {
      const sourceMessageId = String(messageRow.id)
      const rebuiltMessageId = createOrderedMessageId(rebuiltSessionId, messageIndex)
      messageIdMap.set(sourceMessageId, rebuiltMessageId)
    }
    for (const messageRow of messageRows) {
      const rebuiltMessageId = messageIdMap.get(String(messageRow.id))
      if (!rebuiltMessageId) {
        throw new Error(`rebuilt message id missing for source message: ${String(messageRow.id)}`)
      }
      db.query(`
        insert into message (id, session_id, time_created, time_updated, data)
        values (?, ?, ?, ?, json(?))
      `).run(...toSqlBindings([
        rebuiltMessageId,
        rebuiltSessionId,
        messageRow.time_created,
        messageRow.time_updated ?? messageRow.time_created,
        JSON.stringify(rewriteJsonIds(messageRow.data, missingAcpSessionId, rebuiltSessionId, messageIdMap, partIdMap)),
      ]))
    }

    const partRows = db.query("select * from part where session_id = ? order by time_created asc, id asc").all(missingAcpSessionId) as Array<Record<string, unknown>>
    for (const [partIndex, partRow] of partRows.entries()) {
      const rebuiltMessageId = messageIdMap.get(String(partRow.message_id))
      if (!rebuiltMessageId) {
        throw new Error(`rebuilt message mapping missing for part source message: ${String(partRow.message_id)}`)
      }
      const rebuiltPartId = createOrderedPartId(rebuiltSessionId, partIndex)
      partIdMap.set(String(partRow.id), rebuiltPartId)
    }
    for (const partRow of partRows) {
      const rebuiltMessageId = messageIdMap.get(String(partRow.message_id))
      if (!rebuiltMessageId) {
        throw new Error(`rebuilt message mapping missing for part source message: ${String(partRow.message_id)}`)
      }
      const rebuiltPartId = partIdMap.get(String(partRow.id))
      if (!rebuiltPartId) {
        throw new Error(`rebuilt part id missing for source part: ${String(partRow.id)}`)
      }
      db.query(`
        insert into part (id, message_id, session_id, time_created, time_updated, data)
        values (?, ?, ?, ?, ?, json(?))
      `).run(...toSqlBindings([
        rebuiltPartId,
        rebuiltMessageId,
        rebuiltSessionId,
        partRow.time_created,
        partRow.time_updated ?? partRow.time_created,
        JSON.stringify(rewriteJsonIds(partRow.data, missingAcpSessionId, rebuiltSessionId, messageIdMap, partIdMap)),
      ]))
    }

    const sessionMessageRows = db.query("select * from session_message where session_id = ? order by time_created asc, id asc").all(missingAcpSessionId) as Array<Record<string, unknown>>
    for (const [sessionMessageIndex, sessionMessageRow] of sessionMessageRows.entries()) {
      db.query(`
        insert into session_message (id, session_id, type, time_created, time_updated, data)
        values (?, ?, ?, ?, ?, json(?))
      `).run(...toSqlBindings([
        createOrderedSessionMessageId(rebuiltSessionId, sessionMessageIndex),
        rebuiltSessionId,
        sessionMessageRow.type,
        sessionMessageRow.time_created,
        sessionMessageRow.time_updated ?? sessionMessageRow.time_created,
        JSON.stringify(rewriteJsonIds(sessionMessageRow.data, missingAcpSessionId, rebuiltSessionId, messageIdMap, partIdMap)),
      ]))
    }

    const todoRows = db.query(`
      select session_id, content, status, priority, position, time_created, time_updated
      from todo where session_id = ? order by position asc
    `).all(missingAcpSessionId) as Array<Record<string, unknown>>
    for (const todoRow of todoRows) {
      db.query(`
        insert into todo (session_id, content, status, priority, position, time_created, time_updated)
        values (?, ?, ?, ?, ?, ?, ?)
      `).run(...toSqlBindings([
        rebuiltSessionId,
        todoRow.content,
        todoRow.status,
        todoRow.priority,
        todoRow.position,
        todoRow.time_created,
        todoRow.time_updated ?? todoRow.time_created,
      ]))
    }

    const rebuiltRevert = rewriteSessionRevert(sourceRevert, messageIdMap, partIdMap)
    if (rebuiltRevert) {
      db.query("update session set revert = json(?), time_updated = ? where id = ?").run(
        JSON.stringify(rebuiltRevert),
        now,
        rebuiltSessionId,
      )
    }

    db.exec("COMMIT")
    return {
      sessionId: rebuiltSessionId,
      sourceDbPath: dbPath,
    }
  } catch (error) {
    db.exec("ROLLBACK")
    throw error
  } finally {
    db.close(false)
  }
}

function findRuntimeHomeDatabase(
  session: Pick<BusinessSession, "workerId" | "workspaceId">,
  missingAcpSessionId: string,
  runtimeHomeRootDir?: string,
) {
  const workerRoot = path.join(
    runtimeHomeRootDir || path.join(Config.workspaceRootDir, ".runtime-home"),
    sanitizePathSegment(session.workerId),
  )
  const candidates = [
    path.join(workerRoot, "runtime", sanitizePathSegment(session.workspaceId)),
    ...listRuntimeHomeDirectories(path.join(workerRoot, "warm")),
  ]
  return candidates
    .map(findRuntimeHomeDbPath)
    .filter((dbPath): dbPath is string => Boolean(dbPath))
    .map((dbPath) => inspectRuntimeHomeDatabase(dbPath, missingAcpSessionId))
    .filter((candidate): candidate is RuntimeHomeCandidate => Boolean(candidate))
    .sort((left, right) => right.score - left.score || right.updatedAt - left.updatedAt)
    .at(0)
}

function listRuntimeHomeDirectories(root: string) {
  if (!existsSync(root)) return []
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, entry.name))
}

function findRuntimeHomeDbPath(runtimeHomePath: string) {
  const dataDir = path.join(runtimeHomePath, RUNTIME_HOME_DATA_DIR)
  if (!existsSync(dataDir)) return
  const dbFileNames = readdirSync(dataDir).filter((fileName) => /^opencode(?:-[^.]+)?\.db$/i.test(fileName))
  if (dbFileNames.includes(PRIMARY_DB_NAME)) return path.join(dataDir, PRIMARY_DB_NAME)
  const fallback = dbFileNames[0]
  if (!fallback) return
  return path.join(dataDir, fallback)
}

function inspectRuntimeHomeDatabase(dbPath: string, sessionId: string) {
  try {
    const db = new Database(dbPath, { readonly: true })
    try {
      db.exec("PRAGMA busy_timeout = 1000")
      const session = db.query("select id, time_updated from session where id = ? limit 1").get(sessionId) as {
        id: string
        time_updated?: number
      } | null
      if (!session) return
      return {
        dbPath,
        updatedAt: Number(session.time_updated ?? 0),
        score: Math.max(
          Number(session.time_updated ?? 0),
          readScalarNumber(db, "select max(time_created) as value from message where session_id = ?", sessionId),
          readScalarNumber(db, "select max(time_created) as value from part where session_id = ?", sessionId),
          readScalarNumber(db, "select max(time_created) as value from session_message where session_id = ?", sessionId),
          readScalarNumber(db, "select max(time_created) as value from todo where session_id = ?", sessionId),
        ),
      } satisfies RuntimeHomeCandidate
    } finally {
      db.close(false)
    }
  } catch {
    return
  }
}

function rewriteJsonIds(
  value: unknown,
  previousSessionId: string,
  rebuiltSessionId: string,
  messageIdMap: Map<string, string>,
  partIdMap?: Map<string, string>,
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => rewriteJsonIds(item, previousSessionId, rebuiltSessionId, messageIdMap, partIdMap))
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => {
        if (typeof item === "string") {
          if (key === "sessionID" && item === previousSessionId) return [key, rebuiltSessionId]
          if ((key === "messageID" || key === "parentID" || key === "tail_start_id") && messageIdMap.has(item)) {
            return [key, messageIdMap.get(item)]
          }
          if (key === "partID" && partIdMap?.has(item)) return [key, partIdMap.get(item)]
        }
        return [key, rewriteJsonIds(item, previousSessionId, rebuiltSessionId, messageIdMap, partIdMap)]
      }),
    )
  }
  return value
}

function rewriteSessionRevert(
  value: unknown,
  messageIdMap?: Map<string, string>,
  partIdMap?: Map<string, string>,
) {
  if (!value || typeof value !== "object") return undefined
  const revert = value as Record<string, unknown>
  return {
    ...revert,
    messageID:
      typeof revert.messageID === "string" && messageIdMap?.has(revert.messageID)
        ? messageIdMap.get(revert.messageID)
        : revert.messageID,
    partID:
      typeof revert.partID === "string" && partIdMap?.has(revert.partID)
        ? partIdMap.get(revert.partID)
        : revert.partID,
  }
}

function sanitizePathSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9_.-]/g, "_")
}

function createSessionId() {
  return `ses_${crypto.randomUUID().replace(/-/g, "")}`
}

function createMessageId() {
  return `msg_${crypto.randomUUID().replace(/-/g, "")}`
}

function createPartId() {
  return `prt_${crypto.randomUUID().replace(/-/g, "")}`
}

function createSessionMessageId() {
  return `evt_${crypto.randomUUID().replace(/-/g, "")}`
}

function createOrderedMessageId(sessionId: string, index: number) {
  return createOrderedId("msg", sessionId, index)
}

function createOrderedPartId(sessionId: string, index: number) {
  return createOrderedId("prt", sessionId, index)
}

function createOrderedSessionMessageId(sessionId: string, index: number) {
  return createOrderedId("evt", sessionId, index)
}

function createOrderedId(prefix: "msg" | "prt" | "evt", sessionId: string, index: number) {
  // 中文/English: preserve deterministic lexical ordering for rebuilt rows so
  // same-timestamp messages and parts replay in the original persisted order.
  return `${prefix}_${String(index).padStart(12, "0")}_${sessionId.slice(4)}`
}

function toSqlBindings(values: unknown[]) {
  return values.map(toSqlBinding)
}

function toSqlBinding(value: unknown): string | number | bigint | boolean | Uint8Array | null {
  if (value === null || value === undefined) return null
  if (typeof value === "string") return value
  if (typeof value === "number") return value
  if (typeof value === "bigint") return value
  if (typeof value === "boolean") return value
  if (value instanceof Uint8Array) return value
  return JSON.stringify(value)
}

function readScalarNumber(db: Database, sql: string, sessionId: string) {
  const row = db.query(sql).get(sessionId) as { value?: number | null } | null
  return Number(row?.value ?? 0)
}

type RuntimeHomeCandidate = {
  dbPath: string
  updatedAt: number
  score: number
}
