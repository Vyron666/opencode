import { readdir } from "node:fs/promises"
import path from "node:path"

export {}

const baseUrl = process.env.RUNTIME_SHELL_SMOKE_BASE_URL || "http://127.0.0.1:3100"
const username = process.env.RUNTIME_SHELL_SMOKE_USERNAME || "admin"
const password = process.env.RUNTIME_SHELL_SMOKE_PASSWORD || "change-me"
const workspaceRoot = process.env.RUNTIME_SHELL_WORKSPACE_ROOT || "/workspace/workspaces"
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
}

type SessionSummary = {
  id: string
}

await requestJson<ApiEnvelope<{ user: { projectIds: string[] } }>>("/api/auth/login", {
  method: "POST",
  body: { username, password },
})

const me = await requestJson<ApiEnvelope<{ user: { projectIds: string[] } }>>("/api/auth/me")
assert(me.status === 200, "auth/me failed")

const workspace = await requestJson<ApiEnvelope<WorkspaceSummary>>("/api/workspace/create", {
  method: "POST",
  body: {
    projectId: me.body.data.user.projectIds[0],
    name: `security-${Date.now()}`,
  },
})
assert(workspace.status === 200, "workspace/create failed")

const session = await requestJson<ApiEnvelope<SessionSummary>>("/api/session/create", {
  method: "POST",
  body: {
    title: `Security ${Date.now()}`,
    projectId: workspace.body.data.projectId,
    workspaceId: workspace.body.data.id,
  },
})
assert(session.status === 200, "session/create failed")

const open = await requestJson<ApiEnvelope<SessionSummary>>("/api/acp/session/open", {
  method: "POST",
  body: { businessSessionId: session.body.data.id },
})
assert(open.status === 200, "session/open failed")

await Bun.sleep(1000)

const sandboxRoot = path.join(workspaceRoot, ".sandbox")
const entries = await readdir(sandboxRoot, { withFileTypes: true }).catch(() => [])
const escapedEntries = entries
  .filter((entry) => entry.isDirectory())
  .map((entry) => path.resolve(sandboxRoot, entry.name))
  .filter((absolute) => {
    const relative = path.relative(sandboxRoot, absolute)
    return relative.startsWith("..") || path.isAbsolute(relative)
  })

assert(escapedEntries.length === 0, "sandbox workspace escaped root")

const closeResult = await requestJson<ApiEnvelope<SessionSummary>>("/api/session/close", {
  method: "POST",
  body: { businessSessionId: session.body.data.id },
})
assert(closeResult.status === 200, "session/close failed")

console.log(JSON.stringify({
  ok: true,
  businessSessionId: session.body.data.id,
  sandboxRoot,
  checkedDirectoryCount: entries.length,
  closeStatus: closeResult.status,
}))

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
