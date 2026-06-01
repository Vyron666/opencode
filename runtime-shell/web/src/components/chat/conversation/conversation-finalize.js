import { reconcileConversationInteractionBlocks } from './conversation-interactions'
import { buildConversationState } from './conversation-state'

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

export function finalizeConversationView(input) {
  if (!input.conversationState?.blocks) {
    return {
      conversationBlocks: Array.isArray(input.conversationBlocks) ? input.conversationBlocks : [],
      conversationVersion: Number.isFinite(input.conversationVersion) ? input.conversationVersion : 0,
    }
  }
  const blocks = finalizeConversationBlocks(input.conversationState, input.isRunning)
  const reconciledBlocks = reconcileConversationInteractionBlocks(blocks, input)

  return {
    conversationBlocks: reconciledBlocks,
    conversationVersion:
      reconciledBlocks === blocks
        ? input.conversationState.latestVersion
        : input.conversationState.latestVersion + 1,
  }
}

export function buildConversationBlocks(events, showDebug, isRunning) {
  return finalizeConversationBlocks(buildConversationState(events, showDebug), isRunning)
}
