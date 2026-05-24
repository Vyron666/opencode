import type { Hono } from "hono"
import { page } from "../static-pages"

export function registerStaticRoutes(app: Hono) {
  app.get("/", () => page("index.html"))
  app.get("/assets/*", async (c) => {
    const file = c.req.path.replace(/^\//, "")
    return (await page(file)) || c.notFound()
  })
  app.get("/src/*", async (c) => {
    const file = c.req.path.replace(/^\//, "")
    return (await page(file)) || c.notFound()
  })
}
