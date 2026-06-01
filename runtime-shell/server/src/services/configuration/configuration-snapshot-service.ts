import type { User } from "../../types"
import { listVisibleMcpServers } from "./mcp-configuration-service"
import { listUserPrivateStoredProviderConfigs, listVisibleProviderConfigs } from "./provider-configuration-service"
import { getVisibleSkillConfig } from "./skill-configuration-service"

export async function resolveSettingsSnapshot(user: User) {
  const [providerConfigs, mcpServers, skills] = await Promise.all([
    listVisibleProviderConfigs(user),
    listVisibleMcpServers(user),
    getVisibleSkillConfig(user),
  ])
  return {
    providerConfigs,
    mcpServers,
    skills,
  }
}

export async function buildSessionConfigOverride(user: User) {
  const [providers, mcpServers, skills] = await Promise.all([
    listUserPrivateStoredProviderConfigs(user),
    listVisibleMcpServers(user),
    getVisibleSkillConfig(user),
  ])

  return {
    ...(providers.length
      ? {
          provider: Object.fromEntries(
            providers.map((provider) => [
              provider.providerId,
              {
                name: provider.name,
                api: provider.api,
                ...(provider.npm ? { npm: provider.npm } : {}),
                options: {
                  baseURL: provider.baseURL,
                  ...(provider.apiKey?.trim() ? { apiKey: provider.apiKey.trim() } : {}),
                },
                models: Object.fromEntries(
                  provider.models.map((model) => [
                    model.id,
                    {
                      name: model.name,
                      ...(model.api ? { api: model.api } : {}),
                    },
                  ]),
                ),
              },
            ]),
          ),
          enabled_providers: providers.map((provider) => provider.providerId),
          model: providers[0]?.defaultModel,
        }
      : {}),
    ...(skills.paths?.length || skills.urls?.length
      ? {
          skills: {
            ...(skills.paths?.length ? { paths: skills.paths } : {}),
            ...(skills.urls?.length ? { urls: skills.urls } : {}),
          },
        }
      : {}),
    ...(mcpServers.length
      ? {
          mcp: Object.fromEntries(
            mcpServers.map((server) => [
              server.name,
              {
                ...(server.type === "local"
                  ? {
                      type: "local",
                      command: server.command ?? [],
                    }
                  : {
                      type: "remote",
                      url: server.url ?? "",
                    }),
                ...(server.enabled === undefined ? {} : { enabled: server.enabled }),
                ...(server.timeout === undefined ? {} : { timeout: server.timeout }),
                ...(server.headers ? { headers: server.headers } : {}),
              },
            ]),
          ),
        }
      : {}),
  }
}
