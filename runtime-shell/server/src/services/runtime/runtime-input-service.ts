import type { Annotations, ContentBlock, Role } from "@agentclientprotocol/sdk"
import type { inputPartSchema, annotationsSchema } from "../../http/schemas"
import type { z } from "zod"

export function normalizeAnnotations(annotations?: z.infer<typeof annotationsSchema>): Annotations | undefined {
  if (!annotations) return undefined
  return {
    ...annotations,
    ...(annotations.audience ? { audience: annotations.audience as Role[] } : {}),
  }
}

export function toContentBlock(part: z.infer<typeof inputPartSchema>): ContentBlock {
  if (part.type === "text") {
    return {
      type: "text",
      text: part.text,
      ...(part.annotations ? { annotations: normalizeAnnotations(part.annotations) } : {}),
    }
  }
  if (part.type === "image") {
    return {
      type: "image",
      data: part.data,
      mimeType: part.mimeType,
      ...(part.uri ? { uri: part.uri } : {}),
      ...(part.annotations ? { annotations: normalizeAnnotations(part.annotations) } : {}),
    }
  }
  if (part.type === "audio") {
    return {
      type: "audio",
      data: part.data,
      mimeType: part.mimeType,
      ...(part.annotations ? { annotations: normalizeAnnotations(part.annotations) } : {}),
    }
  }
  if (part.type === "resource_link") {
    return {
      type: "resource_link",
      uri: part.uri,
      name: part.name,
      ...(part.title ? { title: part.title } : {}),
      ...(part.description ? { description: part.description } : {}),
      ...(part.mimeType ? { mimeType: part.mimeType } : {}),
      ...(part.size !== undefined ? { size: part.size } : {}),
      ...(part.annotations ? { annotations: normalizeAnnotations(part.annotations) } : {}),
    }
  }
  return {
    type: "resource",
    resource: "text" in part.resource
      ? {
          uri: part.resource.uri,
          text: part.resource.text,
          ...(part.resource.mimeType ? { mimeType: part.resource.mimeType } : {}),
        }
      : {
          uri: part.resource.uri,
          blob: part.resource.blob,
          ...(part.resource.mimeType ? { mimeType: part.resource.mimeType } : {}),
        },
    ...(part.annotations ? { annotations: normalizeAnnotations(part.annotations) } : {}),
  }
}

function containsCjkText(parts: z.infer<typeof inputPartSchema>[]) {
  return parts.some((part) => {
    if (part.type === "text") return /[\u3400-\u9fff\uf900-\ufaff]/u.test(part.text)
    if (part.type === "resource" && "text" in part.resource) return /[\u3400-\u9fff\uf900-\ufaff]/u.test(part.resource.text)
    return false
  })
}

export function withLocaleGuidance(parts: z.infer<typeof inputPartSchema>[]) {
  if (!containsCjkText(parts)) return parts.map(toContentBlock)
  return [
    {
      type: "text",
      text: "请使用中文思考并使用中文回复用户；如无必要，不要切换到英文。",
      annotations: {
        audience: ["assistant"],
      },
    } satisfies ContentBlock,
    ...parts.map(toContentBlock),
  ]
}
