const TERMINAL_STOP_EVENT_TYPES = [
  'turn_completed',
  'session_failed',
  'worker_disconnected',
  'session_closed',
]

const PAUSE_EVENT_TYPES = [
  'permission_requested',
  'question_requested',
]

const RUN_START_EVENT_TYPES = [
  'agent_message_chunk',
  'agent_thought_chunk',
  'tool_call',
  'tool_call_update',
  'plan',
]

const TURN_RESTART_EVENT_TYPES = [
  'user_message_chunk',
  'permission_resolved',
  'question_resolved',
]

export function createRuntimeFlags() {
  return {
    isRunning: false,
    awaitingTurnRestart: false,
  }
}

export function shouldStopSending(event) {
  return TERMINAL_STOP_EVENT_TYPES.includes(event?.eventType) || PAUSE_EVENT_TYPES.includes(event?.eventType)
}

export function shouldStartRunning(event) {
  return RUN_START_EVENT_TYPES.includes(event?.eventType)
}

export function shouldUnlockTurnRestart(event) {
  return TURN_RESTART_EVENT_TYPES.includes(event?.eventType)
}

export function deriveRuntimeFlags(current, event) {
  if (!event?.eventType) return current

  if (shouldUnlockTurnRestart(event)) {
    return {
      ...current,
      awaitingTurnRestart: false,
    }
  }

  if (TERMINAL_STOP_EVENT_TYPES.includes(event.eventType)) {
    return {
      isRunning: false,
      awaitingTurnRestart: true,
    }
  }

  if (PAUSE_EVENT_TYPES.includes(event.eventType)) {
    return {
      ...current,
      isRunning: false,
    }
  }

  if (!shouldStartRunning(event)) return current
  if (current.awaitingTurnRestart) return current

  return {
    ...current,
    isRunning: true,
  }
}

export function deriveRuntimeFlagsFromEvents(events) {
  if (!Array.isArray(events) || events.length === 0) return createRuntimeFlags()
  return events.reduce((flags, event) => deriveRuntimeFlags(flags, event), createRuntimeFlags())
}

export function deriveRunningState(current, event) {
  return deriveRuntimeFlags({ isRunning: current, awaitingTurnRestart: false }, event).isRunning
}

export function deriveRunningStateFromEvents(events) {
  return deriveRuntimeFlagsFromEvents(events).isRunning
}

export function deriveConversationPhase(input) {
  if (input.isCancelling) {
    return {
      id: 'cancelling',
      label: '取消中',
      detail: '已向上游发送取消请求，正在等待当前这一轮真正结束。',
      canCancel: false,
      isBusy: true,
    }
  }

  if (input.pendingQuestions > 0 || input.respondingQuestions > 0) {
    return {
      id: 'waiting_question',
      label: '等待问题回答',
      detail:
        input.respondingQuestions > 0
          ? '问题回答已提交，正在等待上游确认并继续运行。'
          : `当前有 ${input.pendingQuestions} 个问题等待处理，提交后会继续运行。`,
      canCancel: false,
      isBusy: true,
    }
  }

  if (input.pendingPermissions > 0 || input.respondingPermissions > 0) {
    return {
      id: 'waiting_permission',
      label: '等待权限审批',
      detail:
        input.respondingPermissions > 0
          ? '权限响应已提交，正在等待上游确认并继续运行。'
          : `当前有 ${input.pendingPermissions} 个权限请求等待处理，批准或拒绝后会继续运行。`,
      canCancel: false,
      isBusy: true,
    }
  }

  if (input.isSubmitting) {
    return {
      id: 'submitting',
      label: '发送中',
      detail: '消息已提交到运行时，正在等待上游开始响应，此时也可以取消当前这一轮。',
      canCancel: true,
      isBusy: true,
    }
  }

  if (input.isRunning) {
    return {
      id: 'running',
      label: '模型生成中',
      detail: '上游正在生成内容或执行工具调用。',
      canCancel: true,
      isBusy: true,
    }
  }

  return {
    id: 'idle',
    label: '空闲',
    detail: '当前没有进行中的回复。',
    canCancel: false,
    isBusy: false,
  }
}
