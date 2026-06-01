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
  const existingPermissionIds = new Set(
    blocks
      .filter((block) => block?.type === 'permission')
      .map((block) => block?.data?.requestId || block?.data?.id)
      .filter(Boolean),
  )
  const existingQuestionIds = new Set(
    blocks
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

  if (missingPermissionBlocks.length === 0 && missingQuestionBlocks.length === 0) return blocks
  // 中文/English: interaction waiting state and visible cards must converge from
  // the same open-request set, even if live/detail/local writes briefly interleave.
  return [
    ...blocks,
    ...missingPermissionBlocks,
    ...missingQuestionBlocks,
  ]
}
