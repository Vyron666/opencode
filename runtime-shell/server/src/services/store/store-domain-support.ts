import type { PersistedState } from "../../types"

export type ReadState = () => PersistedState
export type PersistState = () => Promise<void>
