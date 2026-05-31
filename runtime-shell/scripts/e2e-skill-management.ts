import { mkdtemp, mkdir, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const baseUrl = process.env.RUNTIME_SHELL_SKILL_BASE_URL || "http://127.0.0.1:3100"
const password = process.env.RUNTIME_SHELL_SKILL_PASSWORD || "change-me"
const adminUsername = process.env.RUNTIME_SHELL_SKILL_ADMIN_USERNAME || "admin"
const developerUsername = process.env.RUNTIME_SHELL_SKILL_DEVELOPER_USERNAME || "developer"
const developerSecondaryUsername = process.env.RUNTIME_SHELL_SKILL_DEVELOPER_SECONDARY_USERNAME || "developer-secondary"

type ApiEnvelope<T> = {
  code: number
  message: string
  data: T
  requestId: string
}

type SkillPackageSummary = {
  id: string
  skillName: string
  displayName: string
  scope: "platform_shared" | "user_private"
  sourceLabel: string
  sourceFilename: string
  url: string
}

type SkillConfigItem = {
  type: "path" | "url"
  value: string
  source: "platform_shared" | "user_private"
}

const adminJar: string[] = []
const developerJar: string[] = []
const developerSecondaryJar: string[] = []
const createdDirs: string[] = []

const timestamp = Date.now()
const sharedSkillName = `skill-shared-${timestamp}`
const privateSkillName = `skill-private-${timestamp}`
const sharedRenamedDisplayName = `共享技能-${timestamp}`
const privateRenamedDisplayName = `私有技能-${timestamp}`

try {
  await login(adminJar, adminUsername)
  await login(developerJar, developerUsername)
  await login(developerSecondaryJar, developerSecondaryUsername)

  const sharedZipV1 = await createSkillZip({
    skillName: sharedSkillName,
    description: "shared skill v1",
    extraFiles: {
      "notes.txt": "shared version 1",
    },
  })
  const sharedUploadV1 = await uploadSkill(adminJar, sharedZipV1, "shared-v1.zip")
  assert(sharedUploadV1.status === 200, "admin shared upload should succeed")
  assert(sharedUploadV1.body.data.item.scope === "platform_shared", "admin upload should create platform_shared package")
  assert(sharedUploadV1.body.data.item.sourceLabel === "平台共享", "admin package should expose shared source label")

  const sharedPackageId = sharedUploadV1.body.data.item.id
  const sharedPackageUrl = sharedUploadV1.body.data.item.url
  await assertSkillAssetReachable(sharedPackageUrl, sharedSkillName)

  const sharedConfigAfterUpload = await getSkillConfig(adminJar)
  assert(
    sharedConfigAfterUpload.body.data.items.some((item) => item.type === "url" && item.value === sharedPackageUrl && item.source === "platform_shared"),
    "admin config should include shared package url item",
  )

  const sharedRename = await requestJson<ApiEnvelope<{ item: SkillPackageSummary }>>(adminJar, "/api/skill-package/rename", {
    method: "POST",
    body: {
      packageId: sharedPackageId,
      displayName: sharedRenamedDisplayName,
    },
  })
  assert(sharedRename.status === 200, "admin shared rename should succeed")

  const sharedZipV2 = await createSkillZip({
    skillName: sharedSkillName,
    description: "shared skill v2",
    extraFiles: {
      "notes.txt": "shared version 2",
    },
  })
  const sharedUploadV2 = await uploadSkill(adminJar, sharedZipV2, "shared-v2.zip")
  assert(sharedUploadV2.status === 200, "admin shared overwrite upload should succeed")
  assert(sharedUploadV2.body.data.item.id === sharedPackageId, "shared overwrite should keep package id")
  assert(sharedUploadV2.body.data.item.displayName === sharedRenamedDisplayName, "shared overwrite should preserve renamed display name")
  assert(sharedUploadV2.body.data.item.sourceFilename === "shared-v2.zip", "shared overwrite should refresh source filename")
  assert(sharedUploadV2.body.data.item.url === sharedPackageUrl, "shared overwrite should keep package url stable")
  await assertSkillAssetReachable(sharedPackageUrl, sharedSkillName)

  const developerConfigAfterShared = await getSkillConfig(developerJar)
  assert(
    developerConfigAfterShared.body.data.items.some((item) => item.type === "url" && item.value === sharedPackageUrl && item.source === "platform_shared"),
    "developer should inherit shared package url in config list",
  )

  const developerPackageListAfterShared = await getSkillPackageList(developerJar)
  assert(
    developerPackageListAfterShared.body.data.items.every((item) => item.scope !== "platform_shared"),
    "developer package management list should not show admin shared packages",
  )

  const privateZipV1 = await createSkillZip({
    skillName: privateSkillName,
    description: "private skill v1",
    extraFiles: {
      "notes.txt": "private version 1",
    },
  })
  const privateUploadV1 = await uploadSkill(developerJar, privateZipV1, "private-v1.zip")
  assert(privateUploadV1.status === 200, "developer private upload should succeed")
  assert(privateUploadV1.body.data.item.scope === "user_private", "developer upload should create user_private package")
  assert(privateUploadV1.body.data.item.sourceLabel === "用户私有", "developer package should expose private source label")

  const privatePackageId = privateUploadV1.body.data.item.id
  const privatePackageUrl = privateUploadV1.body.data.item.url
  await assertSkillAssetReachable(privatePackageUrl, privateSkillName)

  const privateRename = await requestJson<ApiEnvelope<{ item: SkillPackageSummary }>>(developerJar, "/api/skill-package/rename", {
    method: "POST",
    body: {
      packageId: privatePackageId,
      displayName: privateRenamedDisplayName,
    },
  })
  assert(privateRename.status === 200, "developer private rename should succeed")

  const privateZipV2 = await createSkillZip({
    skillName: privateSkillName,
    description: "private skill v2",
    extraFiles: {
      "notes.txt": "private version 2",
    },
  })
  const privateUploadV2 = await uploadSkill(developerJar, privateZipV2, "private-v2.zip")
  assert(privateUploadV2.status === 200, "developer private overwrite upload should succeed")
  assert(privateUploadV2.body.data.item.id === privatePackageId, "private overwrite should keep package id")
  assert(privateUploadV2.body.data.item.displayName === privateRenamedDisplayName, "private overwrite should preserve renamed display name")
  assert(privateUploadV2.body.data.item.sourceFilename === "private-v2.zip", "private overwrite should refresh source filename")
  assert(privateUploadV2.body.data.item.url === privatePackageUrl, "private overwrite should keep private package url stable")
  await assertSkillAssetReachable(privatePackageUrl, privateSkillName)

  const developerConfigAfterPrivate = await getSkillConfig(developerJar)
  assert(
    developerConfigAfterPrivate.body.data.items.some((item) => item.type === "url" && item.value === privatePackageUrl && item.source === "user_private"),
    "developer config should include private package url item",
  )

  const developerSecondaryConfigBeforeDelete = await getSkillConfig(developerSecondaryJar)
  assert(
    !developerSecondaryConfigBeforeDelete.body.data.items.some((item) => item.type === "url" && item.value === privatePackageUrl),
    "secondary developer should not inherit another developer private package url",
  )

  const removePrivateConfigItem = await requestJson<ApiEnvelope<{ success: boolean }>>(developerJar, "/api/skill-config/remove-item", {
    method: "POST",
    body: {
      type: "url",
      value: privatePackageUrl,
    },
  })
  assert(removePrivateConfigItem.status === 200, "developer should delete private config item")

  const developerConfigAfterItemDelete = await getSkillConfig(developerJar)
  assert(
    !developerConfigAfterItemDelete.body.data.items.some((item) => item.type === "url" && item.value === privatePackageUrl),
    "developer config should remove deleted private url item",
  )

  const developerPackageListAfterItemDelete = await getSkillPackageList(developerJar)
  assert(
    developerPackageListAfterItemDelete.body.data.items.some((item) => item.id === privatePackageId),
    "deleting config item should not delete uploaded package record",
  )

  const deletePrivatePackage = await requestJson<ApiEnvelope<{ success: boolean }>>(developerJar, "/api/skill-package/delete", {
    method: "POST",
    body: {
      packageId: privatePackageId,
    },
  })
  assert(deletePrivatePackage.status === 200, "developer should delete private package")

  const developerPackageListAfterDelete = await getSkillPackageList(developerJar)
  assert(
    !developerPackageListAfterDelete.body.data.items.some((item) => item.id === privatePackageId),
    "deleted private package should disappear from package list",
  )

  const developerConfigAfterPackageDelete = await getSkillConfig(developerJar)
  assert(
    !developerConfigAfterPackageDelete.body.data.items.some((item) => item.type === "url" && item.value === privatePackageUrl),
    "deleted private package url should stay absent from config list",
  )

  const deleteSharedPackage = await requestJson<ApiEnvelope<{ success: boolean }>>(adminJar, "/api/skill-package/delete", {
    method: "POST",
    body: {
      packageId: sharedPackageId,
    },
  })
  assert(deleteSharedPackage.status === 200, "admin should delete shared package")

  const adminConfigAfterSharedDelete = await getSkillConfig(adminJar)
  assert(
    !adminConfigAfterSharedDelete.body.data.items.some((item) => item.type === "url" && item.value === sharedPackageUrl),
    "shared package delete should remove shared url from admin config list",
  )

  const developerConfigAfterSharedDelete = await getSkillConfig(developerJar)
  assert(
    !developerConfigAfterSharedDelete.body.data.items.some((item) => item.type === "url" && item.value === sharedPackageUrl),
    "shared package delete should remove inherited shared url from developer config list",
  )

  console.log(
    JSON.stringify({
      ok: true,
      baseUrl,
      sharedSkillName,
      privateSkillName,
      sharedPackageId,
      privatePackageId,
      sharedPackageUrl,
      privatePackageUrl,
    }),
  )
} finally {
  await Promise.all(createdDirs.map((dir) => rm(dir, { recursive: true, force: true })))
}

async function login(jar: string[], username: string) {
  const response = await requestJson<ApiEnvelope<{ user: { id: string } }>>(jar, "/api/auth/login", {
    method: "POST",
    body: { username, password },
  })
  assert(response.status === 200, `${username} login failed`)
}

async function getSkillConfig(jar: string[]) {
  return requestJson<ApiEnvelope<{ paths: string[]; urls: string[]; items: SkillConfigItem[] }>>(jar, "/api/skill-config")
}

async function getSkillPackageList(jar: string[]) {
  return requestJson<ApiEnvelope<{ items: SkillPackageSummary[] }>>(jar, "/api/skill-package/list")
}

async function uploadSkill(jar: string[], zipPath: string, filename: string) {
  const body = new FormData()
  body.append("file", new File([await Bun.file(zipPath).arrayBuffer()], filename, { type: "application/zip" }))
  return requestForm<ApiEnvelope<{ item: SkillPackageSummary }>>(jar, "/api/skill-package/upload", {
    method: "POST",
    body,
  })
}

async function assertSkillAssetReachable(packageUrl: string, skillName: string) {
  const indexResponse = await fetch(packageUrl)
  assert(indexResponse.status === 200, `skill index should be reachable: ${packageUrl}`)
  const indexBody = await indexResponse.json() as { skills?: Array<{ name: string; files: string[] }> }
  assert(indexBody.skills?.some((item) => item.name === skillName), `skill index should contain ${skillName}`)

  const manifestResponse = await fetch(`${packageUrl}${skillName}`)
  assert(manifestResponse.status === 200, `skill manifest should be reachable: ${packageUrl}${skillName}`)
  const manifestText = await manifestResponse.text()
  assert(manifestText.includes(`name: ${skillName}`), `skill manifest should contain name frontmatter: ${skillName}`)
}

async function createSkillZip(input: {
  skillName: string
  description: string
  extraFiles?: Record<string, string>
}) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "runtime-shell-skill-"))
  createdDirs.push(tempDir)
  const skillDir = path.join(tempDir, input.skillName)
  await mkdir(skillDir, { recursive: true })
  await Bun.write(
    path.join(skillDir, "SKILL.md"),
    [
      "---",
      `name: ${input.skillName}`,
      `description: ${input.description}`,
      "---",
      "",
      `# ${input.skillName}`,
      "",
      input.description,
      "",
    ].join("\n"),
  )

  for (const [relativePath, content] of Object.entries(input.extraFiles ?? {})) {
    const absolutePath = path.join(skillDir, relativePath)
    await mkdir(path.dirname(absolutePath), { recursive: true })
    await Bun.write(absolutePath, content)
  }

  const zipPath = path.join(tempDir, `${input.skillName}.zip`)
  const command = [
    "Compress-Archive",
    "-LiteralPath",
    `'${skillDir.replace(/'/g, "''")}'`,
    "-DestinationPath",
    `'${zipPath.replace(/'/g, "''")}'`,
    "-Force",
  ].join(" ")
  const proc = Bun.spawn(["powershell", "-NoProfile", "-Command", command], {
    stdout: "ignore",
    stderr: "pipe",
  })
  const exitCode = await proc.exited
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text()
    throw new Error(`create zip failed: ${stderr}`)
  }
  return zipPath
}

async function requestJson<T>(
  jar: string[],
  requestPath: string,
  init: {
    method?: string
    body?: unknown
  } = {},
) {
  const response = await fetch(`${baseUrl}${requestPath}`, {
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

async function requestForm<T>(
  jar: string[],
  requestPath: string,
  init: {
    method?: string
    body: FormData
  },
) {
  const response = await fetch(`${baseUrl}${requestPath}`, {
    method: init.method || "POST",
    headers: jar.length ? { Cookie: jar.join("; ") } : undefined,
    body: init.body,
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
