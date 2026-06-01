import path from "node:path"
import { mkdir } from "node:fs/promises"
import extractZip from "extract-zip"
import { Config } from "../../config"
import type { SkillPackageRecord, User } from "../../types"
import { authorizeSettingsAction } from "../access/authorization-service"
import { runtimeStore } from "../store/store-singleton"
import { removeSkillPackageUrl, syncSkillPackageUrl } from "./skill-package-config-sync"
import {
  buildRelativeDir,
  buildSkillPackageUrl,
  canManageSkillPackage,
  cleanupDirectory,
  findSkillManifest,
  MAX_UPLOAD_BYTES,
  readPackageScope,
  toSkillPackageSummary,
} from "./skill-package-support"

export async function listSkillPackagesForUser(user: User) {
  const authorization = authorizeSettingsAction({
    user,
    resource: "skill_config",
    action: "list",
  })
  if (!authorization.ok) return { ok: false as const, reason: "forbidden" }

  const state = runtimeStore.stateService.readState()
  const visible = (state.skillPackages ?? []).filter((item) => canManageSkillPackage(user, item))
  return {
    ok: true as const,
    items: visible.map((item) => toSkillPackageSummary(item)),
  }
}

export async function uploadSkillPackageForUser(input: {
  user: User
  requestId: string
  filename: string
  bytes: Uint8Array
}) {
  const authorization = authorizeSettingsAction({
    user: input.user,
    resource: "skill_config",
    action: "save",
  })
  if (!authorization.ok) return { ok: false as const, reason: "forbidden" }
  if (!input.filename.toLowerCase().endsWith(".zip")) {
    return { ok: false as const, reason: "invalid_file_type" }
  }
  if (input.bytes.byteLength === 0 || input.bytes.byteLength > MAX_UPLOAD_BYTES) {
    return { ok: false as const, reason: "invalid_file_size" }
  }

  const timestamp = new Date().toISOString()
  const scope = readPackageScope(input.user)
  const tempPackageId = `skillpkg_${crypto.randomUUID().replace(/-/g, "")}`
  const relativeDir = buildRelativeDir(input.user, tempPackageId)
  const targetDir = path.join(Config.storageDir, relativeDir)
  const zipPath = path.join(targetDir, "source.zip")

  await mkdir(targetDir, { recursive: true })
  await Bun.write(zipPath, input.bytes)
  await extractZip(zipPath, { dir: targetDir })

  const manifest = await findSkillManifest(targetDir)
  if (!manifest) {
    await cleanupDirectory(targetDir)
    return { ok: false as const, reason: "skill_manifest_not_found" }
  }

  const state = runtimeStore.stateService.readState()
  const existing = (state.skillPackages ?? []).find((item) =>
    item.tenantId === input.user.tenantId &&
    item.organizationId === input.user.organizationId &&
    item.scope === scope &&
    item.skillName === manifest.skillName &&
    (scope === "platform_shared" || item.userId === input.user.id),
  )
  if (existing) {
    await cleanupDirectory(path.join(Config.storageDir, existing.relativeDir))
  }

  const packageId = existing?.id || tempPackageId
  const token = existing?.token || crypto.randomUUID().replace(/-/g, "")
  const createdAt = existing?.createdAt || timestamp

  const record: SkillPackageRecord = {
    id: packageId,
    tenantId: input.user.tenantId,
    organizationId: input.user.organizationId,
    ...(scope === "user_private" ? { userId: input.user.id } : {}),
    scope,
    skillName: manifest.skillName,
    // 中文/English: overwrite upload should keep the user-visible display name stable.
    displayName: existing?.displayName || manifest.skillName,
    ...(manifest.description ? { description: manifest.description } : {}),
    token,
    relativeDir,
    skillRootDir: manifest.skillRootDir,
    sourceFilename: input.filename,
    createdAt,
    updatedAt: timestamp,
  }

  state.skillPackages = [...(state.skillPackages ?? []).filter((item) => item.id !== record.id), record]
  await runtimeStore.stateService.save()
  await syncSkillPackageUrl({
    user: input.user,
    requestId: input.requestId,
    scope,
    packageUrl: buildSkillPackageUrl(record),
  })

  return {
    ok: true as const,
    item: toSkillPackageSummary(record),
  }
}

export async function deleteSkillPackageForUser(input: {
  user: User
  requestId: string
  packageId: string
}) {
  const authorization = authorizeSettingsAction({
    user: input.user,
    resource: "skill_config",
    action: "save",
  })
  if (!authorization.ok) return { ok: false as const, reason: "forbidden" }

  const state = runtimeStore.stateService.readState()
  const current = (state.skillPackages ?? []).find((item) => item.id === input.packageId)
  if (!current) return { ok: false as const, reason: "not_found" }
  if (!canManageSkillPackage(input.user, current)) return { ok: false as const, reason: "forbidden" }

  state.skillPackages = (state.skillPackages ?? []).filter((item) => item.id !== current.id)
  await runtimeStore.stateService.save()
  await cleanupDirectory(path.join(Config.storageDir, current.relativeDir))
  await removeSkillPackageUrl({
    user: input.user,
    requestId: input.requestId,
    scope: current.scope,
    packageUrl: buildSkillPackageUrl(current),
  })

  return {
    ok: true as const,
    success: true,
  }
}

export async function renameSkillPackageForUser(input: {
  user: User
  packageId: string
  displayName: string
}) {
  const authorization = authorizeSettingsAction({
    user: input.user,
    resource: "skill_config",
    action: "save",
  })
  if (!authorization.ok) return { ok: false as const, reason: "forbidden" }

  const state = runtimeStore.stateService.readState()
  const current = (state.skillPackages ?? []).find((item) => item.id === input.packageId)
  if (!current) return { ok: false as const, reason: "not_found" }
  if (!canManageSkillPackage(input.user, current)) return { ok: false as const, reason: "forbidden" }

  state.skillPackages = (state.skillPackages ?? []).map((item) =>
    item.id === current.id
      ? {
          ...item,
          displayName: input.displayName.trim(),
          updatedAt: new Date().toISOString(),
        }
      : item,
  )
  await runtimeStore.stateService.save()

  return {
    ok: true as const,
    item: toSkillPackageSummary((state.skillPackages ?? []).find((item) => item.id === current.id) || current),
  }
}
