import path from "node:path"
import { rm } from "node:fs/promises"
import { Config } from "../../config"
import type { SkillPackageRecord, SkillPackageScope, User } from "../../types"

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024

export function readPackageScope(user: User): SkillPackageScope {
  return user.role === "admin" ? "platform_shared" : "user_private"
}

export function buildRelativeDir(user: User, packageId: string) {
  return path.join(
    "skill-packages",
    user.tenantId,
    user.organizationId,
    user.role === "admin" ? "platform_shared" : user.id,
    packageId,
  )
}

export function buildSkillPackageUrl(record: SkillPackageRecord) {
  return `${Config.publicBaseUrl}/api/skill-package/content/${record.token}/`
}

export async function findSkillManifest(rootDir: string) {
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

export function readFrontmatterField(content: string, field: string) {
  const match = content.match(new RegExp(`^${field}:\\s*(.+)$`, "m"))
  return match?.[1]?.trim().replace(/^['"]|['"]$/g, "") || ""
}

export function toSkillPackageSummary(item: SkillPackageRecord) {
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

export function canManageSkillPackage(user: User, item: SkillPackageRecord) {
  if (user.tenantId !== item.tenantId || user.organizationId !== item.organizationId) return false
  if (user.role === "admin") return item.scope === "platform_shared"
  return item.scope === "user_private" && item.userId === user.id
}

export function normalizeSkillAssetPath(filePath: string) {
  const normalized = filePath.replace(/^\/+/, "")
  if (normalized.includes("..")) return null
  return normalized
}

export function isWithinDir(rootDir: string, target: string) {
  const relative = path.relative(path.resolve(rootDir), path.resolve(target))
  return !relative.startsWith("..") && !path.isAbsolute(relative)
}

export function readContentType(filePath: string) {
  if (filePath.endsWith(".md")) return "text/markdown; charset=utf-8"
  if (filePath.endsWith(".json")) return "application/json; charset=utf-8"
  if (filePath.endsWith(".png")) return "image/png"
  if (filePath.endsWith(".jpg") || filePath.endsWith(".jpeg")) return "image/jpeg"
  if (filePath.endsWith(".svg")) return "image/svg+xml"
  return "application/octet-stream"
}

export function listSkillFiles(item: SkillPackageRecord) {
  const rootDir = path.join(Config.storageDir, item.relativeDir, item.skillRootDir)
  return Array.from(new Bun.Glob("**/*").scanSync(rootDir)).filter((file) => !file.endsWith("/") && file !== "source.zip")
}

export async function cleanupDirectory(targetDir: string) {
  await rm(targetDir, { recursive: true, force: true })
}
