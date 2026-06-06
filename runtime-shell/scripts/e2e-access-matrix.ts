const baseUrl = process.env.RUNTIME_SHELL_ACCESS_MATRIX_BASE_URL || "http://127.0.0.1:3100"
const adminUsername = process.env.RUNTIME_SHELL_ACCESS_MATRIX_ADMIN_USERNAME || "admin"
const developerUsername = process.env.RUNTIME_SHELL_ACCESS_MATRIX_DEVELOPER_USERNAME || "developer"
const sharedUsername = process.env.RUNTIME_SHELL_ACCESS_MATRIX_SHARED_USERNAME || "developer-secondary"
const password = process.env.RUNTIME_SHELL_ACCESS_MATRIX_PASSWORD || "change-me"
const postgresContainer = process.env.RUNTIME_SHELL_ACCESS_MATRIX_POSTGRES_CONTAINER || "runtime-shell-postgres"

type ApiEnvelope<T> = {
  code: number
  message: string
  data: T
  requestId: string
}

const adminJar: string[] = []
const developerJar: string[] = []
const sharedJar: string[] = []

const admin = await login(adminJar, adminUsername)
const developer = await login(developerJar, developerUsername)
const shared = await login(sharedJar, sharedUsername)

const ownerWorkspace = await requestJson<ApiEnvelope<{ id: string; projectId: string }>>(developerJar, "/api/workspace/create", {
  method: "POST",
  body: {
    projectId: developer.projectIds[0],
    name: `access-owner-${Date.now()}`,
  },
})
assert(ownerWorkspace.status === 200, "developer workspace/create failed")

const ownerSession = await requestJson<ApiEnvelope<{ id: string }>>(developerJar, "/api/session/create", {
  method: "POST",
  body: {
    title: `Owner Session ${Date.now()}`,
    projectId: developer.projectIds[0],
    workspaceId: ownerWorkspace.body.data.id,
  },
})
assert(ownerSession.status === 200, "developer session/create failed")

const ownerBusinessSessionId = ownerSession.body.data.id

const openOwnerSession = await requestJson<ApiEnvelope<{ id: string; status: string }>>(developerJar, "/api/acp/session/open", {
  method: "POST",
  body: {
    businessSessionId: ownerBusinessSessionId,
  },
})
assert(openOwnerSession.status === 200, "developer session/open failed")

const ownerClose = await requestJson<ApiEnvelope<{ id: string; status: string }>>(developerJar, "/api/session/close", {
  method: "POST",
  body: {
    businessSessionId: ownerBusinessSessionId,
  },
})
assert(ownerClose.status === 200 && ownerClose.body.data.status === "completed", "developer session/close failed")

await runPostgresSql([
  `UPDATE business_session SET status = 'orphaned', binding_json = NULL WHERE id = '${ownerBusinessSessionId}';`,
  `UPDATE business_session_runtime_binding SET binding_status = 'lost', released_at = NULL WHERE business_session_id = '${ownerBusinessSessionId}';`,
  `DELETE FROM runtime_lease WHERE business_session_id = '${ownerBusinessSessionId}';`,
].join(" "))

const ownerRecover = await requestJson<ApiEnvelope<{ id: string; status: string }>>(developerJar, "/api/acp/session/recover", {
  method: "POST",
  body: {
    businessSessionId: ownerBusinessSessionId,
  },
})
assert(ownerRecover.status === 200, "owner recover should succeed")

const ownerRebindForbidden = await requestJson<ApiEnvelope<{ session: unknown }>>(developerJar, "/api/acp/session/rebind", {
  method: "POST",
  body: {
    businessSessionId: ownerBusinessSessionId,
    reason: "owner-test",
  },
})
assert(ownerRebindForbidden.status === 403, "developer rebind should be forbidden")

const adminRebind = await requestJson<ApiEnvelope<{ session: { status: string }; binding: { workerId: string } }>>(
  adminJar,
  "/api/acp/session/rebind",
  {
    method: "POST",
    body: {
      businessSessionId: ownerBusinessSessionId,
      reason: "admin-rebind-test",
    },
  },
)
assert(adminRebind.status === 200, "admin rebind should succeed")

const ownerOpenAgain = await requestJson<ApiEnvelope<{ id: string; status: string }>>(developerJar, "/api/acp/session/open", {
  method: "POST",
  body: {
    businessSessionId: ownerBusinessSessionId,
  },
})
assert(ownerOpenAgain.status === 200 && ownerOpenAgain.body.data.status === "active", "owner reopen after rebind failed")

const ownerFork = await requestJson<ApiEnvelope<{ id: string; status: string }>>(developerJar, "/api/acp/session/fork", {
  method: "POST",
  body: {
    businessSessionId: ownerBusinessSessionId,
    title: `Owner Fork ${Date.now()}`,
  },
})
assert(ownerFork.status === 200 && ownerFork.body.data.status === "active", "owner fork should succeed")
const ownerForkBusinessSessionId = ownerFork.body.data.id

const sharedWorkspace = await requestJson<ApiEnvelope<{ id: string; projectId: string }>>(adminJar, "/api/workspace/create", {
  method: "POST",
  body: {
    projectId: admin.projectIds[0],
    name: `access-shared-${Date.now()}`,
  },
})
assert(sharedWorkspace.status === 200, "admin workspace/create failed")

const sharedSession = await requestJson<ApiEnvelope<{ id: string }>>(adminJar, "/api/session/create", {
  method: "POST",
  body: {
    title: `Shared Session ${Date.now()}`,
    projectId: sharedWorkspace.body.data.projectId,
    workspaceId: sharedWorkspace.body.data.id,
  },
})
assert(sharedSession.status === 200, "admin shared session/create failed")

const sharedBusinessSessionId = sharedSession.body.data.id
const sharedOpen = await requestJson<ApiEnvelope<{ id: string; status: string }>>(adminJar, "/api/acp/session/open", {
  method: "POST",
  body: { businessSessionId: sharedBusinessSessionId },
})
assert(sharedOpen.status === 200, "admin shared session/open failed")

const shareBinding = await requestJson<ApiEnvelope<{ id: string; status: string }>>(adminJar, "/api/workspace/share/create", {
  method: "POST",
  body: {
    workspaceId: sharedWorkspace.body.data.id,
    projectId: sharedWorkspace.body.data.projectId,
    targetUserId: shared.id,
  },
})
assert(shareBinding.status === 200, "workspace share failed")

const sharedDetail = await requestJson<ApiEnvelope<{ session: { visibility: string; capabilities: Record<string, boolean> } }>>(
  sharedJar,
  `/api/session/detail?businessSessionId=${encodeURIComponent(sharedBusinessSessionId)}`,
)
assert(sharedDetail.status === 200, "shared detail should succeed")
assert(sharedDetail.body.data.session.visibility === "workspace_share", "shared visibility should be workspace_share")
assert(sharedDetail.body.data.session.capabilities.prompt === true, "shared session should allow prompt")
assert(sharedDetail.body.data.session.capabilities.close === false, "shared session should not allow close")
assert(sharedDetail.body.data.session.capabilities.fork === false, "shared session should not allow fork")
assert(sharedDetail.body.data.session.capabilities.updateMode === false, "shared session should not allow mode update")
assert(sharedDetail.body.data.session.capabilities.updateModel === false, "shared session should not allow model update")
assert(sharedDetail.body.data.session.capabilities.updateConfig === false, "shared session should not allow config update")

const sharedOpenByViewer = await requestJson<ApiEnvelope<{ id: string; status: string }>>(sharedJar, "/api/acp/session/open", {
  method: "POST",
  body: { businessSessionId: sharedBusinessSessionId },
})
const sharedLoadByViewer = await requestJson<ApiEnvelope<{ id: string; status: string }>>(sharedJar, "/api/acp/session/load", {
  method: "POST",
  body: { businessSessionId: sharedBusinessSessionId },
})
const sharedResumeByViewer = await requestJson<ApiEnvelope<{ id: string; status: string }>>(sharedJar, "/api/acp/session/resume", {
  method: "POST",
  body: { businessSessionId: sharedBusinessSessionId },
})
const sharedPromptByViewer = await requestJson<ApiEnvelope<{ accepted: boolean }>>(sharedJar, "/api/acp/session/input", {
  method: "POST",
  body: {
    businessSessionId: sharedBusinessSessionId,
    parts: [{ type: "text", text: "shared access ok" }],
  },
})
assert(sharedOpenByViewer.status === 200, "shared open should succeed")
assert(sharedLoadByViewer.status === 200, "shared load should succeed")
assert(sharedResumeByViewer.status === 200, "shared resume should succeed")
assert(sharedPromptByViewer.status === 200, "shared prompt should succeed")

const sharedForbiddenStatuses = await Promise.all([
  requestJson<ApiEnvelope<{ success: boolean }>>(sharedJar, "/api/session/close", {
    method: "POST",
    body: { businessSessionId: sharedBusinessSessionId },
  }),
  requestJson<ApiEnvelope<{ session: unknown }>>(sharedJar, "/api/acp/session/fork", {
    method: "POST",
    body: { businessSessionId: sharedBusinessSessionId, title: "forbidden fork" },
  }),
  requestJson<ApiEnvelope<{ success: boolean }>>(sharedJar, "/api/acp/session/mode/update", {
    method: "POST",
    body: { businessSessionId: sharedBusinessSessionId, modeId: "plan" },
  }),
  requestJson<ApiEnvelope<{ success: boolean }>>(sharedJar, "/api/acp/session/model/update", {
    method: "POST",
    body: { businessSessionId: sharedBusinessSessionId, modelId: "deepseek/deepseek-v4-pro" },
  }),
  requestJson<ApiEnvelope<{ success: boolean }>>(sharedJar, "/api/acp/session/config/update", {
    method: "POST",
    body: { businessSessionId: sharedBusinessSessionId, configId: "effort", value: "high" },
  }),
  requestJson<ApiEnvelope<{ session: unknown }>>(sharedJar, "/api/acp/session/rebind", {
    method: "POST",
    body: { businessSessionId: sharedBusinessSessionId, reason: "shared-forbidden" },
  }),
])
assert(sharedForbiddenStatuses.every((item) => item.status === 403), "shared forbidden session actions should all return 403")

const outsiderForbiddenStatuses = await Promise.all([
  requestJson<ApiEnvelope<{ session: unknown }>>(developerJar, `/api/session/detail?businessSessionId=${encodeURIComponent(sharedBusinessSessionId)}`),
  requestJson<ApiEnvelope<{ id: string }>>(developerJar, "/api/acp/session/open", {
    method: "POST",
    body: { businessSessionId: sharedBusinessSessionId },
  }),
  requestJson<ApiEnvelope<{ id: string }>>(developerJar, "/api/acp/session/load", {
    method: "POST",
    body: { businessSessionId: sharedBusinessSessionId },
  }),
  requestJson<ApiEnvelope<{ id: string }>>(developerJar, "/api/acp/session/resume", {
    method: "POST",
    body: { businessSessionId: sharedBusinessSessionId },
  }),
  requestJson<ApiEnvelope<{ accepted: boolean }>>(developerJar, "/api/acp/session/input", {
    method: "POST",
    body: {
      businessSessionId: sharedBusinessSessionId,
      parts: [{ type: "text", text: "outsider forbidden" }],
    },
  }),
])
assert(outsiderForbiddenStatuses.every((item) => item.status === 403), "outsider session actions should all return 403")

const ownerFinalClose = await requestJson<ApiEnvelope<{ id: string; status: string }>>(developerJar, "/api/session/close", {
  method: "POST",
  body: {
    businessSessionId: ownerBusinessSessionId,
  },
})
assert(ownerFinalClose.status === 200, "owner final close failed")

const ownerForkClose = await requestJson<ApiEnvelope<{ id: string; status: string }>>(developerJar, "/api/session/close", {
  method: "POST",
  body: {
    businessSessionId: ownerForkBusinessSessionId,
  },
})
assert(ownerForkClose.status === 200, "owner fork close failed")

const sharedFinalClose = await requestJson<ApiEnvelope<{ id: string; status: string }>>(adminJar, "/api/session/close", {
  method: "POST",
  body: {
    businessSessionId: sharedBusinessSessionId,
  },
})
assert(sharedFinalClose.status === 200, "shared final close failed")

console.log(
  JSON.stringify({
    ok: true,
    baseUrl,
    ownerSessionId: ownerBusinessSessionId,
    sharedSessionId: sharedBusinessSessionId,
    ownerRecoverStatus: ownerRecover.status,
    ownerRebindForbiddenStatus: ownerRebindForbidden.status,
    adminRebindStatus: adminRebind.status,
    ownerForkStatus: ownerFork.status,
    ownerFinalCloseStatus: ownerFinalClose.status,
    ownerForkCloseStatus: ownerForkClose.status,
    sharedFinalCloseStatus: sharedFinalClose.status,
    sharedForbiddenStatuses: sharedForbiddenStatuses.map((item) => item.status),
    outsiderForbiddenStatuses: outsiderForbiddenStatuses.map((item) => item.status),
  }),
)

async function login(jar: string[], username: string) {
  const response = await requestJson<ApiEnvelope<{ user: { id: string; projectIds: string[] } }>>(jar, "/api/auth/login", {
    method: "POST",
    body: {
      username,
      password,
    },
  })
  assert(response.status === 200, `${username} login failed`)
  return response.body.data.user
}

async function runPostgresSql(sql: string) {
  const command = [
    "docker",
    "exec",
    postgresContainer,
    "psql",
    "-U",
    "postgres",
    "-d",
    "runtime_shell",
    "-c",
    sql.replace(/\s+/g, " ").trim(),
  ]
  const child = Bun.spawn(command, { stdout: "pipe", stderr: "pipe" })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (exitCode === 0) return stdout
  throw new Error(`postgres sql failed: ${stderr || stdout}`)
}

async function requestJson<T>(
  jar: string[],
  path: string,
  init: {
    method?: string
    body?: unknown
  } = {},
) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: init.method || "GET",
    headers: {
      ...(jar.length ? { Cookie: jar.join("; ") } : {}),
      ...(init.body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })
  mergeCookies(jar, response)
  const text = await response.text()
  return {
    status: response.status,
    body: JSON.parse(text) as T,
  }
}

function mergeCookies(jar: string[], response: Response) {
  const raw = response.headers.get("set-cookie")
  if (!raw) return
  raw
    .split(/,(?=[^;]+=[^;]+)/)
    .map((item) => item.split(";")[0]?.trim())
    .filter((item): item is string => Boolean(item))
    .forEach((item) => {
      const name = item.split("=")[0]
      const index = jar.findIndex((existing) => existing.startsWith(`${name}=`))
      if (index >= 0) {
        jar[index] = item
        return
      }
      jar.push(item)
    })
}

function assert(condition: unknown, message: string): asserts condition {
  if (condition) return
  throw new Error(message)
}
