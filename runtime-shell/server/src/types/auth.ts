export type UserRole = "admin" | "developer"

export type Tenant = {
  id: string
  slug: string
  name: string
  createdAt: string
  updatedAt: string
}

export type Organization = {
  id: string
  tenantId: string
  slug: string
  name: string
  createdAt: string
  updatedAt: string
}

export type Project = {
  id: string
  tenantId: string
  organizationId: string
  code: string
  name: string
  defaultWorkspacePath?: string
  createdAt: string
  updatedAt: string
}

export type User = {
  id: string
  tenantId: string
  organizationId: string
  username: string
  passwordHash: string
  displayName: string
  role: UserRole
  projectIds: string[]
  workspaceIds: string[]
}

export type Role = {
  id: string
  tenantId: string
  code: string
  name: string
  createdAt: string
  updatedAt: string
}

export type Permission = {
  id: string
  tenantId: string
  code: string
  name: string
  resourceType: string
  action: string
  scope: string
  createdAt: string
  updatedAt: string
}

export type AuthSession = {
  id: string
  userId: string
  tenantId: string
  organizationId: string
  tokenHash: string
  status: "active" | "expired" | "revoked"
  createdAt: string
  updatedAt: string
  expiresAt: string
}
