export type ProviderConfigInput = {
  providerId: string
  name: string
  npm?: string
  api: string
  baseURL: string
  apiKey?: string
  defaultModel: string
  models: Array<{
    id: string
    name: string
    api?: string
  }>
}

export function maskApiKey(secret?: string) {
  if (!secret) return ""
  if (secret.length <= 8) return "********"
  return `${secret.slice(0, 4)}****${secret.slice(-4)}`
}
