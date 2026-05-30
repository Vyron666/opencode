import { createLogger } from "../log"
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

Bun.serve({
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
      const message = error instanceof Error ? error.message : String(error)
      log.warn("worker agent request failed", { message })
      return json({ message }, 500)
    }
  },
})

log.info("worker agent started", { port, runtimeShellBaseUrl })

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
