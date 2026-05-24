import { Hono } from "hono"
import { Config } from "./config"
import { createLogger } from "./log"
import { ensureRuntimeConfigInitialized } from "./provider-config"
import { store } from "./store"
import { registerStaticRoutes } from "./http/routes/static-routes"
import { registerAuthRoutes } from "./http/routes/auth-routes"
import { registerSystemRoutes } from "./http/routes/system-routes"
import { registerSessionRoutes } from "./http/routes/session-routes"
import { registerInteractionRoutes } from "./http/routes/interaction-routes"

const log = createLogger("http")
const app = new Hono()

registerStaticRoutes(app)
registerAuthRoutes(app)
registerSystemRoutes(app)
registerSessionRoutes(app)
registerInteractionRoutes(app)

await store.load()
await ensureRuntimeConfigInitialized()

log.info("server started", { host: Config.host, port: Config.port })

export default {
  port: Config.port,
  hostname: Config.host,
  // 中文/English: Bun.serve has a default idle timeout (~10s). Use a larger value so SSE doesn't drop.
  idleTimeout: 120,
  fetch: app.fetch,
}
