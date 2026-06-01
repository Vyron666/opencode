import type { User, UserMcpConfig } from "../../types"
import { authorizeSettingsAction } from "../access/authorization-service"
import {
  listVisibleMcpServers,
  savePlatformMcpServers,
  saveUserPrivateMcpServers,
} from "../configuration/configuration-service"

export async function listMcpConfigsForUser(user: User) {
  const authorization = authorizeSettingsAction({
    user,
    resource: "mcp_config",
    action: "list",
  })
  if (!authorization.ok) return { ok: false as const, reason: "forbidden" }
  return {
    ok: true as const,
    items: await listVisibleMcpServers(user),
  }
}

export async function saveMcpConfigsForUser(input: {
  user: User
  requestId: string
  servers: Record<string, UserMcpConfig>
}) {
  const authorization = authorizeSettingsAction({
    user: input.user,
    resource: "mcp_config",
    action: "save",
  })
  if (!authorization.ok) return { ok: false as const, reason: "forbidden" }
  if (input.user.role === "admin") {
    await savePlatformMcpServers({
      user: input.user,
      requestId: input.requestId,
      servers: input.servers,
      summaryJson: {
        namespace: "mcp",
        serverCount: Object.keys(input.servers).length,
      },
    })
  } else {
    const saved = await saveUserPrivateMcpServers({
      user: input.user,
      requestId: input.requestId,
      servers: input.servers,
      summaryJson: {
        namespace: "mcp",
        serverCount: Object.keys(input.servers).length,
      },
    })
    if (!saved.ok) {
      return {
        ok: false as const,
        reason: "conflict_with_platform_shared",
        name: saved.name,
      }
    }
  }
  return {
    ok: true as const,
    success: true,
    approvalRequired: false,
    approval: undefined,
    count: Object.keys(input.servers).length,
  }
}
