import { cp, mkdir, rm } from "node:fs/promises"
import path from "node:path"
import { Config } from "../../config"
import { findSandboxWorkspaceBySessionId, upsertSandboxWorkspace } from "../../repos/sandbox-workspace-repo"
import type { BusinessSession, SandboxWorkspace } from "../../types"

export async function ensureSandboxWorkspace(session: BusinessSession) {
  const existing = await findSandboxWorkspaceBySessionId(session.id)
  if (existing && existing.status !== "closed") return existing

  const sandboxPath = path.join(Config.workspaceRootDir, ".sandbox", session.id)
  await rm(sandboxPath, { recursive: true, force: true }).catch(() => {})
  await mkdir(path.dirname(sandboxPath), { recursive: true })
  await cp(session.workspacePath, sandboxPath, { recursive: true, force: true })
  const now = new Date().toISOString()
  const workspace: SandboxWorkspace = {
    id: existing?.id || `sbw_${crypto.randomUUID().replace(/-/g, "")}`,
    businessSessionId: session.id,
    workspaceId: session.workspaceId,
    workspacePath: session.workspacePath,
    sandboxPath,
    status: "ready",
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    expiresAt: new Date(Date.now() + Config.sandboxWorkspaceTtlMs).toISOString(),
  }
  await upsertSandboxWorkspace(workspace)
  return workspace
}

export async function markSandboxWorkspaceClosing(sessionId: string) {
  const existing = await findSandboxWorkspaceBySessionId(sessionId)
  if (!existing) return
  await upsertSandboxWorkspace({
    ...existing,
    status: "closing",
    updatedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + Config.sandboxWorkspaceTtlMs).toISOString(),
  })
}

export async function closeSandboxWorkspace(sessionId: string) {
  const existing = await findSandboxWorkspaceBySessionId(sessionId)
  if (!existing) return
  await rm(existing.sandboxPath, { recursive: true, force: true }).catch(() => {})
  const now = new Date().toISOString()
  await upsertSandboxWorkspace({
    ...existing,
    status: "closed",
    updatedAt: now,
    closedAt: now,
  })
}

export async function getSandboxWorkspace(sessionId: string) {
  return findSandboxWorkspaceBySessionId(sessionId)
}
