import { z } from "zod"

export const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
})

export const createSessionSchema = z.object({
  title: z.string().min(1),
  projectId: z.string().min(1).default("default"),
  workspaceId: z.string().min(1),
  // 中文/English: only create-and-enter requests should reserve worker/runtime capacity up front.
  warmup: z.boolean().optional().default(false),
})

export const sessionIdSchema = z.object({
  businessSessionId: z.string().min(1),
})

export const workspaceShareSchema = z.object({
  workspaceId: z.string().min(1),
  projectId: z.string().min(1),
  targetUserId: z.string().min(1),
})

export const workspaceCreateSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().trim().min(1).max(80),
})

export const forkSessionSchema = z.object({
  businessSessionId: z.string().min(1),
  title: z.string().min(1),
})

export const annotationsSchema = z
  .object({
    audience: z.array(z.enum(["assistant", "user"])).optional(),
    lastModified: z.string().optional(),
    priority: z.number().optional(),
  })
  .passthrough()
  .optional()

export const textPartSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
  annotations: annotationsSchema,
})

export const imagePartSchema = z.object({
  type: z.literal("image"),
  data: z.string(),
  mimeType: z.string(),
  uri: z.string().optional(),
  annotations: annotationsSchema,
})

export const audioPartSchema = z.object({
  type: z.literal("audio"),
  data: z.string(),
  mimeType: z.string(),
  annotations: annotationsSchema,
})

export const resourceLinkPartSchema = z.object({
  type: z.literal("resource_link"),
  uri: z.string(),
  name: z.string(),
  title: z.string().optional(),
  description: z.string().optional(),
  mimeType: z.string().optional(),
  size: z.number().optional(),
  annotations: annotationsSchema,
})

export const embeddedTextResourceSchema = z.object({
  type: z.literal("resource"),
  resource: z.object({
    uri: z.string(),
    text: z.string(),
    mimeType: z.string().optional(),
  }),
  annotations: annotationsSchema,
})

export const embeddedBlobResourceSchema = z.object({
  type: z.literal("resource"),
  resource: z.object({
    uri: z.string(),
    blob: z.string(),
    mimeType: z.string().optional(),
  }),
  annotations: annotationsSchema,
})

export const inputPartSchema = z.union([
  textPartSchema,
  imagePartSchema,
  audioPartSchema,
  resourceLinkPartSchema,
  embeddedTextResourceSchema,
  embeddedBlobResourceSchema,
])

export const inputSchema = z.object({
  businessSessionId: z.string().min(1),
  parts: z.array(inputPartSchema).min(1),
})

export const modeSchema = z.object({
  businessSessionId: z.string().min(1),
  modeId: z.string().min(1),
})

export const modelSchema = z.object({
  businessSessionId: z.string().min(1),
  modelId: z.string().min(1),
})

export const configSchema = z.object({
  businessSessionId: z.string().min(1),
  configId: z.string().min(1),
  value: z.union([z.string(), z.boolean()]),
})

export const permissionResponseSchema = z.object({
  businessSessionId: z.string().min(1),
  requestId: z.string().min(1),
  approved: z.boolean(),
  optionId: z.string().optional(),
})

export const questionResponseSchema = z.object({
  businessSessionId: z.string().min(1),
  requestId: z.string().min(1),
  action: z.enum(["accept", "decline", "cancel"]),
  // 中文/English: only present when action === "accept".
  content: z.record(z.string(), z.unknown()).optional(),
})

export const providerModelSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  api: z.string().optional(),
})

export const providerConfigSchema = z.object({
  providerId: z.string().min(1),
  name: z.string().min(1),
  npm: z.string().optional(),
  api: z.string().min(1),
  baseURL: z.string().min(1),
  apiKey: z.string().optional(),
  defaultModel: z.string().min(1),
  models: z.array(providerModelSchema).min(1),
})

export const skillConfigSchema = z.object({
  paths: z.array(z.string().min(1)).optional().default([]),
  urls: z.array(z.string().min(1)).optional().default([]),
})

const localMcpSchema = z.object({
  type: z.literal("local"),
  enabled: z.boolean().optional(),
  command: z.array(z.string().min(1)).min(1),
  timeout: z.number().int().positive().optional(),
})

const remoteMcpSchema = z.object({
  type: z.literal("remote"),
  enabled: z.boolean().optional(),
  url: z.string().min(1),
  headers: z.record(z.string(), z.string()).optional(),
  timeout: z.number().int().positive().optional(),
})

export const mcpConfigSchema = z.object({
  servers: z.record(z.string().min(1), z.union([localMcpSchema, remoteMcpSchema])),
})

export const configImpactPreviewSchema = z.object({
  namespace: z.enum(["provider", "mcp", "skill"]),
  targetId: z.string().optional(),
})

export const configApprovalReviewSchema = z.object({
  approvalId: z.string().min(1),
  decision: z.enum(["approved", "rejected"]),
  comment: z.string().optional(),
})

export const workerRegisterSchema = z.object({
  tenantId: z.string().min(1).optional(),
  organizationId: z.string().min(1).optional(),
  nodeCode: z.string().min(1),
  endpoint: z.string().min(1),
  version: z.string().min(1).optional(),
  capacityTotal: z.number().int().positive(),
  name: z.string().min(1).optional(),
})

export const workerHeartbeatSchema = z.object({
  workerNodeId: z.string().min(1),
  capacityUsed: z.number().int().min(0),
  status: z.enum(["registering", "ready", "busy", "degraded", "offline", "draining"]),
})

export const sessionRecoverSchema = z.object({
  businessSessionId: z.string().min(1),
})

export const sessionRebindSchema = z.object({
  businessSessionId: z.string().min(1),
  reason: z.string().min(1),
})
