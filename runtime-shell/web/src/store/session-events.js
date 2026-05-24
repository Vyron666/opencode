export function mergeSessionDetail(sessionDetail, event) {
  if (!sessionDetail?.session) return sessionDetail
  if (event.eventType === 'session_opened') {
    return {
      ...sessionDetail,
      session: {
        ...sessionDetail.session,
        status: 'active',
      },
    }
  }

  if (event.eventType === 'session_closed') {
    return {
      ...sessionDetail,
      session: {
        ...sessionDetail.session,
        status: 'completed',
      },
    }
  }

  if (event.eventType === 'session_failed' || event.eventType === 'worker_disconnected') {
    return {
      ...sessionDetail,
      session: {
        ...sessionDetail.session,
        status: 'failed',
      },
    }
  }

  return sessionDetail
}

export function reducePendingPermissions(current, event) {
  if (event.eventType === 'permission_requested') return [...current, event.payload]
  if (event.eventType === 'permission_resolved') {
    return current.filter((item) => (item.requestId || item.id) !== event.payload?.requestId)
  }
  return current
}

export function reducePendingQuestions(current, event) {
  if (event.eventType === 'question_requested') return [...current, event.payload]
  if (event.eventType === 'question_resolved') {
    return current.filter((item) => (item.requestId || item.id) !== event.payload?.requestId)
  }
  return current
}

export function createLocalEvent(businessSessionId, eventType, payload) {
  return {
    eventId: `local_${crypto.randomUUID().replace(/-/g, '')}`,
    eventType,
    businessSessionId,
    workerId: 'local',
    timestamp: new Date().toISOString(),
    payload,
  }
}
