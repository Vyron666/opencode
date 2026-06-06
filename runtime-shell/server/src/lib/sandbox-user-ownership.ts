import { chown, readdir } from "node:fs/promises"
import path from "node:path"
import { Config } from "../config"

export async function ensureSandboxUserOwnership(targetPath: string) {
  const ownership = readSandboxUserOwnership()
  if (!ownership) return
  await applyOwnershipRecursive(targetPath, ownership)
}

function readSandboxUserOwnership() {
  const matched = /^(\d+)(?::(\d+))?$/.exec(Config.sandboxDockerUser)
  if (!matched) return
  return {
    uid: Number(matched[1]),
    gid: Number(matched[2] || matched[1]),
  }
}

async function applyOwnershipRecursive(targetPath: string, ownership: {
  uid: number
  gid: number
}) {
  await chown(targetPath, ownership.uid, ownership.gid).catch(() => {})
  const entries = await readdir(targetPath, { withFileTypes: true }).catch(() => [])
  await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(targetPath, entry.name)
    if (entry.isDirectory()) {
      await applyOwnershipRecursive(entryPath, ownership)
      return
    }
    await chown(entryPath, ownership.uid, ownership.gid).catch(() => {})
  }))
}
