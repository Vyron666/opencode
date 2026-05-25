function createStatusBlock(key, message) {
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
    if (plan.kind === 'todo') return state
    pushBlock(state, {
      key: event.eventId || `plan-${state.blocks.length}`,
      type: 'plan',
      message: plan.message,
      entries: plan.entries,
    })
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

export function finalizeConversationBlocks(state, isRunning) {
  return state.blocks.reduce((result, block, index) => {
    const previous = state.blocks[index - 1]
    if ((block.type === 'status' || block.type === 'error') && previous?.type === block.type && previous?.message === block.message) {
      return result
    }

    if (block.type !== 'assistant') {
      result.push(block)
      return result
    }

    ////////////// runtime-shell customization start //////////////
    // 中文/English: keep unchanged assistant block references stable so only
    // the currently growing assistant row re-renders during streaming.
    const streaming = isRunning && block.key === state.lastAssistantKey
    if (streaming) {
      result.push(block.streaming === true ? block : { ...block, streaming: true })
      return result
    }

    if (Array.isArray(block.chunks) && block.chunks.length > 0) {
      // 中文/English: keep chunk storage incremental during streaming and only
      // join once after the upstream turn actually stops.
      const finalized = {
        ...block,
        message: block.message || block.chunks.join(''),
        latestChunk: '',
        chunks: [],
        streaming: false,
      }
      state.assistantBlocks.set(block.key, finalized)
      state.blocks[index] = finalized
      result.push(finalized)
      return result
    }

    result.push(block.streaming === false ? block : { ...block, streaming: false })
    ////////////// runtime-shell customization end //////////////
    return result
  }, [])
}

export function buildConversationBlocks(events, showDebug, isRunning) {
  return finalizeConversationBlocks(buildConversationState(events, showDebug), isRunning)
}

function ensureTurn(state) {
  if (state.currentTurnId) return state.currentTurnId
  state.turnCounter += 1
  state.currentTurnId = `turn-${state.turnCounter}`
  return state.currentTurnId
}

function appendMessageChunk(input) {
  const message = readMessageText(input.event.payload)
  if (!message) return

  const messageId = input.event.payload?.messageId || `${input.turnId}-${input.fallbackMessageId}`
  const blockKey = `${input.turnId}:${input.blockType}:${messageId}`
  const existing = input.registry.get(blockKey)
  const handledEventIds = input.handledEvents.get(blockKey) || new Set()

  if (input.event.eventId && handledEventIds.has(input.event.eventId)) return

  if (existing) {
    if (input.blockType !== 'assistant') {
      const nextBlock = {
        ...existing,
        message: appendChunk(existing.message, message),
      }
      input.registry.set(blockKey, nextBlock)
      replaceBlock(input.state, nextBlock)
      if (input.event.eventId) handledEventIds.add(input.event.eventId)
      input.handledEvents.set(blockKey, handledEventIds)
      return
    }

    const nextBlock = {
      ...existing,
      latestChunk: message,
      chunkVersion: existing.chunkVersion + 1,
      chunks: existing.chunks,
    }
    nextBlock.chunks.push(message)
    input.registry.set(blockKey, nextBlock)
    if (input.blockType === 'assistant') input.state.lastAssistantKey = blockKey
    replaceBlock(input.state, nextBlock)
    if (input.event.eventId) handledEventIds.add(input.event.eventId)
    input.handledEvents.set(blockKey, handledEventIds)
    return
  }

  const block = {
    key: blockKey,
    type: input.blockType,
    message: input.blockType === 'assistant' ? '' : message,
    latestChunk: input.blockType === 'assistant' ? message : '',
    chunkVersion: input.blockType === 'assistant' ? 1 : 0,
    chunks: input.blockType === 'assistant' ? [message] : [],
    streaming: false,
    turnId: input.turnId,
    messageId,
  }
  input.registry.set(blockKey, block)
  if (input.blockType === 'assistant') input.state.lastAssistantKey = blockKey
  if (input.event.eventId) handledEventIds.add(input.event.eventId)
  input.handledEvents.set(blockKey, handledEventIds)
  pushBlock(input.state, block)
}

function applyToolPayload(block, payload) {
  return {
    ...block,
    type: readToolBlockType(payload, block.type),
    title: payload?.title || payload?.toolName || block.title || '工具调用',
    kind: payload?.kind || block.kind || '',
    status: payload?.status || block.status || 'pending',
    input: payload?.rawInput !== undefined ? payload.rawInput : block.input,
    output: payload?.rawOutput !== undefined ? payload.rawOutput : block.output,
    locations: Array.isArray(payload?.locations) ? payload.locations : block.locations,
    content: Array.isArray(payload?.content) ? payload.content : block.content,
    todos: readTodoItems(payload?.rawInput?.todos, block.todos),
  }
}

function pushBlock(state, block) {
  state.blockIndexes.set(block.key, state.blocks.length)
  state.blocks.push(block)
  state.latestBlocks = [block]
  state.latestVersion += 1
}

function replaceBlock(state, block) {
  const index = state.blockIndexes.get(block.key)
  if (index === undefined) return
  state.blocks[index] = block
  state.latestBlocks = [block]
  state.latestVersion += 1
}

function readMessageText(payload) {
  if (!payload) return ''
  if (typeof payload.text === 'string') return payload.text
  if (typeof payload.content?.text === 'string') return payload.content.text
  if (Array.isArray(payload.content)) {
    return payload.content
      .map((item) => {
        if (item?.type === 'text' && typeof item.text === 'string') return item.text
        if (item?.type === 'content' && item.content?.type === 'text' && typeof item.content.text === 'string') return item.content.text
        return ''
      })
      .join('')
  }
  if (Array.isArray(payload.parts)) return payload.parts.map((item) => item?.text || '').join('')
  return ''
}

function appendChunk(current, chunk) {
  if (!current) return chunk
  if (!chunk) return current
  if (current === chunk) return current
  // 中文/English: only non-assistant blocks still use whole-string append here.
  return `${current}${chunk}`
}

function readToolBlockType(payload, currentType) {
  if (isTodoToolPayload(payload)) return 'todo'
  return currentType || 'tool'
}

function isTodoToolPayload(payload) {
  if (Array.isArray(payload?.rawInput?.todos)) return true
  if (typeof payload?.toolName === 'string' && payload.toolName.toLowerCase() === 'todowrite') return true
  if (typeof payload?.title === 'string' && payload.title.toLowerCase() === 'todowrite') return true
  return false
}

function readTodoItems(input, fallback = []) {
  if (!Array.isArray(input)) return fallback
  return input.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const content = typeof item.content === 'string' ? item.content : ''
    if (!content) return []
    return [
      {
        status: typeof item.status === 'string' ? item.status : 'pending',
        content,
      },
    ]
  })
}

function readPlanBlock(payload) {
  if (!payload) return null
  const entries = readPlanEntries(payload)
  const message = readPlanMessage(payload)
  if (!message && entries.length === 0) return null
  return {
    kind: isTodoPlanPayload(payload, entries) ? 'todo' : 'plan',
    message,
    entries,
  }
}

function readPlanEntries(payload) {
  if (Array.isArray(payload?.entries)) return payload.entries.flatMap((item) => readPlanEntry(item))
  if (Array.isArray(payload?.plan)) return payload.plan.flatMap((item) => readPlanEntry(item))
  return []
}

function readPlanEntry(item) {
  if (!item || typeof item !== 'object') return []
  const text = item.content || item.step || item.title || item.text
  if (typeof text !== 'string' || !text) return []
  return [
    {
      status: typeof item.status === 'string' ? item.status : 'pending',
      text,
    },
  ]
}

function readPlanMessage(payload) {
  if (typeof payload?.text === 'string') return payload.text
  if (typeof payload?.explanation === 'string') return payload.explanation
  if (typeof payload?.plan === 'string') return payload.plan
  if (Array.isArray(payload?.entries) || Array.isArray(payload?.plan)) return ''
  return JSON.stringify(payload, null, 2)
}

function isTodoPlanPayload(payload, entries) {
  if (!Array.isArray(payload?.entries) || entries.length === 0) return false
  return payload.entries.every((item) => item && typeof item === 'object' && typeof item.content === 'string' && !('step' in item))
}

function readSessionErrorText(payload) {
  const error = payload?.error
  if (!error || typeof error !== 'object') return '上游会话返回错误'
  if (error.data && typeof error.data === 'object' && typeof error.data.message === 'string' && error.data.message) {
    return error.data.message
  }
  if (typeof error.message === 'string' && error.message) return error.message
  if (typeof error.name === 'string' && error.name) return error.name
  return JSON.stringify(error, null, 2)
}

function isDebugEvent(eventType) {
  return ['turn_completed', 'usage_update', 'available_commands_update', 'config_option_update', 'current_mode_update', 'session_info_update', 'upstream_update'].includes(eventType)
}
