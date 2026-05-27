import type { PersistedState } from "../types"
import { createLogger } from "../log"
import { getRuntimeDatabaseClient } from "./runtime-db"

const log = createLogger("db-bootstrap")

type ExistingRow = {
  id: string
}

function stringifyJson(value: unknown) {
  return JSON.stringify(value ?? {})
}

export async function ensureDatabaseBootstrap(state: PersistedState) {
  const db = getRuntimeDatabaseClient()
  await seedWorkspaces(state)
  await seedSessions(state)
  await seedAuthSessions(state)
  await seedSessionShareBindings(state)
  log.info("database bootstrap completed", {
    workspaceCount: state.workspaces.length,
    sessionCount: state.sessions.length,
    authSessionCount: state.authSessions.length,
    sessionShareBindingCount: state.sessionShareBindings.length,
  })

  async function seedWorkspaces(input: PersistedState) {
    const existing = await db.queryRows<ExistingRow>("SELECT id FROM workspace_binding")
    const existingIds = new Set(existing.map((item) => item.id))
    for (const workspace of input.workspaces) {
      if (existingIds.has(workspace.id)) continue
      // 中文/English: bootstrap preserves legacy workspace ids so session/workspace links stay stable after cutover.
      await db.execute(
        `
          INSERT INTO workspace_binding (
            id,
            tenant_id,
            organization_id,
            project_id,
            workspace_code,
            name,
            root_path,
            status,
            created_at,
            created_by,
            updated_at,
            updated_by,
            deleted_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          workspace.id,
          workspace.tenantId,
          workspace.organizationId,
          workspace.projectId,
          workspace.id,
          workspace.name,
          workspace.rootPath,
          workspace.status,
          workspace.createdAt,
          workspace.createdBy,
          workspace.updatedAt,
          workspace.createdBy,
          null,
        ],
      )
    }
  }

  async function seedSessions(input: PersistedState) {
    const existing = await db.queryRows<ExistingRow>("SELECT id FROM business_session")
    const existingIds = new Set(existing.map((item) => item.id))
    for (const session of input.sessions) {
      if (existingIds.has(session.id)) continue
      await db.execute(
        `
          INSERT INTO business_session (
            id,
            tenant_id,
            organization_id,
            project_id,
            workspace_binding_id,
            worker_node_id,
            title,
            status,
            created_by,
            workspace_path,
            last_event_at,
            created_at,
            updated_at,
            updated_by,
            deleted_at,
            binding_json,
            capability_state_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          session.id,
          session.tenantId,
          session.organizationId,
          session.projectId,
          session.workspaceId,
          session.workerId,
          session.title,
          session.status,
          session.createdBy,
          session.workspacePath,
          session.lastEventAt ?? null,
          session.createdAt,
          session.updatedAt,
          session.createdBy,
          null,
          session.binding ? stringifyJson(session.binding) : null,
          stringifyJson(session.capabilityState ?? {}),
        ],
      )
    }
  }

  async function seedAuthSessions(input: PersistedState) {
    const existing = await db.queryRows<ExistingRow>("SELECT id FROM auth_session")
    const existingIds = new Set(existing.map((item) => item.id))
    for (const authSession of input.authSessions) {
      if (existingIds.has(authSession.id)) continue
      await db.execute(
        `
          INSERT INTO auth_session (
            id,
            tenant_id,
            organization_id,
            user_id,
            token_hash,
            status,
            expires_at,
            created_at,
            created_by,
            updated_at,
            updated_by,
            deleted_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          authSession.id,
          authSession.tenantId,
          authSession.organizationId,
          authSession.userId,
          authSession.tokenHash,
          authSession.status,
          authSession.expiresAt,
          authSession.createdAt,
          authSession.userId,
          authSession.updatedAt,
          authSession.userId,
          null,
        ],
      )
    }
  }

  async function seedSessionShareBindings(input: PersistedState) {
    const existing = await db.queryRows<ExistingRow>("SELECT id FROM session_share_binding")
    const existingIds = new Set(existing.map((item) => item.id))
    for (const binding of input.sessionShareBindings) {
      if (existingIds.has(binding.id)) continue
      await db.execute(
        `
          INSERT INTO session_share_binding (
            id,
            tenant_id,
            organization_id,
            project_id,
            workspace_id,
            business_session_id,
            owner_user_id,
            target_user_id,
            status,
            created_at,
            created_by,
            updated_at,
            updated_by,
            deleted_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          binding.id,
          binding.tenantId,
          binding.organizationId,
          binding.projectId,
          binding.workspaceId,
          binding.businessSessionId,
          binding.ownerUserId,
          binding.targetUserId,
          binding.status,
          binding.createdAt,
          binding.createdBy,
          binding.updatedAt,
          binding.updatedBy,
          null,
        ],
      )
    }
  }
}
