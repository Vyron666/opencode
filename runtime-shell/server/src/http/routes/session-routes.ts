import type { Hono } from "hono"
import { registerAcpSessionRoutes } from "./acp-session-routes"
import { registerSessionCoreRoutes } from "./session-core-routes"
import { registerSessionSettingsRoutes } from "./session-settings-routes"
import { registerSkillPackageRoutes } from "./skill-package-routes"
import { registerWorkspaceRoutes } from "./workspace-routes"
import { registerWorkspaceShareRoutes } from "./workspace-share-routes"

export function registerSessionRoutes(app: Hono) {
  registerSessionCoreRoutes(app)
  registerAcpSessionRoutes(app)
  registerSessionSettingsRoutes(app)
  registerSkillPackageRoutes(app)
  registerWorkspaceRoutes(app)
  registerWorkspaceShareRoutes(app)
}
