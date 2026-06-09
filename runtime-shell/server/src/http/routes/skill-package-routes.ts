import type { Hono } from "hono"
import { requireUser, unauthorized } from "../auth-helpers"
import { jsonError, jsonOk, requestId } from "../response"
import { skillPackageDeleteSchema, skillPackageRenameSchema } from "../schemas"
import {
  buildSkillIndexPayload,
  deleteSkillPackageForUser,
  findSkillPackageByToken,
  listSkillPackagesForUser,
  renameSkillPackageForUser,
  resolveSkillAsset,
  uploadSkillPackageForUser,
} from "../../services/skill-package/skill-package-service"

export function registerSkillPackageRoutes(app: Hono) {
  app.get("/api/skill-package/list", async (c) => {
    const reqId = requestId(c)
    const user = await requireUser(c)
    if (!user) return unauthorized(c)
    const result = await listSkillPackagesForUser(user)
    if (!result.ok) {
      return c.json(jsonError("forbidden", 403, reqId), 403)
    }
    return c.json(jsonOk({ items: result.items }, reqId))
  })

  app.post("/api/skill-package/upload", async (c) => {
    const reqId = requestId(c)
    const user = await requireUser(c)
    if (!user) return unauthorized(c)
    const body = await c.req.formData()
    const file = body.get("file")
    if (!(file instanceof File)) {
      return c.json(jsonError("file is required", 400, reqId), 400)
    }
    const result = await uploadSkillPackageForUser({
      user,
      requestId: reqId,
      filename: file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
    })
    if (!result.ok) {
      if (result.reason === "forbidden") {
        return c.json(jsonError("forbidden", 403, reqId), 403)
      }
      if (result.reason === "invalid_file_type") {
        return c.json(jsonError("only .zip skill packages are supported", 400, reqId), 400)
      }
      if (result.reason === "invalid_file_size") {
        return c.json(jsonError("skill package must be between 1 byte and 5 MB", 400, reqId), 400)
      }
      return c.json(jsonError("skill package must contain exactly one SKILL.md", 400, reqId), 400)
    }
    return c.json(jsonOk({ item: result.item }, reqId))
  })

  app.post("/api/skill-package/delete", async (c) => {
    const reqId = requestId(c)
    const user = await requireUser(c)
    if (!user) return unauthorized(c)
    const body = skillPackageDeleteSchema.safeParse(await c.req.json())
    if (!body.success) {
      return c.json(jsonError("invalid skill package delete payload", 400, reqId, body.error.flatten()), 400)
    }
    const result = await deleteSkillPackageForUser({
      user,
      requestId: reqId,
      packageId: body.data.packageId,
    })
    if (!result.ok) {
      if (result.reason === "not_found") {
        return c.json(jsonError("skill package not found", 404, reqId), 404)
      }
      return c.json(jsonError("forbidden", 403, reqId), 403)
    }
    return c.json(jsonOk({ success: true }, reqId))
  })

  app.post("/api/skill-package/rename", async (c) => {
    const reqId = requestId(c)
    const user = await requireUser(c)
    if (!user) return unauthorized(c)
    const body = skillPackageRenameSchema.safeParse(await c.req.json())
    if (!body.success) {
      return c.json(jsonError("invalid skill package rename payload", 400, reqId, body.error.flatten()), 400)
    }
    const result = await renameSkillPackageForUser({
      user,
      packageId: body.data.packageId,
      displayName: body.data.displayName,
    })
    if (!result.ok) {
      if (result.reason === "not_found") {
        return c.json(jsonError("skill package not found", 404, reqId), 404)
      }
      return c.json(jsonError("forbidden", 403, reqId), 403)
    }
    return c.json(jsonOk({ item: result.item }, reqId))
  })

  app.get("/api/skill-package/content/:token/", async (c) => {
    const pkg = findSkillPackageByToken(c.req.param("token"))
    if (!pkg) return c.notFound()
    return c.json(buildSkillIndexPayload([pkg]))
  })

  app.get("/api/skill-package/content/:token/index.json", async (c) => {
    const pkg = findSkillPackageByToken(c.req.param("token"))
    if (!pkg) return c.notFound()
    // 中文/English: opencode skill discovery appends index.json automatically,
    // so runtime-shell needs to expose the same payload on both URL shapes.
    return c.json(buildSkillIndexPayload([pkg]))
  })

  app.get("/api/skill-package/content/:token/:skillName", async (c) => {
    const asset = await resolveSkillAsset({
      token: c.req.param("token"),
      skillName: c.req.param("skillName"),
      filePath: "SKILL.md",
    })
    if (!asset) return c.notFound()
    return new Response(asset.file, {
      headers: {
        "content-type": asset.contentType,
      },
    })
  })

  app.get("/api/skill-package/content/:token/:skillName/*", async (c) => {
    const prefix = `/api/skill-package/content/${c.req.param("token")}/${c.req.param("skillName")}/`
    const asset = await resolveSkillAsset({
      token: c.req.param("token"),
      skillName: c.req.param("skillName"),
      filePath: c.req.path.startsWith(prefix) ? c.req.path.slice(prefix.length) : "",
    })
    if (!asset) return c.notFound()
    return new Response(asset.file, {
      headers: {
        "content-type": asset.contentType,
      },
    })
  })
}
