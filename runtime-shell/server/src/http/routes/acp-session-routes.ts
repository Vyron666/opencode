import type { Hono } from "hono"
import { registerAcpSessionRecoveryRoutes } from "./acp-session-recovery-routes"
import { registerAcpSessionRuntimeRoutes } from "./acp-session-runtime-routes"
import { registerAcpSessionSettingsRoutes } from "./acp-session-settings-routes"

export function registerAcpSessionRoutes(app: Hono) {
  registerAcpSessionRecoveryRoutes(app)
  registerAcpSessionRuntimeRoutes(app)
  registerAcpSessionSettingsRoutes(app)
}
