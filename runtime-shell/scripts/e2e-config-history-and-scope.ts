const baseUrl = process.env.RUNTIME_SHELL_CONFIG_HISTORY_BASE_URL || "http://127.0.0.1:3100"
const adminUsername = process.env.RUNTIME_SHELL_CONFIG_HISTORY_ADMIN_USERNAME || "admin"
const developerUsername = process.env.RUNTIME_SHELL_CONFIG_HISTORY_DEVELOPER_USERNAME || "developer"
const password = process.env.RUNTIME_SHELL_CONFIG_HISTORY_PASSWORD || "change-me"

type ApiEnvelope<T> = {
  code: number
  message: string
  data: T
  requestId: string
}

const adminJar: string[] = []
const developerJar: string[] = []

await login(adminJar, adminUsername)
await login(developerJar, developerUsername)

const adminMcpBefore = await requestJson<ApiEnvelope<{ items: Array<{ name: string; type: "local" | "remote"; enabled?: boolean; command?: string[]; url?: string; headers?: Record<string, string>; timeout?: number }> }>>(adminJar, "/api/mcp-config")
const adminSkillBefore = await requestJson<ApiEnvelope<{ paths: string[]; urls: string[] }>>(adminJar, "/api/skill-config")
const developerMcpBefore = await requestJson<ApiEnvelope<{ items: Array<{ name: string; type: "local" | "remote"; enabled?: boolean; command?: string[]; url?: string; headers?: Record<string, string>; timeout?: number }> }>>(developerJar, "/api/mcp-config")
const developerSkillBefore = await requestJson<ApiEnvelope<{ paths: string[]; urls: string[] }>>(developerJar, "/api/skill-config")
assert(adminMcpBefore.status === 200, "admin mcp snapshot failed")
assert(adminSkillBefore.status === 200, "admin skill snapshot failed")
assert(developerMcpBefore.status === 200, "developer mcp snapshot failed")
assert(developerSkillBefore.status === 200, "developer skill snapshot failed")

const sharedMcpName = `shared-mcp-${Date.now()}`
const sharedSkillPath = `C:\\config-history\\shared-${Date.now()}`
const privateMcpName = `private-mcp-${Date.now()}`
const privateSkillPath = `C:\\config-history\\private-${Date.now()}`

const adminSharedMcpBefore = Object.fromEntries(adminMcpBefore.body.data.items.map((item) => [item.name, toMcpConfig(item)]))
const developerPrivateMcpBefore = Object.fromEntries(
  developerMcpBefore.body.data.items
    .filter((item) => !adminSharedMcpBefore[item.name])
    .map((item) => [item.name, toMcpConfig(item)]),
)
const adminSharedSkillBefore = {
  paths: adminSkillBefore.body.data.paths,
  urls: adminSkillBefore.body.data.urls,
}
const developerPrivateSkillBefore = {
  paths: developerSkillBefore.body.data.paths.filter((item) => !adminSharedSkillBefore.paths.includes(item)),
  urls: developerSkillBefore.body.data.urls.filter((item) => !adminSharedSkillBefore.urls.includes(item)),
}

try {
  const adminMcpSave = await requestJson<ApiEnvelope<{ success: boolean; count: number }>>(adminJar, "/api/mcp-config/save", {
    method: "POST",
    body: {
      servers: {
        ...adminSharedMcpBefore,
        [sharedMcpName]: {
          type: "remote",
          url: "https://example.invalid/mcp",
          enabled: true,
        },
      },
    },
  })
  assert(adminMcpSave.status === 200, "admin mcp save failed")

  const adminSkillSave = await requestJson<ApiEnvelope<{ success: boolean }>>(adminJar, "/api/skill-config/save", {
    method: "POST",
    body: {
      paths: [...adminSharedSkillBefore.paths, sharedSkillPath],
      urls: adminSharedSkillBefore.urls,
    },
  })
  assert(adminSkillSave.status === 200, "admin skill save failed")

  const developerMcpConflict = await requestJson<ApiEnvelope<{ success: boolean }>>(developerJar, "/api/mcp-config/save", {
    method: "POST",
    body: {
      servers: {
        [sharedMcpName]: {
          type: "remote",
          url: "https://example.invalid/conflict",
          enabled: true,
        },
      },
    },
  })
  assert(developerMcpConflict.status === 409, "developer mcp conflict should return 409")

  const developerMcpSave = await requestJson<ApiEnvelope<{ success: boolean; count: number }>>(developerJar, "/api/mcp-config/save", {
    method: "POST",
    body: {
      servers: {
        ...developerPrivateMcpBefore,
        [privateMcpName]: {
          type: "local",
          command: ["npx", "-y", "@modelcontextprotocol/server-filesystem"],
          enabled: true,
        },
      },
    },
  })
  assert(developerMcpSave.status === 200, "developer private mcp save failed")

  const developerSkillSave = await requestJson<ApiEnvelope<{ success: boolean }>>(developerJar, "/api/skill-config/save", {
    method: "POST",
    body: {
      paths: [...developerPrivateSkillBefore.paths, privateSkillPath],
      urls: developerPrivateSkillBefore.urls,
    },
  })
  assert(developerSkillSave.status === 200, "developer private skill save failed")

  const adminHistory = await requestJson<ApiEnvelope<{ items: Array<{ namespace: string; scopeLevel: string; scopeId: string; summaryJson: Record<string, unknown> }> }>>(
    adminJar,
    "/api/config-history/list?limit=20",
  )
  assert(adminHistory.status === 200, "admin config history should succeed")
  assert(
    adminHistory.body.data.items.some((item) => item.namespace === "mcp" && item.scopeLevel === "platform" && item.scopeId === "platform_shared"),
    "admin history should contain platform mcp record",
  )
  assert(
    adminHistory.body.data.items.some((item) => item.namespace === "skill" && item.scopeLevel === "platform" && item.scopeId === "platform_shared"),
    "admin history should contain platform skill record",
  )

  const developerHistory = await requestJson<ApiEnvelope<{ items: Array<{ namespace: string; scopeLevel: string; scopeId: string; summaryJson: Record<string, unknown> }> }>>(
    developerJar,
    "/api/config-history/list?limit=20",
  )
  assert(developerHistory.status === 200, "developer config history should succeed")
  assert(
    developerHistory.body.data.items.every((item) => item.scopeLevel === "user"),
    "developer history should only contain user scoped records",
  )
  assert(
    developerHistory.body.data.items.some((item) => item.namespace === "mcp" && item.summaryJson?.source === "user_private"),
    "developer history should contain private mcp record",
  )
  assert(
    developerHistory.body.data.items.some((item) => item.namespace === "skill" && item.summaryJson?.source === "user_private"),
    "developer history should contain private skill record",
  )

  const developerMcpGet = await requestJson<ApiEnvelope<{ items: Array<{ name: string }> }>>(developerJar, "/api/mcp-config")
  assert(developerMcpGet.status === 200, "developer mcp list failed")
  assert(
    developerMcpGet.body.data.items.some((item) => item.name === sharedMcpName) &&
      developerMcpGet.body.data.items.some((item) => item.name === privateMcpName),
    "developer should see both shared and private mcp",
  )

  const developerSkillGet = await requestJson<ApiEnvelope<{ paths: string[]; urls: string[] }>>(developerJar, "/api/skill-config")
  assert(developerSkillGet.status === 200, "developer skill list failed")
  assert(
    developerSkillGet.body.data.paths.includes(sharedSkillPath) && developerSkillGet.body.data.paths.includes(privateSkillPath),
    "developer should see merged shared and private skill paths",
  )

  console.log(
    JSON.stringify({
      ok: true,
      baseUrl,
      sharedMcpName,
      privateMcpName,
      sharedSkillPath,
      privateSkillPath,
      developerStatuses: {
        mcpConflict: developerMcpConflict.status,
        mcpSave: developerMcpSave.status,
        skillSave: developerSkillSave.status,
      },
      historyCounts: {
        admin: adminHistory.body.data.items.length,
        developer: developerHistory.body.data.items.length,
      },
    }),
  )
} finally {
  // 中文/English: restore the original config snapshot so this e2e does not
  // leave shared/private MCP or skill residue that slows later sandbox tests.
  await requestJson(adminJar, "/api/mcp-config/save", {
    method: "POST",
    body: { servers: adminSharedMcpBefore },
  })
  await requestJson(adminJar, "/api/skill-config/save", {
    method: "POST",
    body: adminSharedSkillBefore,
  })
  await requestJson(developerJar, "/api/mcp-config/save", {
    method: "POST",
    body: { servers: developerPrivateMcpBefore },
  })
  await requestJson(developerJar, "/api/skill-config/save", {
    method: "POST",
    body: developerPrivateSkillBefore,
  })
}

async function login(jar: string[], username: string) {
  const response = await requestJson<ApiEnvelope<{ user: { id: string } }>>(jar, "/api/auth/login", {
    method: "POST",
    body: { username, password },
  })
  assert(response.status === 200, `${username} login failed`)
  return response.body.data.user
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

function toMcpConfig(item: {
  type: "local" | "remote"
  enabled?: boolean
  command?: string[]
  url?: string
  headers?: Record<string, string>
  timeout?: number
}) {
  return item.type === "local"
    ? {
        type: "local" as const,
        command: item.command || [],
        ...(item.enabled === undefined ? {} : { enabled: item.enabled }),
        ...(item.timeout === undefined ? {} : { timeout: item.timeout }),
      }
    : {
        type: "remote" as const,
        url: item.url || "",
        ...(item.enabled === undefined ? {} : { enabled: item.enabled }),
        ...(item.timeout === undefined ? {} : { timeout: item.timeout }),
        ...(item.headers ? { headers: item.headers } : {}),
      }
}
