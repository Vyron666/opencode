import type { Hono } from "hono"
import { registerAcpSessionRoutes } from "./acp-session-routes"
import { registerSessionCoreRoutes } from "./session-core-routes"
import { registerSessionSettingsRoutes } from "./session-settings-routes"

export function registerSessionRoutes(app: Hono) {
  registerSessionCoreRoutes(app)
  registerAcpSessionRoutes(app)
  registerSessionSettingsRoutes(app)
}
