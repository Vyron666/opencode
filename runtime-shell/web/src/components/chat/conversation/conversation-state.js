import { isDebugEvent, readSessionErrorText } from './conversation-error-debug'
import {
  appendMessageChunk,
  applyToolPayload,
  ensureTurn,
  pushBlock,
  readMessageText,
  replaceBlock,
} from './conversation-event-helpers'
import { readPlanBlock } from './conversation-tool-plan-readers'

export function createStatusBlock(key, message) {
  return {
    key,
    type: 'status',
    message,
  }
}

export function createConversationState() {
  return {
    blocks: [],
    blockIndexes: new Map(),
    latestBlocks: [],
    latestVersion: 0,
    lastAssistantKey: '',
    assistantBlocks: new Map(),
    thinkingBlocks: new Map(),
    toolBlocks: new Map(),
    planBlocks: new Map(),
    todoPlanBlocks: new Map(),
    handledAssistantEvents: new Map(),
    handledThinkingEvents: new Map(),
    currentTurnId: 'turn-initial',
    turnCounter: 0,
  }
}

export function buildConversationState(events, showDebug = false) {
  const state = createConversationState()
  if (!Array.isArray(events)) return state
  events.forEach((event) => appendConversationEvent(state, event, showDebug))
  return state
}

export function appendConversationEvent(state, event, showDebug = false) {
  if (!event?.eventType) return state
  if (!showDebug && isDebugEvent(event.eventType)) return state

  if (event.eventType === 'user_message_chunk') {
    const message = readMessageText(event.payload)
    if (!message) return state
    state.turnCounter += 1
    state.currentTurnId = `turn-${state.turnCounter}`
    pushBlock(state, {
      key: event.eventId || `user-${state.turnCounter}`,
      type: 'user',
      message,
      timestamp: event.timestamp,
      turnId: state.currentTurnId,
    })
    return state
  }

  if (event.eventType === 'agent_message_chunk') {
    appendMessageChunk({
      state,
      event,
      turnId: ensureTurn(state),
      blockType: 'assistant',
      fallbackMessageId: 'assistant',
      registry: state.assistantBlocks,
      handledEvents: state.handledAssistantEvents,
    })
    return state
  }

  if (event.eventType === 'agent_thought_chunk') {
    appendMessageChunk({
      state,
      event,
      turnId: ensureTurn(state),
      blockType: 'thinking',
      fallbackMessageId: 'thinking',
      registry: state.thinkingBlocks,
      handledEvents: state.handledThinkingEvents,
    })
    return state
  }

  if (event.eventType === 'tool_call' || event.eventType === 'tool_call_update') {
    const turnId = ensureTurn(state)
    const toolCallId = event.payload?.toolCallId || event.payload?.id || event.eventId
    const blockKey = `${turnId}:tool:${toolCallId}`
    const existing = state.toolBlocks.get(blockKey)

    if (existing) {
      const nextBlock = applyToolPayload(existing, event.payload)
      state.toolBlocks.set(blockKey, nextBlock)
      replaceBlock(state, nextBlock)
      return state
    }

    const nextBlock = applyToolPayload(
      {
        key: blockKey,
        type: 'tool',
        turnId,
        toolCallId,
        title: '',
        kind: '',
        status: 'pending',
        input: null,
        output: null,
        locations: [],
        content: [],
        todos: [],
      },
      event.payload,
    )
    state.toolBlocks.set(blockKey, nextBlock)
    pushBlock(state, nextBlock)
    return state
  }

  if (event.eventType === 'upstream_update') {
    pushBlock(state, createStatusBlock(event.eventId || `upstream-${state.blocks.length}`, `上游事件：${event.payload?.sessionUpdate || 'unknown'}`))
    return state
  }

  if (event.eventType === 'turn_completed') {
    pushBlock(state, createStatusBlock(event.eventId || `turn-completed-${state.blocks.length}`, `本轮已结束：${event.payload?.stopReason || 'completed'}`))
    return state
  }

  if (event.eventType === 'plan') {
    const plan = readPlanBlock(event.payload)
    if (!plan) return state
    const turnId = ensureTurn(state)
    if (plan.kind === 'todo') {
      const blockKey = `${turnId}:todo-plan`
      const nextBlock = {
        key: blockKey,
        type: 'todo',
        turnId,
        title: '',
        kind: 'todo',
        status: 'in_progress',
        todos: plan.entries.map((entry) => ({
          status: entry.status,
          content: entry.text,
        })),
      }
      if (state.todoPlanBlocks.has(blockKey)) {
        state.todoPlanBlocks.set(blockKey, nextBlock)
        replaceBlock(state, nextBlock)
        return state
      }
      state.todoPlanBlocks.set(blockKey, nextBlock)
      pushBlock(state, nextBlock)
      return state
    }
    const blockKey = `${turnId}:plan`
    const nextBlock = {
      key: blockKey,
      type: 'plan',
      turnId,
      message: plan.message,
      entries: plan.entries,
    }
    if (state.planBlocks.has(blockKey)) {
      state.planBlocks.set(blockKey, nextBlock)
      replaceBlock(state, nextBlock)
      return state
    }
    state.planBlocks.set(blockKey, nextBlock)
    pushBlock(state, nextBlock)
    return state
  }

  if (event.eventType === 'permission_requested') {
    pushBlock(state, {
      key: event.eventId || `permission-${state.blocks.length}`,
      type: 'permission',
      data: event.payload,
    })
    return state
  }

  if (event.eventType === 'question_requested') {
    pushBlock(state, {
      key: event.eventId || `question-${state.blocks.length}`,
      type: 'question',
      data: event.payload,
    })
    return state
  }

  if (event.eventType === 'permission_resolved') {
    pushBlock(
      state,
      createStatusBlock(
        event.eventId || `permission-resolved-${state.blocks.length}`,
        `权限请求已${event.payload?.outcome?.outcome === 'selected' ? '批准' : '处理'}`,
      ),
    )
    return state
  }

  if (event.eventType === 'question_resolved') {
    pushBlock(
      state,
      createStatusBlock(
        event.eventId || `question-resolved-${state.blocks.length}`,
        `交互提问已${event.payload?.action === 'accept' ? '提交' : '结束'}`,
      ),
    )
    return state
  }

  if (event.eventType === 'status_local') {
    pushBlock(state, createStatusBlock(event.eventId || `status-local-${state.blocks.length}`, event.payload?.message || '状态已更新'))
    return state
  }

  if (event.eventType === 'session_opened') {
    pushBlock(
      state,
      createStatusBlock(
        event.eventId || `session-opened-${state.blocks.length}`,
        `会话已打开，传输：${event.payload?.transport || 'real'}`,
      ),
    )
    return state
  }

  if (event.eventType === 'session_closed') {
    pushBlock(state, createStatusBlock(event.eventId || `session-closed-${state.blocks.length}`, '会话已关闭'))
    return state
  }

  if (event.eventType === 'session_failed' || event.eventType === 'worker_disconnected') {
    pushBlock(state, {
      key: event.eventId || `error-${state.blocks.length}`,
      type: 'error',
      message: event.payload?.message || '运行时连接异常',
    })
    return state
  }

  if (event.eventType === 'session_error') {
    pushBlock(state, {
      key: event.eventId || `session-error-${state.blocks.length}`,
      type: 'error',
      message: readSessionErrorText(event.payload),
    })
  }

  return state
}
