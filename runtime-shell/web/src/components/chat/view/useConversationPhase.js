import { useMemo } from 'react'
import { useStore } from '../../../store'
import { deriveConversationPhase } from '../../../store/runtime-phase'

export function useConversationPhase() {
  const isSubmitting = useStore((state) => state.isSubmitting)
  const isRunning = useStore((state) => state.isRunning)
  const isCancelling = useStore((state) => state.isCancelling)
  const pendingPermissions = useStore((state) => state.pendingPermissions.length)
  const pendingQuestions = useStore((state) => state.pendingQuestions.length)
  const respondingPermissions = useStore((state) => state.respondingPermissionIds.size)
  const respondingQuestions = useStore((state) => state.respondingQuestionIds.size)

  return useMemo(
    () =>
      deriveConversationPhase({
        isSubmitting,
        isRunning,
        isCancelling,
        pendingPermissions,
        pendingQuestions,
        respondingPermissions,
        respondingQuestions,
      }),
    [isSubmitting, isRunning, isCancelling, pendingPermissions, pendingQuestions, respondingPermissions, respondingQuestions],
  )
}
