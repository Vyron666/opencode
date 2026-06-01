import type { SkillPackageScope, User } from "../../types"
import {
  getPlatformSkillConfig,
  getUserPrivateSkillConfig,
  savePlatformSkillConfig,
  saveUserPrivateSkillConfig,
} from "../configuration/configuration-service"

export async function syncSkillPackageUrl(input: {
  user: User
  requestId: string
  scope: SkillPackageScope
  packageUrl: string
}) {
  if (input.scope === "platform_shared") {
    const current = await getPlatformSkillConfig(input.user)
    const urls = [...new Set([...(current.urls ?? []), input.packageUrl])]
    await savePlatformSkillConfig({
      user: input.user,
      requestId: input.requestId,
      config: {
        paths: current.paths ?? [],
        urls,
      },
      summaryJson: {
        namespace: "skill",
        pathCount: current.paths?.length ?? 0,
        urlCount: urls.length,
        syncSource: "skill_package_upload",
      },
    })
    return
  }
  const current = await getUserPrivateSkillConfig(input.user)
  const urls = [...new Set([...(current.urls ?? []), input.packageUrl])]
  await saveUserPrivateSkillConfig({
    user: input.user,
    requestId: input.requestId,
    config: {
      paths: current.paths ?? [],
      urls,
    },
    summaryJson: {
      namespace: "skill",
      pathCount: current.paths?.length ?? 0,
      urlCount: urls.length,
      syncSource: "skill_package_upload",
    },
  })
}

export async function removeSkillPackageUrl(input: {
  user: User
  requestId: string
  scope: SkillPackageScope
  packageUrl: string
}) {
  if (input.scope === "platform_shared") {
    const current = await getPlatformSkillConfig(input.user)
    const urls = (current.urls ?? []).filter((item) => item !== input.packageUrl)
    await savePlatformSkillConfig({
      user: input.user,
      requestId: input.requestId,
      config: {
        paths: current.paths ?? [],
        urls,
      },
      summaryJson: {
        namespace: "skill",
        pathCount: current.paths?.length ?? 0,
        urlCount: urls.length,
        syncSource: "skill_package_delete",
      },
    })
    return
  }
  const current = await getUserPrivateSkillConfig(input.user)
  const urls = (current.urls ?? []).filter((item) => item !== input.packageUrl)
  await saveUserPrivateSkillConfig({
    user: input.user,
    requestId: input.requestId,
    config: {
      paths: current.paths ?? [],
      urls,
    },
    summaryJson: {
      namespace: "skill",
      pathCount: current.paths?.length ?? 0,
      urlCount: urls.length,
      syncSource: "skill_package_delete",
    },
  })
}
