import { createLogger } from "../log"
import { cleanupDockerWarmPool, closeDockerWarmPoolSlot, ensureDockerWarmPool, getDockerWarmPoolSnapshot } from "./sandbox/docker-sandbox-manager"
import { queryFailure, queryHeartbeat, queryLease, queryRuntime } from "./worker-agent-query"
import { createRuntimeHandlers } from "./worker-agent-runtime"

const log = createLogger("worker-agent")
const token = process.env.RUNTIME_SHELL_WORKER_AGENT_TOKEN || "change-me-worker-agent"
const port = Number(process.env.RUNTIME_SHELL_WORKER_AGENT_PORT || "4097")
const runtimeShellBaseUrl = (process.env.RUNTIME_SHELL_INTERNAL_BASE_URL || "http://runtime-shell:3000").replace(/\/+$/, "")
const runtimeHandlers = createRuntimeHandlers({
  runtimeShellBaseUrl,
  workerToken: token,
})

const server = Bun.serve({
  port,
  hostname: "0.0.0.0",
  idleTimeout: 120,
  fetch: async (request) => {
    try {
      if (!isAuthorized(request)) {
        return json({ message: "unauthorized" }, 401)
      }
      const url = new URL(request.url)
      if (request.method === "GET" && url.pathname === "/healthz") {
        return json({ success: true })
      }
      if (request.method === "GET" && url.pathname === "/runtime/query-runtime") {
        return json(queryRuntime(url))
      }
      if (request.method === "GET" && url.pathname === "/runtime/query-lease") {
        return json(queryLease(url))
      }
      if (request.method === "GET" && url.pathname === "/runtime/query-heartbeat") {
        return json(queryHeartbeat(url))
      }
      if (request.method === "GET" && url.pathname === "/runtime/query-warm-pool") {
        const workerId = url.searchParams.get("workerId") || undefined
        return json(getDockerWarmPoolSnapshot(workerId))
      }
      if (request.method === "GET" && url.pathname === "/runtime/query-failure") {
        return json(queryFailure(url))
      }
      if (request.method !== "POST") {
        return json({ message: "method not allowed" }, 405)
      }
      if (url.pathname === "/runtime/open-session") {
        return json(await runtimeHandlers.openSession(await request.json()))
      }
      if (url.pathname === "/runtime/load-session") {
        return json(await runtimeHandlers.loadSession(await request.json()))
      }
      if (url.pathname === "/runtime/resume-session") {
        return json(await runtimeHandlers.resumeSession(await request.json()))
      }
      if (url.pathname === "/runtime/fork-session") {
        return json(await runtimeHandlers.forkSession(await request.json()))
      }
      if (url.pathname === "/runtime/send-prompt") {
        return json(await runtimeHandlers.sendPrompt(await request.json()))
      }
      if (url.pathname === "/runtime/cancel-prompt") {
        await runtimeHandlers.cancelPrompt(await request.json())
        return json({ success: true })
      }
      if (url.pathname === "/runtime/close-session") {
        await runtimeHandlers.closeSession(await request.json())
        return json({ success: true })
      }
      if (url.pathname === "/runtime/pool/ensure") {
        const body = await request.json() as Record<string, unknown>
        const workerId = typeof body.workerId === "string" ? body.workerId : ""
        const target = typeof body.target === "number" ? body.target : Number(body.target || 0)
        return json(await ensureDockerWarmPool({
          workerId,
          target: Number.isFinite(target) && target >= 0 ? target : 0,
        }))
      }
      if (url.pathname === "/runtime/pool/close-slot") {
        const body = await request.json() as Record<string, unknown>
        return json(await closeDockerWarmPoolSlot({
          workerId: typeof body.workerId === "string" ? body.workerId : "",
          slotId: typeof body.slotId === "string" ? body.slotId : "",
        }))
      }
      if (url.pathname === "/runtime/pool/cleanup") {
        const body = await request.json() as Record<string, unknown>
        return json(await cleanupDockerWarmPool({
          workerId: typeof body.workerId === "string" ? body.workerId : undefined,
          recycleReady: body.recycleReady === true,
        }))
      }
      if (url.pathname === "/runtime/set-mode") {
        return json(await runtimeHandlers.setMode(await request.json()))
      }
      if (url.pathname === "/runtime/set-model") {
        return json(await runtimeHandlers.setModel(await request.json()))
      }
      if (url.pathname === "/runtime/set-config") {
        return json(await runtimeHandlers.setConfig(await request.json()))
      }
      if (url.pathname === "/runtime/resolve-permission") {
        await runtimeHandlers.resolvePermission(await request.json())
        return json({ success: true })
      }
      if (url.pathname === "/runtime/resolve-question") {
        await runtimeHandlers.resolveQuestion(await request.json())
        return json({ success: true })
      }
      return json({ message: "not found" }, 404)
    } catch (error) {
      const message = describeError(error)
      log.warn("worker agent request failed", { message })
      return json({ message }, 500)
    }
  },
})

log.info("worker agent started", { port, runtimeShellBaseUrl })
registerGracefulShutdown()

function isAuthorized(request: Request) {
  return request.headers.get("x-runtime-worker-token") === token
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  })
}

function describeError(error: unknown) {
  if (!(error instanceof Error)) return String(error)
  const detail = error as Error & {
    cause?: unknown
  }
  if (detail.cause === undefined) return detail.message
  try {
    return `${detail.message} | cause=${JSON.stringify(detail.cause)}`
  } catch {
    return `${detail.message} | cause=${String(detail.cause)}`
  }
}

function registerGracefulShutdown() {
  let shutdownPromise: Promise<void> | undefined
  const shutdown = (signal: string) => {
    if (shutdownPromise) return
    shutdownPromise = (async () => {
      log.info("worker agent shutting down", { signal })
      try {
        // 中文/English: warm slots are pure acceleration state, so reclaim them on
        // process exit to avoid leaking detached containers after compose down/restart.
        await cleanupDockerWarmPool({
          recycleReady: true,
        })
      } catch (error) {
        log.warn("worker agent warm pool cleanup failed", {
          signal,
          message: error instanceof Error ? error.message : String(error),
        })
      }
      server.stop(true)
      process.exit(0)
    })()
  }
  process.on("SIGINT", () => shutdown("SIGINT"))
  process.on("SIGTERM", () => shutdown("SIGTERM"))
}
