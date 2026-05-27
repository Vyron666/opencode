import { openRealRuntime } from "../../acp-runtime-manager"
import { sessionService } from "../store/store-singleton"
import type { BusinessSession, Workspace } from "../../types"

async function requireWorkspacePath(workspacePath: string) {
  const info = await Bun.file(workspacePath).stat()
  if (!info.isDirectory()) throw new Error(`workspace path is not a directory: ${workspacePath}`)
}

export async function openSessionWithFallback(session: BusinessSession, workspace?: Workspace) {
  await requireWorkspacePath(workspace?.rootPath || session.workspacePath)
  // 中文/English: runtime-shell only supports a real ACP runtime; failures bubble up to the HTTP layer.
  const opened = await openRealRuntime(session)
  return (await sessionService.getSession(session.id)) || sessionService.getSession(opened.client.getSessionId())
}
