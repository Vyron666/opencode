import path from "node:path"
import { Config } from "../config"
import type { PersistedState } from "../types"
import { defaultState, normalizeState } from "./state-support"

export async function ensureDataDir() {
  await Bun.write(path.join(path.dirname(Config.dataFile), ".gitkeep"), "")
}

export async function loadStateFromDisk(log: { info: (message: string, data?: Record<string, unknown>) => void }) {
  await ensureDataDir()
  const file = Bun.file(Config.dataFile)
  if (!(await file.exists())) {
    log.info("creating new data file", { path: Config.dataFile })
    const state = defaultState()
    await saveStateToDisk(state)
    return state
  }

  const text = await file.text()
  if (!text.trim()) {
    log.info("data file empty, creating defaults", { path: Config.dataFile })
    const state = defaultState()
    await saveStateToDisk(state)
    return state
  }

  const state = normalizeState(JSON.parse(text) as PersistedState)
  log.info("data loaded", {
    path: Config.dataFile,
    sessions: state.sessions.length,
    events: state.events.length,
    workspaces: state.workspaces.length,
  })
  return state
}

export async function saveStateToDisk(state: PersistedState) {
  await ensureDataDir()
  await Bun.write(Config.dataFile, JSON.stringify(state, null, 2))
}
