import { computeRuntimeConfigFingerprint } from "../../runtime/runtime-config-content"

const WARM_RUNTIME_DEMAND_TTL_MS = 30 * 60 * 1000
const warmRuntimeDemand = new Map<string, {
  configContent?: string
  hitCount: number
  lastUsedAt: number
}>()

export function rememberWarmRuntimeDemand(configContent?: string) {
  const configFingerprint = computeRuntimeConfigFingerprint(configContent)
  const now = Date.now()
  warmRuntimeDemand.set(configFingerprint, {
    configContent,
    hitCount: (warmRuntimeDemand.get(configFingerprint)?.hitCount ?? 0) + 1,
    lastUsedAt: now,
  })
  pruneExpiredWarmRuntimeDemand(now)
}

export function listWarmRuntimeDemandBuckets(limit = 8) {
  pruneExpiredWarmRuntimeDemand(Date.now())
  return [...warmRuntimeDemand.entries()]
    .map(([configFingerprint, bucket]) => ({
      configFingerprint,
      configContent: bucket.configContent,
      hitCount: bucket.hitCount,
      lastUsedAt: bucket.lastUsedAt,
    }))
    .sort((left, right) =>
      right.hitCount - left.hitCount || right.lastUsedAt - left.lastUsedAt,
    )
    .slice(0, Math.max(0, limit))
    .map(({ configFingerprint, configContent, lastUsedAt }) => ({
      configFingerprint,
      configContent,
      lastUsedAt,
    }))
}

function pruneExpiredWarmRuntimeDemand(now: number) {
  for (const [configFingerprint, bucket] of warmRuntimeDemand.entries()) {
    if (now - bucket.lastUsedAt <= WARM_RUNTIME_DEMAND_TTL_MS) continue
    warmRuntimeDemand.delete(configFingerprint)
  }
}
