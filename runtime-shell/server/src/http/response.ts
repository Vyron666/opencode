import type { Context } from "hono"

export function requestId(c: Context) {
  return c.req.header("x-request-id") || `req_${crypto.randomUUID().replace(/-/g, "")}`
}

export function jsonOk(data: unknown, reqId: string) {
  return {
    code: 0,
    message: "ok",
    data,
    requestId: reqId,
  }
}

export function jsonError(message: string, code: number, reqId: string, details?: unknown) {
  return {
    code,
    message,
    data: null,
    requestId: reqId,
    ...(details === undefined ? {} : { details }),
  }
}
