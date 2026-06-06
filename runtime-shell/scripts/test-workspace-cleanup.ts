export type ApiEnvelope<T> = {
  code: number
  message: string
  data: T
  requestId: string
}

export async function cleanupWorkspacePrefixBestEffort(input: {
  baseUrl: string
  cookieJar: string[]
  namePrefix: string
  limit?: number
}) {
  try {
    await requestJson<ApiEnvelope<{ cleanedWorkspaceIds: string[] }>>(input.baseUrl, input.cookieJar, "/api/system/workspace/cleanup-prefix", {
      method: "POST",
      body: {
        namePrefix: input.namePrefix,
        limit: input.limit ?? 500,
      },
    })
  } catch {
    return
  }
}

async function requestJson<T>(
  baseUrl: string,
  cookieJar: string[],
  path: string,
  init: { method?: string; body?: unknown } = {},
) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: init.method || "GET",
    headers: {
      ...(cookieJar.length ? { Cookie: cookieJar.join("; ") } : {}),
      ...(init.body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })
  return {
    status: response.status,
    body: (await response.json()) as T,
  }
}
