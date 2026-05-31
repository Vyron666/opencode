import * as ConfigRepo from "../../repos/config-repo"
import type { ConfigNamespace, User } from "../../types"
import { authorizeSettingsAction } from "../access/authorization-service"

export async function listConfigHistory(input: {
  user: User
  namespace?: ConfigNamespace
  limit: number
}) {
  const authorization = authorizeSettingsAction({
    user: input.user,
    resource: "provider_config",
    action: "list",
  })
  if (!authorization.ok) return { ok: false as const, reason: "forbidden" }
  if (input.user.role === "admin") {
    return {
      ok: true as const,
      items: await ConfigRepo.listConfigChangeLogs({
        tenantId: input.user.tenantId,
        organizationId: input.user.organizationId,
        namespace: input.namespace,
        limit: input.limit,
      }),
    }
  }
  return {
    ok: true as const,
    items: await ConfigRepo.listConfigChangeLogs({
      tenantId: input.user.tenantId,
      organizationId: input.user.organizationId,
      scopeLevel: "user",
      scopeId: input.user.id,
      namespace: input.namespace,
      limit: input.limit,
    }),
  }
}
