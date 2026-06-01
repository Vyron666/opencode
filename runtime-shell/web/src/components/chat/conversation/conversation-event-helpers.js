import { readTodoItems, readToolBlockType } from './conversation-tool-plan-readers'

export function ensureTurn(state) {
  if (state.currentTurnId) return state.currentTurnId
  state.turnCounter += 1
  state.currentTurnId = `turn-${state.turnCounter}`
  return state.currentTurnId
}

export function appendMessageChunk(input) {
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

export function applyToolPayload(block, payload) {
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

export function pushBlock(state, block) {
  state.blockIndexes.set(block.key, state.blocks.length)
  state.blocks.push(block)
  state.latestBlocks = [block]
  state.latestVersion += 1
}

export function replaceBlock(state, block) {
  const index = state.blockIndexes.get(block.key)
  if (index === undefined) return
  state.blocks[index] = block
  state.latestBlocks = [block]
  state.latestVersion += 1
}

export function readMessageText(payload) {
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

export function appendChunk(current, chunk) {
  if (!current) return chunk
  if (!chunk) return current
  if (current === chunk) return current
  // 中文/English: only non-assistant blocks still use whole-string append here.
  return `${current}${chunk}`
}
