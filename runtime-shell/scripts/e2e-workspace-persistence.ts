import { readFile } from "node:fs/promises"
import path from "node:path"
import { cleanupWorkspacePrefixBestEffort } from "./test-workspace-cleanup"

export {}

const baseUrl = process.env.RUNTIME_SHELL_PERSISTENCE_BASE_URL || "http://127.0.0.1:3100"
const username = process.env.RUNTIME_SHELL_PERSISTENCE_USERNAME || "admin"
const password = process.env.RUNTIME_SHELL_PERSISTENCE_PASSWORD || "change-me"
const hostWorkspaceRoot = process.env.RUNTIME_SHELL_HOST_WORKSPACE_ROOT || path.resolve(process.cwd(), "..", "docker-data", "runtime-shell-workspaces")
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
  workerId: string
}

type SandboxSummary = {
  id: string
  businessSessionId: string
  workspaceId: string
  status: string
  sandboxPath: string
  detail?: Record<string, unknown>
}

const login = await requestJson<ApiEnvelope<{ user: { projectIds: string[] } }>>("/api/auth/login", {
  method: "POST",
  body: { username, password },
})
assert(login.status === 200, "login failed")
const projectId = login.body.data.user.projectIds[0]
assert(projectId, "project scope missing")

const workspaceName = `persist-check-${Date.now()}`
const fileName = "persist-check.txt"
const fileContent = `persisted-${Date.now()}\n`

try {
  const workspace = await requestJson<ApiEnvelope<WorkspaceSummary>>("/api/workspace/create", {
    method: "POST",
    body: {
      projectId,
      name: workspaceName,
    },
  })
  assert(workspace.status === 200, "workspace/create failed")

  const firstSession = await createSession(workspace.body.data, "first")
  await openSession(firstSession.id)
  const leasedContainer = await findLeasedSessionContainer(firstSession.id)
  await dockerExec(leasedContainer, ["sh", "-lc", `printf %s ${shellQuote(fileContent)} > /workspace/current/${fileName}`])

  const firstClose = await closeSession(firstSession.id)
  assert(firstClose.status === "completed", "first session close did not complete")
  await waitForFileContent(toHostWorkspacePath(workspace.body.data.rootPath, fileName), fileContent)

  const reopened = await openSession(firstSession.id)
  assert(reopened.status === "active", "reopen first session failed")
  const reopenedContainer = await findLeasedSessionContainer(firstSession.id)
  const reopenedContent = await dockerExec(reopenedContainer, ["cat", `/workspace/current/${fileName}`])
  assert(reopenedContent === fileContent, "reopened original session cannot see persisted file")
  await closeSession(firstSession.id)

  const secondSession = await createSession(workspace.body.data, "second")
  const secondOpen = await openSession(secondSession.id)
  assert(secondOpen.status === "active", "second session open failed")
  const secondContainer = await findLeasedSessionContainer(secondSession.id)
  const secondContent = await dockerExec(secondContainer, ["cat", `/workspace/current/${fileName}`])
  assert(secondContent === fileContent, "new session in same workspace cannot see persisted file")
  await closeSession(secondSession.id)

  console.log(JSON.stringify({
    ok: true,
    workspaceId: workspace.body.data.id,
    firstSessionId: firstSession.id,
    secondSessionId: secondSession.id,
    fileName,
    fileContent,
    semantics: "one workspace sandbox copy reused by multiple sessions",
  }))
} finally {
  await cleanupWorkspacePrefixBestEffort({
    baseUrl,
    cookieJar,
    namePrefix: "persist-check-",
  })
}

async function createSession(workspace: WorkspaceSummary, suffix: string) {
  const response = await requestJson<ApiEnvelope<SessionSummary>>("/api/session/create", {
    method: "POST",
    body: {
      title: `Persistence ${suffix} ${Date.now()}`,
      projectId: workspace.projectId,
      workspaceId: workspace.id,
    },
  })
  assert(response.status === 200, `session/create failed: ${suffix}`)
  return response.body.data
}

async function openSession(businessSessionId: string) {
  const response = await requestJson<ApiEnvelope<SessionSummary>>("/api/acp/session/open", {
    method: "POST",
    body: { businessSessionId },
  })
  assert(response.status === 200, `session/open failed: ${businessSessionId}`)
  return response.body.data
}

async function closeSession(businessSessionId: string) {
  const response = await requestJson<ApiEnvelope<SessionSummary>>("/api/session/close", {
    method: "POST",
    body: { businessSessionId },
  })
  assert(response.status === 200, `session/close failed: ${businessSessionId}`)
  return response.body.data
}

async function findLeasedSessionContainer(businessSessionId: string) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < 15_000) {
    const sandboxes = await requestJson<ApiEnvelope<{ items: SandboxSummary[] }>>("/api/system/sandboxes?limit=500")
    const leased = sandboxes.body.data.items.find((item) =>
      (item.status === "running" || item.status === "leased") &&
      item.businessSessionId === businessSessionId &&
      typeof item.detail.containerName === "string",
    )
    if (typeof leased?.detail?.containerName === "string") return leased.detail.containerName
    await Bun.sleep(500)
  }
  throw new Error(`leased session container not found: ${businessSessionId}`)
}

async function waitForFileContent(filePath: string, expected: string) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < 15_000) {
    const content = await readFile(filePath, "utf8").catch(() => undefined)
    if (content === expected) return
    await Bun.sleep(500)
  }
  throw new Error(`persisted file not found or mismatch: ${filePath}`)
}

function toHostWorkspacePath(containerRootPath: string, relativeFile: string) {
  return path.join(
    path.resolve(hostWorkspaceRoot, containerRootPath.replace(/^\/workspace\/workspaces\/?/, "")),
    relativeFile,
  )
}

async function dockerExec(containerName: string, args: string[]) {
  const child = Bun.spawn(["docker", "exec", containerName, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (exitCode === 0) return stdout
  throw new Error(`docker exec failed: ${containerName} ${stderr || stdout}`)
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`
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
