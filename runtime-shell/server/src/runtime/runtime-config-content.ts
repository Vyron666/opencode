import { createHash } from "node:crypto"

function toStableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => toStableJsonValue(item))
  }
  if (!value || typeof value !== "object") {
    return value
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nextValue]) => [key, toStableJsonValue(nextValue)]),
  )
}

export function stableStringifyRuntimeConfig(value: unknown) {
  return JSON.stringify(toStableJsonValue(value))
}

export function buildRuntimeConfigContent(value: unknown) {
  return stableStringifyRuntimeConfig(value)
}

export function buildRuntimeConfigContext(configContent?: string) {
  return {
    configContent,
    configFingerprint: computeRuntimeConfigFingerprint(configContent),
  }
}

export function normalizeRuntimeConfigContent(configContent?: string) {
  if (!configContent) return ""
  try {
    // 中文/English: warm runtime reuse must hash the semantic config shape,
    // not an unstable object-key order produced by repeated JSON serialization.
    return stableStringifyRuntimeConfig(JSON.parse(configContent))
  } catch {
    return configContent
  }
}

export function computeRuntimeConfigFingerprint(configContent?: string) {
  return createHash("sha256").update(normalizeRuntimeConfigContent(configContent)).digest("hex").slice(0, 24)
}
