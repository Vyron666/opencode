import path from "node:path"
import { type ParseError, applyEdits, modify, parse } from "jsonc-parser"

const CONFIG_FILE_CANDIDATES = ["opencode.jsonc", "opencode.json", "config.json"]
const DEFAULT_RUNTIME_CONFIG = '{\n  "$schema": "https://opencode.ai/config.json"\n}\n'
const CONFIG_TEMPLATE_FILE = path.resolve(process.cwd(), "./config/opencode.example.jsonc")
const DEFAULT_WORKSPACE_ROOT = path.resolve(import.meta.dir, "../../..")

export type RuntimeShellProviderModel = {
  id: string
  name: string
  // 中文/English: user-facing "model api" means the upstream provider model id.
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

export type RuntimeShellStoredProviderConfig = RuntimeShellProviderConfig & {
  // 中文/English: persisted only for runtime injection, never returned to the client.
  apiKey?: string
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
  const builtin = await listStoredProviderConfigs()
  return builtin.map((item) => toVisibleProviderConfig(item))
}

export async function listStoredProviderConfigs() {
  const text = await readBuiltinProviderConfigText()
  return parseProviderConfigs(text)
}

export async function saveProviderConfig(input: SaveProviderInput) {
  const filePath = await resolveRuntimeConfigFile()
  const text = await readRuntimeConfigText(filePath)
  const config = parseRuntimeConfig(text)
  const currentProvider = isRecord(config.provider?.[input.providerId]) ? config.provider?.[input.providerId] : {}
  const currentOptions = isRecord(currentProvider?.options) ? currentProvider.options : {}
  const nextBaseUrl = input.baseURL.trim()
  const nextAdapter = (input.npm?.trim() || input.api.trim())

  const nextApiKey =
    typeof input.apiKey === "string" && input.apiKey.trim()
      ? input.apiKey.trim()
      : typeof currentOptions.apiKey === "string"
        ? currentOptions.apiKey
        : ""

  const nextProvider = {
    ...currentProvider,
    name: input.name.trim() || input.providerId,
    // 中文/English: opencode config uses `provider.npm` for the SDK adapter and
    // `provider.api` / `options.baseURL` for the actual upstream endpoint.
    api: nextBaseUrl,
    ...(nextAdapter ? { npm: nextAdapter } : { npm: undefined }),
    options: {
      ...currentOptions,
      baseURL: nextBaseUrl,
      ...(nextApiKey ? { apiKey: nextApiKey } : { apiKey: undefined }),
    },
    models: Object.fromEntries(
      input.models
        .filter((item) => item.id.trim())
        .map((item) => [
          item.id.trim(),
          {
            name: item.name.trim() || item.id.trim(),
            ...(item.api?.trim() ? { id: item.api.trim() } : {}),
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
  // 中文/English: use plain ASCII so masking is stable across terminals and encodings.
  if (secret.length <= 8) return "********"
  return `${secret.slice(0, 4)}****${secret.slice(-4)}`
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

async function readBuiltinProviderConfigText() {
  const template = Bun.file(CONFIG_TEMPLATE_FILE)
  if (!(await template.exists())) return DEFAULT_RUNTIME_CONFIG
  return template.text()
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
  const errors: ParseError[] = []
  const parsed = parse(text, errors)
  if (errors.length > 0 || !isRecord(parsed)) {
    return { $schema: "https://opencode.ai/config.json" }
  }
  return parsed as WritableConfig
}

function parseProviderConfigs(text: string) {
  const config = parseRuntimeConfig(text)
  const providerEntries = Object.entries(config.provider || {})
  const enabled = Array.isArray(config.enabled_providers) ? config.enabled_providers : []

  return providerEntries.map(([providerId, raw]) => {
    const options = isRecord(raw.options) ? raw.options : {}
    const models = isRecord(raw.models) ? raw.models : {}
    const apiKey = typeof options.apiKey === "string" ? options.apiKey : ""
    const baseURL = readProviderBaseUrl(raw, options)
    const adapter = readProviderAdapter(raw)
    const defaultModel = typeof config.model === "string" && config.model.startsWith(`${providerId}/`)
      ? config.model
      : enabled.includes(providerId) && Object.keys(models)[0]
        ? `${providerId}/${Object.keys(models)[0]}`
        : ""

    const npm = typeof raw.npm === "string" && raw.npm.trim() ? raw.npm.trim() : undefined
    return {
      providerId,
      name: typeof raw.name === "string" ? raw.name : providerId,
      ...(npm ? { npm } : {}),
      api: adapter,
      baseURL,
      apiKeyMasked: maskSecret(apiKey),
      apiKeyConfigured: Boolean(apiKey),
      ...(apiKey ? { apiKey } : {}),
      defaultModel,
      models: Object.entries(models)
        .map(([modelId, modelRaw]) => ({
          id: modelId,
          name: isRecord(modelRaw) && typeof modelRaw.name === "string" ? modelRaw.name : modelId,
          api: readProviderModelApiId(modelRaw),
        }))
        .sort((left, right) => left.name.localeCompare(right.name)),
    } satisfies RuntimeShellStoredProviderConfig
  })
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

function toVisibleProviderConfig(value: RuntimeShellStoredProviderConfig): RuntimeShellProviderConfig {
  return {
    providerId: value.providerId,
    name: value.name,
    ...(value.npm ? { npm: value.npm } : {}),
    api: value.api,
    baseURL: value.baseURL,
    apiKeyMasked: value.apiKeyMasked,
    apiKeyConfigured: value.apiKeyConfigured,
    defaultModel: value.defaultModel,
    models: value.models,
  }
}

function readProviderAdapter(raw: Record<string, unknown>) {
  if (typeof raw.npm === "string" && raw.npm.trim()) return raw.npm.trim()
  if (typeof raw.api === "string" && !looksLikeUrl(raw.api)) return raw.api.trim()
  return ""
}

function readProviderBaseUrl(raw: Record<string, unknown>, options: Record<string, unknown>) {
  if (typeof options.baseURL === "string" && options.baseURL.trim()) return options.baseURL.trim()
  if (typeof raw.api === "string" && looksLikeUrl(raw.api)) return raw.api.trim()
  return ""
}

function readProviderModelApiId(value: unknown) {
  if (!isRecord(value)) return undefined
  if (typeof value.id === "string" && value.id.trim()) return value.id.trim()
  if (typeof value.api === "string" && value.api.trim()) return value.api.trim()
  return undefined
}

function looksLikeUrl(value: string) {
  return value.includes("://")
}
