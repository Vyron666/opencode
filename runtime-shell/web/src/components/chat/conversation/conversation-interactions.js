import { readOpenInteractionItems } from '../../../store/session-events'

export function reconcileConversationInteractionBlocks(blocks, input) {
  const pendingPermissionById = new Map(
    (Array.isArray(input.pendingPermissions) ? input.pendingPermissions : [])
      .map((item) => [item?.requestId || item?.id, item])
      .filter(([requestId]) => Boolean(requestId)),
  )
  const pendingQuestionById = new Map(
    (Array.isArray(input.pendingQuestions) ? input.pendingQuestions : [])
      .map((item) => [item?.requestId || item?.id, item])
      .filter(([requestId]) => Boolean(requestId)),
  )
  const openPermissionItems = readOpenInteractionItems(
    input.eventBuffer,
    'permission_requested',
    'permission_resolved',
  )
  const openQuestionItems = readOpenInteractionItems(
    input.eventBuffer,
    'question_requested',
    'question_resolved',
  )
  const openPermissionIds = new Set(openPermissionItems.keys())
  const openQuestionIds = new Set(openQuestionItems.keys())
  // 中文/English: once an interaction is resolved, keep the status row but drop
  // the inline approval/question card so the conversation no longer looks blocked.
  const activeBlocks = blocks.filter((block) => {
    if (block?.type === 'permission') {
      const requestId = block?.data?.requestId || block?.data?.id
      return Boolean(requestId) && openPermissionIds.has(requestId)
    }
    if (block?.type === 'question') {
      const requestId = block?.data?.requestId || block?.data?.id
      return Boolean(requestId) && openQuestionIds.has(requestId)
    }
    return true
  })
  const existingPermissionIds = new Set(
    activeBlocks
      .filter((block) => block?.type === 'permission')
      .map((block) => block?.data?.requestId || block?.data?.id)
      .filter(Boolean),
  )
  const existingQuestionIds = new Set(
    activeBlocks
      .filter((block) => block?.type === 'question')
      .map((block) => block?.data?.requestId || block?.data?.id)
      .filter(Boolean),
  )
  const missingPermissionBlocks = [...openPermissionItems.entries()].flatMap(([requestId, item]) => {
    if (existingPermissionIds.has(requestId)) return []
    return [{
      key: `interaction:permission:${requestId}`,
      type: 'permission',
      data: pendingPermissionById.get(requestId) || item,
    }]
  })
  const missingQuestionBlocks = [...openQuestionItems.entries()].flatMap(([requestId, item]) => {
    if (existingQuestionIds.has(requestId)) return []
    return [{
      key: `interaction:question:${requestId}`,
      type: 'question',
      data: pendingQuestionById.get(requestId) || item,
    }]
  })

  if (missingPermissionBlocks.length === 0 && missingQuestionBlocks.length === 0) return activeBlocks
  // 中文/English: interaction waiting state and visible cards must converge from
  // the same open-request set, even if live/detail/local writes briefly interleave.
  return [
    ...activeBlocks,
    ...missingPermissionBlocks,
    ...missingQuestionBlocks,
  ]
}
