import { mkdir, readdir, rm } from "node:fs/promises"
import path from "node:path"

export async function persistWorkspaceFromSandbox(input: {
  workspacePath: string
  sandboxPath: string
  runWithGate: <T>(task: () => Promise<T>) => Promise<T>
  ensureOwnership: (targetPath: string) => Promise<void>
}) {
  await input.runWithGate(async () => {
    if (!await directoryExists(input.sandboxPath)) return
    const summary = await buildWorkspaceSyncSummary(input.workspacePath, input.sandboxPath)
    if (
      summary.addedFiles.length === 0
      && summary.modifiedFiles.length === 0
      && summary.deletedFiles.length === 0
    ) return
    await applyWorkspaceSyncSummary(input.workspacePath, input.sandboxPath, summary)
    await input.ensureOwnership(input.workspacePath)
  })
}

export async function isDirectoryEmpty(targetDir: string) {
  const entries = await directoryExists(targetDir) ? await readdir(targetDir) : []
  return entries.length === 0
}

export function isSandboxWorkLayerPath(input: {
  workspaceRootDir: string
  source: string
}) {
  const relative = path.relative(path.join(input.workspaceRootDir, ".sandbox"), input.source)
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

export async function buildWorkspaceSyncSummary(realPath: string, sandboxPath: string) {
  const realFiles = await listRelativeFiles(realPath)
  const sandboxFiles = await listRelativeFiles(sandboxPath)
  const realSet = new Set(realFiles)
  const sandboxSet = new Set(sandboxFiles)
  const addedFiles = sandboxFiles.filter((file) => !realSet.has(file))
  const deletedFiles = realFiles.filter((file) => !sandboxSet.has(file))
  const maybeModifiedFiles = sandboxFiles.filter((file) => realSet.has(file))
  const modifiedFiles: string[] = []
  for (const file of maybeModifiedFiles) {
    const [left, right] = await Promise.all([
      Bun.file(path.join(realPath, file)).bytes(),
      Bun.file(path.join(sandboxPath, file)).bytes(),
    ])
    if (!buffersEqual(left, right)) modifiedFiles.push(file)
  }
  return {
    addedFiles: addedFiles.sort(),
    modifiedFiles: modifiedFiles.sort(),
    deletedFiles: deletedFiles.sort(),
  }
}

export async function applyWorkspaceSyncSummary(
  realPath: string,
  sandboxPath: string,
  summary: {
    addedFiles: string[]
    modifiedFiles: string[]
    deletedFiles: string[]
  },
) {
  for (const file of summary.deletedFiles) {
    const target = path.join(realPath, file)
    requireSafeWorkspacePath(realPath, target)
    await rm(target, { recursive: true, force: true }).catch(() => {})
  }
  for (const file of [...summary.addedFiles, ...summary.modifiedFiles]) {
    const source = path.join(sandboxPath, file)
    const target = path.join(realPath, file)
    requireSafeWorkspacePath(realPath, target)
    await mkdir(path.dirname(target), { recursive: true })
    await Bun.write(target, Bun.file(source))
  }
}

async function listRelativeFiles(root: string, current = root): Promise<string[]> {
  const entries = await readdir(current, { withFileTypes: true }).catch(() => [])
  const files: string[] = []
  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === ".sandbox") continue
    const absolute = path.join(current, entry.name)
    const relative = path.relative(root, absolute).replace(/\\/g, "/")
    if (entry.isDirectory()) {
      files.push(...await listRelativeFiles(root, absolute))
      continue
    }
    if (!entry.isFile()) continue
    files.push(relative)
  }
  return files
}

function requireSafeWorkspacePath(root: string, target: string) {
  const relative = path.relative(root, target)
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`sandbox workspace sync path escapes workspace: ${target}`)
  }
}

function buffersEqual(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false
  }
  return true
}

async function directoryExists(targetDir: string) {
  try {
    await readdir(targetDir)
    return true
  } catch {
    return false
  }
}
