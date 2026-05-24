import { Config } from "./config"

function authHeader() {
  if (!Config.opencodePassword) return undefined
  const token = Buffer.from(`${Config.opencodeUsername}:${Config.opencodePassword}`).toString("base64")
  return { Authorization: `Basic ${token}` }
}

export async function getOpencodeHealth() {
  // 中文/English: healthz endpoint is protected when basic auth is enabled.
  // Using / keeps us aligned with opencode server auth expectations.
  const response = await fetch(`${Config.opencodeBaseUrl}/`, {
    headers: authHeader(),
  }).catch(() => undefined)

  if (!response) return { healthy: false, message: "unreachable" }
  if (!response.ok) return { healthy: false, message: `http_${response.status}` }
  return { healthy: true, message: "ok" }
}
