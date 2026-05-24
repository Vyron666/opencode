import path from "node:path"

const DIST_DIR = path.resolve(process.cwd(), "./web/dist")

export async function page(file: string) {
  const filePath = path.join(DIST_DIR, file)
  let blob
  try {
    blob = Bun.file(filePath)
  } catch {
    return undefined
  }
  if (!(await blob.exists())) return undefined
  const ext = file.split(".").pop() || ""
  const mime: Record<string, string> = {
    html: "text/html; charset=utf-8",
    js: "application/javascript; charset=utf-8",
    css: "text/css; charset=utf-8",
    svg: "image/svg+xml",
    png: "image/png",
    json: "application/json",
    ico: "image/x-icon",
  }
  return new Response(blob, { headers: { "content-type": mime[ext] || "application/octet-stream" } })
}
