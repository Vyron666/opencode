import path from "node:path"
import { mkdir, rm } from "node:fs/promises"
import extractZip from "extract-zip"
import { Config } from "../../config"
import type { SkillPackageRecord, SkillPackageScope, User } from "../../types"
import { authorizeSettingsAction } from "../access/authorization-service"
import { runtimeStore } from "../store/store-singleton"
import {
  getPlatformSkillConfig,
  getUserPrivateSkillConfig,
  savePlatformSkillConfig,
  saveUserPrivateSkillConfig,
} from "../configuration/configuration-service"

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024

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

export async function resolveSkillAsset(input: {
  token: string
  skillName: string
  filePath: string
}) {
  const state = runtimeStore.stateService.readState()
  const current = (state.skillPackages ?? []).find((item) => item.token === input.token && item.skillName === input.skillName)
  if (!current) return null
  const safePath = normalizeSkillAssetPath(input.filePath)
  if (safePath === null) return null
  const skillRootDir = path.join(Config.storageDir, current.relativeDir, current.skillRootDir)
  const absolutePath = path.join(skillRootDir, safePath)
  if (!isWithinDir(skillRootDir, absolutePath)) return null
  const file = Bun.file(absolutePath)
  if (!(await file.exists())) return null
  return {
    file,
    contentType: file.type || readContentType(absolutePath),
  }
}

export function findSkillPackageByToken(token: string) {
  const state = runtimeStore.stateService.readState()
  return (state.skillPackages ?? []).find((item) => item.token === token) || null
}

export function buildSkillIndexPayload(items: SkillPackageRecord[]) {
  return {
    skills: items.map((item) => ({
      name: item.skillName,
      files: listSkillFiles(item),
    })),
  }
}

function readPackageScope(user: User): SkillPackageScope {
  return user.role === "admin" ? "platform_shared" : "user_private"
}

function buildRelativeDir(user: User, packageId: string) {
  return path.join(
    "skill-packages",
    user.tenantId,
    user.organizationId,
    user.role === "admin" ? "platform_shared" : user.id,
    packageId,
  )
}

function buildSkillPackageUrl(record: SkillPackageRecord) {
  return `${Config.publicBaseUrl}/api/skill-package/content/${record.token}/`
}

async function syncSkillPackageUrl(input: {
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

async function removeSkillPackageUrl(input: {
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

async function findSkillManifest(rootDir: string) {
  const skillFiles = Array.from(new Bun.Glob("**/SKILL.md").scanSync(rootDir))
  if (skillFiles.length !== 1) return null
  const skillFile = skillFiles[0]
  if (!skillFile) return null

  const absolutePath = path.join(rootDir, skillFile)
  const content = await Bun.file(absolutePath).text()
  const skillName = readFrontmatterField(content, "name") || path.basename(path.dirname(absolutePath))
  if (!skillName) return null
  const description = readFrontmatterField(content, "description")
  const skillDir = path.dirname(absolutePath)
  return {
    skillName,
    description,
    skillRootDir: path.relative(rootDir, skillDir) || ".",
  }
}

function readFrontmatterField(content: string, field: string) {
  const match = content.match(new RegExp(`^${field}:\\s*(.+)$`, "m"))
  return match?.[1]?.trim().replace(/^['"]|['"]$/g, "") || ""
}

function toSkillPackageSummary(item: SkillPackageRecord) {
  return {
    id: item.id,
    skillName: item.skillName,
    displayName: item.displayName,
    description: item.description,
    scope: item.scope,
    sourceLabel: item.scope === "platform_shared" ? "平台共享" : "用户私有",
    sourceFilename: item.sourceFilename,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    url: buildSkillPackageUrl(item),
  }
}

function canManageSkillPackage(user: User, item: SkillPackageRecord) {
  if (user.tenantId !== item.tenantId || user.organizationId !== item.organizationId) return false
  if (user.role === "admin") return item.scope === "platform_shared"
  return item.scope === "user_private" && item.userId === user.id
}

function normalizeSkillAssetPath(filePath: string) {
  const normalized = filePath.replace(/^\/+/, "")
  if (normalized.includes("..")) return null
  return normalized
}

function isWithinDir(rootDir: string, target: string) {
  const relative = path.relative(path.resolve(rootDir), path.resolve(target))
  return !relative.startsWith("..") && !path.isAbsolute(relative)
}

function readContentType(filePath: string) {
  if (filePath.endsWith(".md")) return "text/markdown; charset=utf-8"
  if (filePath.endsWith(".json")) return "application/json; charset=utf-8"
  if (filePath.endsWith(".png")) return "image/png"
  if (filePath.endsWith(".jpg") || filePath.endsWith(".jpeg")) return "image/jpeg"
  if (filePath.endsWith(".svg")) return "image/svg+xml"
  return "application/octet-stream"
}

function listSkillFiles(item: SkillPackageRecord) {
  const rootDir = path.join(Config.storageDir, item.relativeDir, item.skillRootDir)
  return Array.from(new Bun.Glob("**/*").scanSync(rootDir)).filter((file) => !file.endsWith("/") && file !== "source.zip")
}

async function cleanupDirectory(targetDir: string) {
  await rm(targetDir, { recursive: true, force: true })
}
