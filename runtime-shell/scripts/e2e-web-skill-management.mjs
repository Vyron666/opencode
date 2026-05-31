import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { spawn } from "node:child_process"

const baseUrl = process.env.RUNTIME_SHELL_WEB_BASE_URL || "http://127.0.0.1:3100"
const adminUsername = process.env.RUNTIME_SHELL_WEB_ADMIN_USERNAME || "admin"
const adminPassword = process.env.RUNTIME_SHELL_WEB_ADMIN_PASSWORD || "change-me"
const developerUsername = process.env.RUNTIME_SHELL_WEB_DEVELOPER_USERNAME || "developer"
const developerPassword = process.env.RUNTIME_SHELL_WEB_DEVELOPER_PASSWORD || "change-me"

const { chromium } = await import("playwright")

const timestamp = Date.now()
const sharedSkillName = `web-shared-skill-${timestamp}`
const renamedDisplayName = `网页共享技能-${timestamp}`
let tempDir = ""

const result = {
  ok: false,
  baseUrl,
  sharedSkillName,
  renamedDisplayName,
  assertions: {},
}

const browser = await chromium.launch({ headless: false, slowMo: 50 })
const adminContext = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
const developerContext = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
const adminPage = await adminContext.newPage()
const developerPage = await developerContext.newPage()

try {
  const zipPathV1 = await createSkillZip({
    skillName: sharedSkillName,
    description: "web shared skill v1",
    archiveSuffix: "v1",
  })
  const zipPathV2 = await createSkillZip({
    skillName: sharedSkillName,
    description: "web shared skill v2",
    archiveSuffix: "v2",
  })

  await login(adminPage, adminUsername, adminPassword)
  await openSkillPanel(adminPage, "平台 Skill 配置")

  result.assertions.adminSeesPackageManagement = await adminPage.getByText("包管理").isVisible()
  result.assertions.adminSeesConfigManagement = await adminPage.getByText("配置管理").isVisible()
  assert(result.assertions.adminSeesPackageManagement, "admin should see 包管理")
  assert(result.assertions.adminSeesConfigManagement, "admin should see 配置管理")

  await uploadSkillZip(adminPage, zipPathV1)
  await expectText(adminPage, "Skill 压缩包已上传，并已自动写入 Skill URLs；同 scope + 同 skillName 会自动覆盖")
  await expectText(adminPage, sharedSkillName)
  await expectText(adminPage, "平台共享")
  result.assertions.adminUploadVisible = true

  const renameInput = adminPage.getByPlaceholder("Skill 展示名").first()
  await renameInput.fill(renamedDisplayName)
  await adminPage.getByRole("button", { name: "重命名", exact: true }).first().click()
  await expectText(adminPage, "Skill 包展示名已更新")
  await expectText(adminPage, renamedDisplayName)
  result.assertions.adminRenameVisible = true

  const configCard = adminPage.locator("div").filter({ hasText: "当前已配置的 Skill 条目" }).last()
  await configCard.getByRole("button", { name: "删除该配置项", exact: true }).first().click()
  await expectText(adminPage, "Skill 配置项已删除")
  result.assertions.adminConfigItemDeleteWorks = true

  await uploadSkillZip(adminPage, zipPathV2)
  await expectText(adminPage, "Skill 压缩包已上传，并已自动写入 Skill URLs；同 scope + 同 skillName 会自动覆盖")
  await expectText(adminPage, renamedDisplayName)
  result.assertions.adminOverwritePreservesDisplayName = true

  await login(developerPage, developerUsername, developerPassword)
  await openSkillPanel(developerPage, "我的 Skill 配置")
  await expectText(developerPage, "配置管理")
  await expectText(developerPage, "平台共享")
  await expectText(developerPage, "继承自平台共享，当前账号不可删除")
  result.assertions.developerSeesInheritedSharedConfig = true

  const developerBody = await developerPage.locator("body").innerText()
  result.assertions.developerDoesNotSeeSharedPackageInPackageManagement = !developerBody.includes(renamedDisplayName)
  assert(
    result.assertions.developerDoesNotSeeSharedPackageInPackageManagement,
    "developer package management should not list shared package",
  )

  await adminPage.getByRole("button", { name: "删除", exact: true }).first().click()
  await expectText(adminPage, "Skill 包已删除，并已从当前作用域配置中移除")
  result.assertions.adminPackageDeleteWorks = true

  result.ok = true
} finally {
  console.log(JSON.stringify(result, null, 2))
  await adminContext.close()
  await developerContext.close()
  await browser.close()
  if (tempDir) {
    await fs.rm(tempDir, { recursive: true, force: true })
  }
}

async function login(page, username, password) {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 20000 })
  const form = page.locator("form").first()
  await form.locator("input").nth(0).fill(username)
  await form.locator("input").nth(1).fill(password)
  await form.locator('button[type="submit"]').click()
  await page.waitForLoadState("networkidle")
  await page.waitForTimeout(1200)
}

async function openSkillPanel(page, titleText) {
  await page.locator("button").filter({ hasText: /设置/ }).last().click()
  await expectText(page, titleText)
  await page.getByRole("button", { name: "展开", exact: true }).nth(2).click()
  await expectText(page, "包管理")
  await expectText(page, "配置管理")
  await page.getByRole("button", { name: "上传并安装 Skill", exact: true }).first().waitFor({ state: "visible", timeout: 15000 })
}

async function uploadSkillZip(page, zipPath) {
  const input = page.locator('input[type="file"][accept=".zip,application/zip"]').first()
  const button = page.getByRole("button", { name: "上传并安装 Skill", exact: true }).first()
  await input.waitFor({ state: "attached", timeout: 15000 })
  await button.waitFor({ state: "visible", timeout: 15000 })
  await waitFor(async () => !(await button.isEnabled()), "upload button should reset to disabled before selecting a file")
  await input.setInputFiles([])
  await waitFor(async () => (await input.evaluate((node) => node.files?.length ?? 0)) === 0, "file input should clear")
  // 中文/English: reacquire the visible upload controls each time so overwrite upload follows the same UI path as a user.
  await input.setInputFiles(zipPath)
  await waitFor(async () => (await input.evaluate((node) => node.files?.length ?? 0)) === 1, "file input should receive the selected zip")
  await waitFor(async () => await button.isEnabled(), "upload button should become enabled")
  await button.click()
  await waitFor(async () => !(await button.isEnabled()), "upload button should become disabled after submit")
}

async function expectText(page, text, timeoutMs = 15000) {
  const locator = page.getByText(text, { exact: false }).first()
  await locator.waitFor({ state: "visible", timeout: timeoutMs })
}

async function createSkillZip(input) {
  if (!tempDir) {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "runtime-shell-web-skill-"))
  }
  const skillDir = path.join(tempDir, `${input.skillName}-${input.archiveSuffix}`)
  const packageDir = path.join(skillDir, input.skillName)
  await fs.mkdir(packageDir, { recursive: true })
  await fs.writeFile(
    path.join(packageDir, "SKILL.md"),
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
    "utf8",
  )
  await fs.writeFile(path.join(packageDir, "notes.txt"), input.description, "utf8")

  const zipPath = path.join(tempDir, `${input.skillName}-${input.archiveSuffix}.zip`)
  const command = [
    "Compress-Archive",
    "-LiteralPath",
    `'${packageDir.replace(/'/g, "''")}'`,
    "-DestinationPath",
    `'${zipPath.replace(/'/g, "''")}'`,
    "-Force",
  ].join(" ")
  const proc = spawn("powershell", ["-NoProfile", "-Command", command], {
    stdio: ["ignore", "ignore", "pipe"],
  })
  const stderrChunks = []
  proc.stderr.on("data", (chunk) => {
    stderrChunks.push(chunk)
  })
  const exitCode = await new Promise((resolve, reject) => {
    proc.on("error", reject)
    proc.on("close", resolve)
  })
  if (exitCode !== 0) {
    throw new Error(Buffer.concat(stderrChunks).toString("utf8"))
  }
  return zipPath
}

async function waitFor(check, message, timeoutMs = 15000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(message)
}

function assert(condition, message) {
  if (condition) return
  throw new Error(message)
}
