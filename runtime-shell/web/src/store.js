import { create } from 'zustand'
import { api, createEventSource } from './api'
import { createConversationState } from './components/chat/conversation-blocks'
import { buildCapabilitiesFromSession, DEFAULT_CAPABILITIES, mergeCapabilities } from './store/capabilities'
import { createInteractionActions } from './store/actions/interaction-actions'
import { createSessionActions } from './store/actions/session-actions'
import { createWorkspaceActions } from './store/actions/workspace-actions'
import { createSseActions } from './store/sse/sse-runtime'
import {
  createBaseState,
  resetConversationState as resetConversationStateBase,
  resetSessionState as resetSessionStateBase,
} from './store/store-state'

const resetConversationState = (patch) =>
  resetConversationStateBase(createConversationState, DEFAULT_CAPABILITIES, patch)

const resetSessionState = (patch) =>
  resetSessionStateBase(createConversationState, DEFAULT_CAPABILITIES, patch)

export const useStore = create((set, get) => ({
  ...createBaseState(createConversationState, DEFAULT_CAPABILITIES),

  login: async (username, password) => {
    const data = await api.login(username, password)
    set({ user: data.user, users: data.users, isAuthenticated: true })
    return data
  },

  logout: async () => {
    await api.logout()
    get().disconnectSSE()
    set(resetSessionState({ user: null, users: [], sessions: [], workspaces: [], isAuthenticated: false }))
  },

  checkAuth: async () => {
    const data = await api.me()
    set({ user: data.user, users: data.users || [], isAuthenticated: true })
    return true
  },

  setFlash: (message) => {
    clearTimeout(get().flashTimer)
    const timer = setTimeout(() => set({ flash: '' }), 4000)
    set({ flash: message, flashTimer: timer })
  },

  updateCapability: (patch) => set((state) => ({ capabilities: mergeCapabilities(state.capabilities, patch) })),

  ...createSessionActions({
    api,
    get,
    set,
    resetConversationState,
  }),
  ...createWorkspaceActions({
    api,
    get,
    set,
  }),
  ...createInteractionActions({
    api,
    get,
    set,
  }),
  ...createSseActions({
    createEventSource,
    get,
    set,
  }),
}))

export { buildCapabilitiesFromSession }
