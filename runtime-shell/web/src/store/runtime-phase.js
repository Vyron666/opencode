const RUN_STOP_EVENT_TYPES = [
  'turn_completed',
  'usage_update',
  'session_failed',
  'worker_disconnected',
  'permission_requested',
  'question_requested',
  'session_closed',
]

const RUN_START_EVENT_TYPES = [
  'agent_message_chunk',
  'agent_thought_chunk',
  'tool_call',
  'tool_call_update',
  'plan',
  'permission_requested',
  'question_requested',
]

export function shouldStopSending(event) {
  // 中文/English: `session_error` is visible to the user, but it is not a
  // reliable turn terminator. Only real stop events should end the running state.
  return RUN_STOP_EVENT_TYPES.includes(event?.eventType)
}

export function shouldStartRunning(event) {
  ////////////// runtime-shell customization start //////////////
  // 中文/English: `user_message_chunk` only confirms local acceptance.
  // Only upstream output or upstream interaction requests mean the model really started.
  ////////////// runtime-shell customization end //////////////
  return RUN_START_EVENT_TYPES.includes(event?.eventType)
}

export function deriveRunningState(current, event) {
  if (shouldStopSending(event)) return false
  if (shouldStartRunning(event)) return true
  return current
}

export function deriveRunningStateFromEvents(events) {
  if (!Array.isArray(events) || events.length === 0) return false
  return events.reduce((running, event) => deriveRunningState(running, event), false)
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
