import type { PersistedState } from "../types"
import { findUser, getUser, listUsers } from "./state-repo"

export function listAllUsers(state: PersistedState) {
  return listUsers(state)
}

export function findUserByCredentials(state: PersistedState, username: string, password?: string) {
  return findUser(state, username, password)
}

export function findUserById(state: PersistedState, userId: string) {
  return getUser(state, userId)
}
