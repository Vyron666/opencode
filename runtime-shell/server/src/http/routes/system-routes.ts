import type { Hono } from "hono"
import { getOpencodeHealth } from "../../opencode"
import { store } from "../../store"
import { jsonOk, requestId } from "../response"
import { requireUser, unauthorized } from "../auth-helpers"

export function registerSystemRoutes(app: Hono) {
  app.get("/healthz", async (c) => {
    const reqId = requestId(c)
    const health = await getOpencodeHealth()
    return c.json(jsonOk({ status: "ok", opencode: health }, reqId))
  })

  app.get("/api/worker/list", async (c) => {
    const reqId = requestId(c)
    const user = requireUser(c)
    if (!user) return unauthorized(c)
    const workers = store.listWorkers()
    const opencode = await getOpencodeHealth()
    const first = workers[0]
    if (first) {
      await store.touchWorker(first.id, {
        status: opencode.healthy ? "ready" : "offline",
      })
    }
    return c.json(
      jsonOk(
        {
          items: store.listWorkers(),
          opencode,
        },
        reqId,
      ),
    )
  })
}
