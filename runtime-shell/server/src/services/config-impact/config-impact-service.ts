import { getRuntime } from "../../acp-runtime-manager"
import type { User } from "../../types"
import { sessionService } from "../store/store-singleton"

export type ConfigImpactPreview = {
  namespace: "provider" | "mcp" | "skill"
  source: "platform_shared" | "user_private"
  scopeOwnerId?: string
  summary: string
  affectedSessionIds: string[]
  affectedSessionCount: number
  affectedWorkerIds: string[]
}

export async function previewPlatformProviderImpact(input: {
  tenantId: string
  organizationId: string
  providerId: string
}) {
  const activeSessions = (await sessionService.listSessionsByFilter({
    tenantId: input.tenantId,
    organizationId: input.organizationId,
    statuses: ["active"],
  })).filter((session) => Boolean(getRuntime(session.id)))
  return {
    affectedSessionIds: activeSessions.map((session) => session.id),
    reloadedSessionCount: activeSessions.length,
    affectedWorkerIds: [...new Set(activeSessions.map((session) => session.workerId))],
  }
}

export async function previewUserPrivateProviderImpact(input: {
  tenantId: string
  organizationId: string
  userId: string
  providerId: string
}) {
  const activeSessions = (await sessionService.listSessionsByFilter({
    tenantId: input.tenantId,
    organizationId: input.organizationId,
    createdBy: input.userId,
    statuses: ["active"],
  })).filter((session) => Boolean(getRuntime(session.id)))
  return {
    affectedSessionIds: activeSessions.map((session) => session.id),
    reloadedSessionCount: activeSessions.length,
  }
}

export async function previewConfigImpact(input: {
  user: User
  namespace: "provider" | "mcp" | "skill"
  targetId?: string
}) {
  if (input.namespace === "provider" && input.targetId) {
    if (input.user.role === "admin") {
      const impact = await previewPlatformProviderImpact({
        tenantId: input.user.tenantId,
        organizationId: input.user.organizationId,
        providerId: input.targetId,
      })
      return {
        namespace: "provider",
        source: "platform_shared",
        summary: `平台共享 provider '${input.targetId}' 会影响当前租户内正在使用该 provider 的活跃会话`,
        affectedSessionIds: impact.affectedSessionIds,
        affectedSessionCount: impact.reloadedSessionCount,
        affectedWorkerIds: impact.affectedWorkerIds,
      } satisfies ConfigImpactPreview
    }
    const impact = await previewUserPrivateProviderImpact({
      tenantId: input.user.tenantId,
      organizationId: input.user.organizationId,
      userId: input.user.id,
      providerId: input.targetId,
    })
    return {
      namespace: "provider",
      source: "user_private",
      scopeOwnerId: input.user.id,
      summary: `私有 provider '${input.targetId}' 会影响当前用户正在使用该 provider 的活跃会话`,
      affectedSessionIds: impact.affectedSessionIds,
      affectedSessionCount: impact.reloadedSessionCount,
      affectedWorkerIds: [],
    } satisfies ConfigImpactPreview
  }

  const activeSessions = (await sessionService.listSessionsByFilter({
    tenantId: input.user.tenantId,
    organizationId: input.user.organizationId,
    ...(input.user.role === "admin" ? {} : { createdBy: input.user.id }),
    statuses: ["active"],
  })).filter((session) => getRuntime(session.id))
  const source = input.user.role === "admin" ? "platform_shared" : "user_private"
  const subject = input.namespace === "mcp" ? "MCP 配置" : "Skill 配置"
  const summary =
    input.user.role === "admin"
      ? `平台共享${subject}按当前作用域估算，会影响当前租户内全部活跃会话`
      : `私有${subject}按当前作用域估算，会影响当前用户自己的活跃会话`

  return {
    namespace: input.namespace,
    source,
    ...(source === "user_private" ? { scopeOwnerId: input.user.id } : {}),
    summary,
    affectedSessionIds: activeSessions.map((session) => session.id),
    affectedSessionCount: activeSessions.length,
    affectedWorkerIds: [...new Set(activeSessions.map((session) => session.workerId).filter(Boolean))],
  } satisfies ConfigImpactPreview
}
