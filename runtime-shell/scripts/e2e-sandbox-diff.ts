import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { cleanupWorkspacePrefixBestEffort } from "./test-workspace-cleanup"

export {}

const baseUrl = process.env.RUNTIME_SHELL_SMOKE_BASE_URL || "http://127.0.0.1:3100"
const username = process.env.RUNTIME_SHELL_SMOKE_USERNAME || "admin"
const password = process.env.RUNTIME_SHELL_SMOKE_PASSWORD || "change-me"
const hostWorkspaceRoot = process.env.RUNTIME_SHELL_HOST_WORKSPACE_ROOT || path.resolve(process.cwd(), "..", "workspaces")
const cookieJar: string[] = []

type ApiEnvelope<T> = {
  code: number
  message: string
  data: T
  requestId: string
}

type WorkspaceSummary = {
  id: string
  projectId: string
  rootPath: string
}

type SessionSummary = {
  id: string
  status: string
}

type SandboxSummary = {
  id: string
  businessSessionId: string
  sandboxPath: string
}

type SandboxDiff = {
  id: string
  status: string
  summary: {
    addedFiles: string[]
    modifiedFiles: string[]
    deletedFiles: string[]
  }
}

await requestJson<ApiEnvelope<{ user: { projectIds: string[] } }>>("/api/auth/login", {
  method: "POST",
  body: { username, password },
})

const me = await requestJson<ApiEnvelope<{ user: { projectIds: string[] } }>>("/api/auth/me")
assert(me.status === 200 && me.body.data.user.projectIds.length > 0, "auth/me failed")
const namePrefix = `sandbox-diff-${Date.now()}`

try {
  const workspace = await requestJson<ApiEnvelope<WorkspaceSummary>>("/api/workspace/create", {
    method: "POST",
    body: {
      projectId: me.body.data.user.projectIds[0],
      name: namePrefix,
    },
  })
  assert(workspace.status === 200 && workspace.body.data.id, "workspace/create failed")

  const hostWorkspacePath = toHostWorkspacePath(workspace.body.data.rootPath)
  await mkdir(hostWorkspacePath, { recursive: true })
  await writeFile(path.join(hostWorkspacePath, "note.txt"), "before\n", "utf8")

  const session = await requestJson<ApiEnvelope<SessionSummary>>("/api/session/create", {
    method: "POST",
    body: {
      title: `Sandbox Diff ${Date.now()}`,
      projectId: workspace.body.data.projectId,
      workspaceId: workspace.body.data.id,
    },
  })
  assert(session.status === 200 && session.body.data.id, "session/create failed")

  const businessSessionId = session.body.data.id
  const openResult = await requestJson<ApiEnvelope<SessionSummary>>("/api/acp/session/open", {
    method: "POST",
    body: { businessSessionId },
  })
  assert(openResult.status === 200, "session/open failed")

  await Bun.sleep(1500)

  const sandboxes = await requestJson<ApiEnvelope<{ items: SandboxSummary[] }>>("/api/system/sandboxes?limit=200")
  assert(sandboxes.status === 200, "system/sandboxes failed")
  const sandbox = sandboxes.body.data.items.find((item) => item.businessSessionId === businessSessionId)
  assert(Boolean(sandbox), "sandbox instance not found")

  const hostSandboxPath = toHostWorkspacePath(sandbox!.sandboxPath)
  await writeFile(path.join(hostSandboxPath, "note.txt"), "after\n", "utf8")
  await writeFile(path.join(hostSandboxPath, "added.txt"), "created in sandbox\n", "utf8")

  const diffCreate = await requestJson<ApiEnvelope<SandboxDiff>>("/api/session/diff/create", {
    method: "POST",
    body: { businessSessionId },
  })
  assert(diffCreate.status === 200 && diffCreate.body.data.id, "session/diff/create failed")
  assert(diffCreate.body.data.summary.modifiedFiles.includes("note.txt"), "diff missing modified file")
  assert(diffCreate.body.data.summary.addedFiles.includes("added.txt"), "diff missing added file")

  const diffApply = await requestJson<ApiEnvelope<SandboxDiff>>("/api/session/diff/apply", {
    method: "POST",
    body: {
      businessSessionId,
      diffId: diffCreate.body.data.id,
      idempotencyKey: `diff-apply-${Date.now()}`,
    },
  })
  assert(diffApply.status === 200 && diffApply.body.data.status === "applied", "session/diff/apply failed")

  const realNote = await readFile(path.join(hostWorkspacePath, "note.txt"), "utf8")
  const realAdded = await readFile(path.join(hostWorkspacePath, "added.txt"), "utf8")
  assert(realNote === "after\n", "real workspace modified file mismatch")
  assert(realAdded === "created in sandbox\n", "real workspace added file mismatch")

  const closeResult = await requestJson<ApiEnvelope<SessionSummary>>("/api/session/close", {
    method: "POST",
    body: { businessSessionId },
  })
  assert(closeResult.status === 200, "session/close failed")

  console.log(JSON.stringify({
    ok: true,
    businessSessionId,
    diffId: diffCreate.body.data.id,
    closeStatus: closeResult.status,
    modifiedFiles: diffCreate.body.data.summary.modifiedFiles,
    addedFiles: diffCreate.body.data.summary.addedFiles,
  }))
} finally {
  await cleanupWorkspacePrefixBestEffort({
    baseUrl,
    cookieJar,
    namePrefix,
  })
}

function toHostWorkspacePath(containerPath: string) {
  const relative = containerPath.replace(/^\/workspace\/workspaces\/?/, "")
  // 中文/English: sandbox and workspace paths come back as container paths,
  // so local E2E needs a deterministic host-side mirror under the mounted workspaces directory.
  return path.resolve(hostWorkspaceRoot, relative)
}

async function requestJson<T>(pathValue: string, init: { method?: string; body?: unknown } = {}) {
  const response = await fetch(`${baseUrl}${pathValue}`, {
    method: init.method || "GET",
    headers: {
      ...(cookieJar.length ? { Cookie: cookieJar.join("; ") } : {}),
      ...(init.body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })
  mergeCookies(response)
  return {
    status: response.status,
    body: (await response.json()) as T,
  }
}

function mergeCookies(response: Response) {
  const raw = response.headers.get("set-cookie")
  if (!raw) return
  raw
    .split(/,(?=[^;]+=[^;]+)/)
    .map((item) => item.split(";")[0]?.trim())
    .filter((item): item is string => Boolean(item))
    .forEach((item) => {
      const name = item.split("=")[0]
      const index = cookieJar.findIndex((existing) => existing.startsWith(`${name}=`))
      if (index >= 0) {
        cookieJar[index] = item
        return
      }
      cookieJar.push(item)
    })
}

function assert(condition: unknown, message: string): asserts condition {
  if (condition) return
  throw new Error(message)
}
