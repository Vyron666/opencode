import { Config } from "./config"

function authHeader() {
  if (!Config.opencodePassword) return undefined
  const token = Buffer.from(`${Config.opencodeUsername}:${Config.opencodePassword}`).toString("base64")
  return { Authorization: `Basic ${token}` }
}

export async function getOpencodeHealth() {
  if (Config.workerExecutionMode === "remote" && Config.localWorkers.length > 0) {
    const workerUrls = [...new Set(
      Config.localWorkers
        .map((worker) => worker.agentBaseUrl || worker.baseUrl)
        .filter(Boolean),
    )]
    const results = await Promise.all(workerUrls.map(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/healthz`, {
        headers: {
          "x-runtime-worker-token": Config.workerAgentToken,
        },
      }).catch(() => undefined)
      if (!response) return { baseUrl, healthy: false, message: "unreachable" }
      if (!response.ok) return { baseUrl, healthy: false, message: `http_${response.status}` }
      return { baseUrl, healthy: true, message: "ok" }
    }))
    const failed = results.find((item) => !item.healthy)
    if (failed) return { healthy: false, message: `${failed.message}@${failed.baseUrl}` }
    return { healthy: true, message: "ok" }
  }
  // 中文/English: local mode still probes the legacy opencode HTTP server entry.
  const response = await fetch(`${Config.opencodeBaseUrl}/`, {
    headers: authHeader(),
  }).catch(() => undefined)
  if (!response) return { healthy: false, message: "unreachable" }
  if (!response.ok) return { healthy: false, message: `http_${response.status}` }
  return { healthy: true, message: "ok" }
}
