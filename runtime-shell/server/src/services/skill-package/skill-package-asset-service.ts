import path from "node:path"
import { Config } from "../../config"
import type { SkillPackageRecord } from "../../types"
import { runtimeStore } from "../store/store-singleton"
import {
  isWithinDir,
  listSkillFiles,
  normalizeSkillAssetPath,
  readContentType,
} from "./skill-package-support"

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
