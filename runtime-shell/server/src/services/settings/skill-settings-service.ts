import type { User, UserSkillConfig } from "../../types"
import { authorizeSettingsAction } from "../access/authorization-service"
import {
  getPlatformSkillConfig,
  getUserPrivateSkillConfig,
  getVisibleSkillConfig,
  listVisibleSkillConfigItems,
  savePlatformSkillConfig,
  saveUserPrivateSkillConfig,
} from "../configuration/configuration-service"

export async function listSkillConfigForUser(user: User) {
  const authorization = authorizeSettingsAction({
    user,
    resource: "skill_config",
    action: "list",
  })
  if (!authorization.ok) return { ok: false as const, reason: "forbidden" }
  return {
    ok: true as const,
    config: await getVisibleSkillConfig(user),
    items: await listVisibleSkillConfigItems(user),
  }
}

export async function saveSkillConfigForUser(input: {
  user: User
  requestId: string
  config: UserSkillConfig
}) {
  const authorization = authorizeSettingsAction({
    user: input.user,
    resource: "skill_config",
    action: "save",
  })
  if (!authorization.ok) return { ok: false as const, reason: "forbidden" }
  if (input.user.role === "admin") {
    await savePlatformSkillConfig({
      user: input.user,
      requestId: input.requestId,
      config: input.config,
      summaryJson: {
        namespace: "skill",
        pathCount: input.config.paths?.length ?? 0,
        urlCount: input.config.urls?.length ?? 0,
      },
    })
  } else {
    await saveUserPrivateSkillConfig({
      user: input.user,
      requestId: input.requestId,
      config: input.config,
      summaryJson: {
        namespace: "skill",
        pathCount: input.config.paths?.length ?? 0,
        urlCount: input.config.urls?.length ?? 0,
      },
    })
  }
  return {
    ok: true as const,
    success: true,
    approvalRequired: false,
    approval: undefined,
  }
}

export async function removeSkillConfigItemForUser(input: {
  user: User
  requestId: string
  type: "path" | "url"
  value: string
}) {
  const authorization = authorizeSettingsAction({
    user: input.user,
    resource: "skill_config",
    action: "save",
  })
  if (!authorization.ok) return { ok: false as const, reason: "forbidden" }

  if (input.user.role === "admin") {
    const current = await getPlatformSkillConfig(input.user)
    const next = {
      paths: input.type === "path" ? (current.paths ?? []).filter((item) => item !== input.value) : current.paths ?? [],
      urls: input.type === "url" ? (current.urls ?? []).filter((item) => item !== input.value) : current.urls ?? [],
    }
    await savePlatformSkillConfig({
      user: input.user,
      requestId: input.requestId,
      config: next,
      summaryJson: {
        namespace: "skill",
        pathCount: next.paths.length,
        urlCount: next.urls.length,
        removedType: input.type,
      },
    })
    return { ok: true as const, success: true }
  }

  const current = await getUserPrivateSkillConfig(input.user)
  const next = {
    paths: input.type === "path" ? (current.paths ?? []).filter((item) => item !== input.value) : current.paths ?? [],
    urls: input.type === "url" ? (current.urls ?? []).filter((item) => item !== input.value) : current.urls ?? [],
  }
  await saveUserPrivateSkillConfig({
    user: input.user,
    requestId: input.requestId,
    config: next,
    summaryJson: {
      namespace: "skill",
      pathCount: next.paths.length,
      urlCount: next.urls.length,
      removedType: input.type,
    },
  })
  return { ok: true as const, success: true }
}
