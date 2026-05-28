import { mkdir } from "node:fs/promises"
import path from "node:path"
import { Config } from "../../config"
import { auditService, workspaceService } from "../store/store-singleton"
import type { User, WorkspaceCreationResult } from "../../types"

export async function createWorkspaceForUser(input: {
  user: User
  requestId: string
  projectId: string
  name: string
}): Promise<WorkspaceCreationResult> {
  if (input.user.role !== "admin" && input.user.role !== "developer") {
    return { ok: false, reason: "forbidden" }
  }
  if (!input.user.projectIds.includes(input.projectId)) {
    return { ok: false, reason: "project_out_of_scope" }
  }

  const normalizedName = input.name.trim()
  const slug = toWorkspaceSlug(normalizedName)
  if (!slug) return { ok: false, reason: "invalid_name" }

  const rootPath = path.join(Config.workspaceRootDir, input.user.id, slug)

  try {
    await mkdir(rootPath, { recursive: true })
  } catch {
    return { ok: false, reason: "create_failed" }
  }

  const workspace = await workspaceService.ensureWorkspace({
    tenantId: input.user.tenantId,
    organizationId: input.user.organizationId,
    projectId: input.projectId,
    rootPath,
    createdBy: input.user.id,
    name: normalizedName,
  })
  const auditLogTask = auditService.appendAuditLog({
    tenantId: input.user.tenantId,
    organizationId: input.user.organizationId,
    userId: input.user.id,
    requestId: input.requestId,
    action: "workspace.create",
    resourceType: "workspace",
    resourceId: workspace.id,
    detail: {
      name: workspace.name,
      projectId: workspace.projectId,
      rootPath: workspace.rootPath,
    },
  })
  // 中文/English: workspace creation should return immediately after durable binding succeeds.
  void auditLogTask

  return { ok: true, workspace }
}

function toWorkspaceSlug(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
}
