import path from "node:path"
import { applyEdits, modify, parse } from "jsonc-parser"

const CONFIG_FILE_CANDIDATES = ["opencode.jsonc", "opencode.json", "config.json"]
const DEFAULT_RUNTIME_CONFIG = '{\n  "$schema": "https://opencode.ai/config.json"\n}\n'
const CONFIG_TEMPLATE_FILE = path.resolve(process.cwd(), "./config/opencode.example.jsonc")
const DEFAULT_WORKSPACE_ROOT = path.resolve(import.meta.dir, "../../..")

export type RuntimeShellProviderModel = {
  id: string
  name: string
  api?: string
}

export type RuntimeShellProviderConfig = {
  providerId: string
  name: string
  npm?: string
  api: string
  baseURL: string
  apiKeyMasked: string
  apiKeyConfigured: boolean
  defaultModel: string
  models: RuntimeShellProviderModel[]
}

type WritableConfig = {
  $schema?: string
  model?: string
  enabled_providers?: string[]
  provider?: Record<string, Record<string, unknown>>
  [key: string]: unknown
}

type SaveProviderInput = {
  providerId: string
  name: string
  npm?: string
  api: string
  baseURL: string
  apiKey?: string
  defaultModel: string
  models: RuntimeShellProviderModel[]
}

export async function listProviderConfigs() {
  const config = await readRuntimeConfig()
  const providerEntries = Object.entries(config.provider || {})
  const enabled = Array.isArray(config.enabled_providers) ? config.enabled_providers : []

  return providerEntries.map(([providerId, raw]) => {
    const options = isRecord(raw.options) ? raw.options : {}
    const models = isRecord(raw.models) ? raw.models : {}
    const apiKey = typeof options.apiKey === "string" ? options.apiKey : ""
    const defaultModel = typeof config.model === "string" && config.model.startsWith(`${providerId}/`)
      ? config.model
      : enabled.includes(providerId) && Object.keys(models)[0]
        ? `${providerId}/${Object.keys(models)[0]}`
        : ""

    return {
      providerId,
      name: typeof raw.name === "string" ? raw.name : providerId,
      npm: typeof raw.npm === "string" ? raw.npm : undefined,
      api: typeof raw.api === "string" ? raw.api : "",
      baseURL: typeof options.baseURL === "string" ? options.baseURL : "",
      apiKeyMasked: maskSecret(apiKey),
      apiKeyConfigured: Boolean(apiKey),
      defaultModel,
      models: Object.entries(models)
        .map(([modelId, modelRaw]) => ({
          id: modelId,
          name: isRecord(modelRaw) && typeof modelRaw.name === "string" ? modelRaw.name : modelId,
          api: isRecord(modelRaw) && typeof modelRaw.api === "string" ? modelRaw.api : undefined,
        }))
        .sort((left, right) => left.name.localeCompare(right.name)),
    } satisfies RuntimeShellProviderConfig
  })
}

export async function saveProviderConfig(input: SaveProviderInput) {
  const filePath = await resolveRuntimeConfigFile()
  const text = await readRuntimeConfigText(filePath)
  const config = parseRuntimeConfig(text)
  const currentProvider = isRecord(config.provider?.[input.providerId]) ? config.provider?.[input.providerId] : {}
  const currentOptions = isRecord(currentProvider?.options) ? currentProvider.options : {}

  const nextApiKey =
    typeof input.apiKey === "string" && input.apiKey.trim()
      ? input.apiKey.trim()
      : typeof currentOptions.apiKey === "string"
        ? currentOptions.apiKey
        : ""

  const nextProvider = {
    ...currentProvider,
    name: input.name.trim() || input.providerId,
    api: input.api.trim(),
    ...(input.npm?.trim() ? { npm: input.npm.trim() } : { npm: undefined }),
    options: {
      ...currentOptions,
      baseURL: input.baseURL.trim(),
      ...(nextApiKey ? { apiKey: nextApiKey } : { apiKey: undefined }),
    },
    models: Object.fromEntries(
      input.models
        .filter((item) => item.id.trim())
        .map((item) => [
          item.id.trim(),
          {
            name: item.name.trim() || item.id.trim(),
            ...(item.api?.trim() ? { api: item.api.trim() } : {}),
          },
        ]),
    ),
  }

  const enabledProviders = new Set(Array.isArray(config.enabled_providers) ? config.enabled_providers : [])
  enabledProviders.add(input.providerId)

  const nextConfig = {
    $schema: config.$schema || "https://opencode.ai/config.json",
    provider: {
      ...(config.provider || {}),
      [input.providerId]: nextProvider,
    },
    enabled_providers: [...enabledProviders].sort(),
    model: input.defaultModel.trim(),
  } satisfies WritableConfig

  // 中文/English: patch JSONC in place so existing comments and unrelated keys stay intact.
  const nextText = patchJsonc(text, nextConfig)
  await Bun.write(filePath, nextText)
  return {
    filePath,
    providerId: input.providerId,
  }
}

export async function ensureRuntimeConfigInitialized() {
  const configDir = runtimeConfigDir()
  for (const fileName of CONFIG_FILE_CANDIDATES) {
    const filePath = path.join(configDir, fileName)
    if (await Bun.file(filePath).exists()) return filePath
  }

  await Bun.write(path.join(configDir, ".gitkeep"), "")

  const target = path.join(configDir, "opencode.jsonc")
  const template = Bun.file(CONFIG_TEMPLATE_FILE)
  const text = (await template.exists()) ? await template.text() : DEFAULT_RUNTIME_CONFIG
  // 中文/English: initialize a writable runtime config so fresh Docker clones can be configured from the web UI.
  await Bun.write(target, text)
  return target
}

function maskSecret(secret: string) {
  if (!secret) return ""
  if (secret.length <= 8) return "••••••••"
  return `${secret.slice(0, 4)}••••${secret.slice(-4)}`
}

async function resolveRuntimeConfigFile() {
  const configDir = runtimeConfigDir()
  for (const fileName of CONFIG_FILE_CANDIDATES) {
    const filePath = path.join(configDir, fileName)
    if (await Bun.file(filePath).exists()) return filePath
  }
  return path.join(configDir, "opencode.jsonc")
}

function runtimeConfigDir() {
  // 中文/English: runtime-shell must write the provider config to the same `.opencode`
  // directory that the spawned ACP process actually discovers from its workspace root.
  return path.join(process.env.OPENCODE_ACP_SPAWN_CWD || DEFAULT_WORKSPACE_ROOT, ".opencode")
}

async function readRuntimeConfig() {
  const filePath = await resolveRuntimeConfigFile()
  const text = await readRuntimeConfigText(filePath)
  return parseRuntimeConfig(text)
}

async function readRuntimeConfigText(filePath: string) {
  const file = Bun.file(filePath)
  if (!(await file.exists())) {
    return DEFAULT_RUNTIME_CONFIG
  }
  return await file.text()
}

function parseRuntimeConfig(text: string): WritableConfig {
  if (!text.trim()) {
    return {
      $schema: "https://opencode.ai/config.json",
    }
  }

  try {
    const parsed = parse(text)
    return isRecord(parsed) ? (parsed as WritableConfig) : { $schema: "https://opencode.ai/config.json" }
  } catch {
    return { $schema: "https://opencode.ai/config.json" }
  }
}

function patchJsonc(input: string, patch: unknown, currentPath: string[] = []): string {
  if (!isRecord(patch)) {
    const edits = modify(input, currentPath, patch, {
      formattingOptions: {
        insertSpaces: true,
        tabSize: 2,
      },
    })
    return applyEdits(input, edits)
  }

  return Object.entries(patch).reduce(
    (result, [key, value]) => patchJsonc(result, value, [...currentPath, key]),
    input.trim() ? input : DEFAULT_RUNTIME_CONFIG,
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
