import type { User } from "../../types"
import { authorizeSettingsAction } from "../access/authorization-service"
import { previewConfigImpact } from "../config-impact/config-impact-service"
import { listVisibleProviderConfigs as listProviderConfigsForPreview } from "../configuration/configuration-service"

export async function previewConfigImpactForUser(input: {
  user: User
  namespace: "provider" | "mcp" | "skill"
  targetId?: string
}) {
  const resource =
    input.namespace === "provider"
      ? "provider_config"
      : input.namespace === "mcp"
        ? "mcp_config"
        : "skill_config"
  const authorization = authorizeSettingsAction({
    user: input.user,
    resource,
    action: "list",
  })
  if (!authorization.ok) return { ok: false as const, reason: "forbidden" }
  if (input.namespace === "provider" && input.targetId) {
    const visibleProviders = await listProviderConfigsForPreview(input.user)
    const exists = visibleProviders.some((item) => item.providerId === input.targetId)
    if (!exists && input.user.role === "developer") {
      return { ok: false as const, reason: "forbidden" }
    }
  }
  const preview = await previewConfigImpact(input)
  return {
    ok: true as const,
    preview,
  }
}
