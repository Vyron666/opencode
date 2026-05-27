import type { Hono } from "hono"
import { getHealthOverview, getWorkerOverviewForUser } from "../../services/system/system-service"
import { jsonOk, requestId } from "../response"
import { requireUser, unauthorized } from "../auth-helpers"

export function registerSystemRoutes(app: Hono) {
  app.get("/healthz", async (c) => {
    const reqId = requestId(c)
    return c.json(jsonOk(await getHealthOverview(), reqId))
  })

  app.get("/api/worker/list", async (c) => {
    const reqId = requestId(c)
    const user = await requireUser(c)
    if (!user) return unauthorized(c)
    return c.json(jsonOk(await getWorkerOverviewForUser(user), reqId))
  })
}
