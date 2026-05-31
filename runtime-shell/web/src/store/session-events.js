export function mergeSessionDetail(sessionDetail, event) {
  if (!sessionDetail?.session) return sessionDetail
  if (event.eventType === 'user_message_chunk') {
    return {
      ...sessionDetail,
      session: {
        ...sessionDetail.session,
        status: 'waiting_input',
      },
    }
  }

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

  if (event.eventType === 'turn_completed') {
    return {
      ...sessionDetail,
      session: {
        ...sessionDetail.session,
        status: 'active',
      },
    }
  }

  if (event.eventType === 'permission_requested' || event.eventType === 'question_requested') {
    return {
      ...sessionDetail,
      session: {
        ...sessionDetail.session,
        status: 'active',
      },
    }
  }

  if (event.eventType === 'permission_resolved' || event.eventType === 'question_resolved') {
    return {
      ...sessionDetail,
      session: {
        ...sessionDetail.session,
        status: 'waiting_input',
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

export function mergeSessionEvents(currentEvents, nextEvents) {
  const merged = []
  const seenEventIds = new Set()

  ;(Array.isArray(nextEvents) ? nextEvents : []).forEach((event) => {
    if (!event || typeof event !== 'object') return
    if (event.eventId && seenEventIds.has(event.eventId)) return
    if (event.eventId) seenEventIds.add(event.eventId)
    merged.push(event)
  })

  ;(Array.isArray(currentEvents) ? currentEvents : []).forEach((event) => {
    if (!event || typeof event !== 'object') return
    if (event.eventId && seenEventIds.has(event.eventId)) return
    if (event.eventId) seenEventIds.add(event.eventId)
    merged.push(event)
  })

  return merged
}

export function readOpenInteractionIds(events, requestedEventType, resolvedEventType) {
  return (Array.isArray(events) ? events : []).reduce((openIds, event) => {
    const requestId = event?.payload?.requestId
    if (!requestId || typeof requestId !== 'string') return openIds
    if (event.eventType === requestedEventType) openIds.add(requestId)
    if (event.eventType === resolvedEventType) openIds.delete(requestId)
    return openIds
  }, new Set())
}

export function readOpenInteractionItems(events, requestedEventType, resolvedEventType) {
  return (Array.isArray(events) ? events : []).reduce((openItems, event) => {
    const requestId = event?.payload?.requestId
    if (!requestId || typeof requestId !== 'string') return openItems
    if (event.eventType === requestedEventType) {
      openItems.set(requestId, {
        requestId,
        ...(event.payload && typeof event.payload === 'object' ? event.payload : {}),
      })
    }
    if (event.eventType === resolvedEventType) openItems.delete(requestId)
    return openItems
  }, new Map())
}

export function mergePendingInteractionItems(currentItems, nextItems, openIds, respondingIds) {
  const mergedById = new Map()

  ;[...(Array.isArray(nextItems) ? nextItems : []), ...(Array.isArray(currentItems) ? currentItems : [])].forEach((item) => {
    const requestId = item?.requestId || item?.id
    if (!requestId || !openIds.has(requestId)) return
    if (respondingIds?.has(requestId)) return
    if (mergedById.has(requestId)) return
    mergedById.set(requestId, item)
  })

  return [...mergedById.values()]
}

export function mergeRespondingInteractionIds(currentIds, openIds) {
  return new Set([...(currentIds || new Set())].filter((requestId) => openIds.has(requestId)))
}

export function convergeInteractionState(input) {
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
  const respondingPermissionIds = mergeRespondingInteractionIds(
    input.respondingPermissionIds,
    openPermissionIds,
  )
  const respondingQuestionIds = mergeRespondingInteractionIds(
    input.respondingQuestionIds,
    openQuestionIds,
  )
  const pendingPermissions = mergePendingInteractionItems(
    input.pendingPermissions,
    [
      ...(Array.isArray(input.nextPendingPermissions) ? input.nextPendingPermissions : []),
      ...openPermissionItems.values(),
    ],
    openPermissionIds,
    respondingPermissionIds,
  )
  const pendingQuestions = mergePendingInteractionItems(
    input.pendingQuestions,
    [
      ...(Array.isArray(input.nextPendingQuestions) ? input.nextPendingQuestions : []),
      ...openQuestionItems.values(),
    ],
    openQuestionIds,
    respondingQuestionIds,
  )

  return {
    openPermissionItems,
    openQuestionItems,
    pendingPermissions,
    pendingQuestions,
    respondingPermissionIds,
    respondingQuestionIds,
  }
}
