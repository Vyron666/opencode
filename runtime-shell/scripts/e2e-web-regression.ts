import { RuntimeShellClient } from "../server/src/acp/runtime-shell-client.ts"
import { createUpstreamDrainController } from "../server/src/runtime/upstream-drain.ts"
import {
  buildConversationState,
  createConversationState,
  finalizeConversationBlocks,
  finalizeConversationView,
} from "../web/src/components/chat/conversation-blocks.js"
import { createInteractionActions } from "../web/src/store/actions/interaction-actions.js"
import { activateCurrentSession } from "../web/src/store/actions/session-activation-support.js"
import { loadCurrentSessionDetail } from "../web/src/store/actions/session-detail-sync-support.js"
import {
  closeCurrentSessionAndReset,
  createSessionAndActivate,
  forkCurrentSessionAndSelect,
} from "../web/src/store/actions/session-lifecycle-write-support.js"
import { updateCurrentSessionMode } from "../web/src/store/actions/session-settings-support.js"
import { mergeSessionDetail } from "../web/src/store/session-events.js"
import {
  deriveConversationPhase,
  deriveRunningState,
  deriveRuntimeFlagsFromEvents,
} from "../web/src/store/runtime-phase.js"
import { shouldStreamAssistantChunk } from "../web/src/store/sse/sse-runtime.js"
import { loadSessionSummaries } from "../web/src/store/actions/session-list-sync-support.js"
import { rebuildMissingAcpSessionFromRuntimeHome } from "../server/src/services/runtime/runtime-session-rebuild-service.ts"
import { recoverMissingAcpSessionForTest } from "../server/src/runtime/runtime-manager.ts"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "node:os"
import { Database } from "bun:sqlite"

type ConversationBlock = Record<string, any>

const planOnly = process.argv.includes("--plan-only")

const result = {
  ok: false,
  planOnly,
  assertions: {} as Record<string, boolean>,
}

try {
  verifyPlanMergesWithinTurn()
  result.assertions.plan_merges_within_turn = true

  verifyPlanSeparatesAcrossTurns()
  result.assertions.plan_separates_across_turns = true

  verifyTodoPlanRendersAsTodoBlock()
  result.assertions.todo_plan_renders_as_todo_block = true

  verifyTodoPlanUpdatesWithinTurn()
  result.assertions.todo_plan_updates_within_turn = true

  if (!planOnly) {
    await verifyCancel409ConvergesToIdle()
    result.assertions.cancel_409_converges_to_idle = true

    await verifyQuestionSubmissionRemovesPending()
    result.assertions.question_submission_removes_pending = true

    await verifyPermissionSubmissionRemovesPending()
    result.assertions.permission_submission_removes_pending = true

    verifyRunningStateStopsOnInteractionRequest()
    result.assertions.running_state_stops_on_interaction_request = true

    verifyPhaseStaysBusyWhileAwaitingQuestionResolution()
    result.assertions.phase_waiting_question_is_busy = true

    verifyLateChunkAfterTurnCompletedDoesNotReopenRunning()
    result.assertions.late_chunk_after_turn_completed_is_ignored = true

    verifyLateChunkAfterTurnCompletedDoesNotUseDirectStreamPath()
    result.assertions.late_chunk_after_turn_completed_refreshes_render = true

    verifyOutOfOrderTurnCompletionStillKeepsFullAssistantText()
    result.assertions.out_of_order_turn_completion_keeps_full_text = true

    await verifyPermissionResolutionRegistersBeforeExposure()
    result.assertions.permission_resolution_registers_before_exposure = true

    await verifyQuestionResolutionRegistersBeforeExposure()
    result.assertions.question_resolution_registers_before_exposure = true

    await verifyUpstreamDrainWaitsForLateTrackedWrites()
    result.assertions.upstream_drain_waits_for_late_tracked_writes = true

    verifyTurnCompletedClearsSubmittingWithoutVisibleChunks()
    result.assertions.turn_completed_clears_submitting_without_visible_chunks = true

    await verifySessionListPollDoesNotReloadDetailForChunkOnlyProgress()
    result.assertions.session_list_poll_does_not_reload_detail_for_chunk_only_progress = true

    await verifySessionListPollReloadsDetailWhenBusyStateDiverges()
    result.assertions.session_list_poll_reloads_detail_when_busy_state_diverges = true

    verifySessionDetailStatusTracksTurnLifecycle()
    result.assertions.session_detail_status_tracks_turn_lifecycle = true

    await verifySessionDetailReloadKeepsVisibleQuestionRequest()
    result.assertions.session_detail_reload_keeps_visible_question_request = true

    await verifySessionDetailReloadKeepsRespondingQuestionState()
    result.assertions.session_detail_reload_keeps_responding_question_state = true

    await verifySessionDetailReloadKeepsRespondingPermissionState()
    result.assertions.session_detail_reload_keeps_responding_permission_state = true

    verifyConversationViewReconcilesMissingPermissionBlock()
    result.assertions.conversation_view_reconciles_missing_permission_block = true

    verifyConversationViewReconcilesRespondingQuestionBlock()
    result.assertions.conversation_view_reconciles_responding_question_block = true

    verifyDebugConversationViewReconcilesMissingQuestionBlock()
    result.assertions.debug_conversation_view_reconciles_missing_question_block = true

    await verifyAttachmentLocalStatusKeepsVisiblePermissionBlock()
    result.assertions.attachment_local_status_keeps_visible_permission_block = true

    await verifyActivateFailureClearsPendingSessionAction()
    result.assertions.activate_failure_clears_pending_session_action = true

    await verifyOrphanedSessionWithBindingResumesInsteadOfOpening()
    result.assertions.orphaned_session_with_binding_resumes_instead_of_opening = true

    await verifyMissingAcpSessionRebuildsFromRuntimeHome()
    result.assertions.missing_acp_session_rebuilds_from_runtime_home = true

    await verifyMissingAcpSessionRebuildPreservesStableOrdering()
    result.assertions.missing_acp_session_rebuild_preserves_stable_ordering = true

    await verifyMissingAcpSessionPrefersNewestRuntimeHomeReplica()
    result.assertions.missing_acp_session_prefers_newest_runtime_home_replica = true

    await verifyRuntimeManagerLocalMissingSessionRebuildsAndBinds()
    result.assertions.runtime_manager_local_missing_session_rebuilds_and_binds = true

    await verifyRuntimeManagerRemoteMissingSessionRebuildsAndBinds()
    result.assertions.runtime_manager_remote_missing_session_rebuilds_and_binds = true

    await verifyStaleActivateFailureDoesNotClearNewSelectionPending()
    result.assertions.stale_activate_failure_does_not_clear_new_selection_pending = true

    await verifyStaleCloseDoesNotClearNewSelection()
    result.assertions.stale_close_does_not_clear_new_selection = true

    await verifyStaleForkDoesNotSelectFork()
    result.assertions.stale_fork_does_not_select_fork = true

    await verifyStaleCreateDoesNotOverrideNewSelection()
    result.assertions.stale_create_does_not_override_new_selection = true

    await verifyStaleSettingsFailureDoesNotClearNewSelectionPending()
    result.assertions.stale_settings_failure_does_not_clear_new_selection_pending = true
  }

  result.ok = true
} finally {
  console.log(JSON.stringify(result, null, 2))
}

function verifyPlanMergesWithinTurn() {
  const state = buildConversationState(
    [
      createEvent("evt-user-1", "user_message_chunk", { text: "hello" }),
      createEvent("evt-plan-1", "plan", {
        explanation: "first plan",
        plan: [{ step: "step one", status: "pending" }],
      }),
      createEvent("evt-plan-2", "plan", {
        explanation: "updated plan",
        plan: [{ step: "step one", status: "completed" }],
      }),
    ],
    false,
  )

  const planBlocks = state.blocks.filter((block: ConversationBlock) => block.type === "plan")
  assert(planBlocks.length === 1, "same turn should keep exactly one plan block")
  const firstPlanBlock = planBlocks[0] as ConversationBlock
  assert(firstPlanBlock?.key === "turn-1:plan", "same turn plan should use a stable turn key")
  assert(firstPlanBlock?.message === "updated plan", "latest plan event should replace the previous message")
  assertJsonEqual(
    firstPlanBlock?.entries,
    [{ status: "completed", text: "step one" }],
    "latest plan event should replace the previous entries",
  )
}

function verifyPlanSeparatesAcrossTurns() {
  const state = buildConversationState(
    [
      createEvent("evt-user-1", "user_message_chunk", { text: "first turn" }),
      createEvent("evt-plan-1", "plan", {
        explanation: "turn one plan",
        plan: [{ step: "step one", status: "pending" }],
      }),
      createEvent("evt-user-2", "user_message_chunk", { text: "second turn" }),
      createEvent("evt-plan-2", "plan", {
        explanation: "turn two plan",
        plan: [{ step: "step two", status: "in_progress" }],
      }),
    ],
    false,
  )

  const planBlocks = state.blocks.filter((block: ConversationBlock) => block.type === "plan")
  assert(planBlocks.length === 2, "different turns should keep independent plan blocks")
  assertJsonEqual(
    planBlocks.map((block: ConversationBlock) => block.key),
    ["turn-1:plan", "turn-2:plan"],
    "plan blocks should be grouped by turn",
  )
}

function verifyTodoPlanRendersAsTodoBlock() {
  const state = buildConversationState(
    [
      createEvent("evt-user-1", "user_message_chunk", { text: "todo turn" }),
      createEvent("evt-plan-1", "plan", {
        entries: [
          { content: "collect logs", status: "pending" },
          { content: "fix race", status: "in_progress" },
        ],
      }),
    ],
    false,
  )

  const todoBlocks = state.blocks.filter((block: ConversationBlock) => block.type === "todo")
  const planBlocks = state.blocks.filter((block: ConversationBlock) => block.type === "plan")
  assert(todoBlocks.length === 1, "todo-shaped plan events should render as one todo block")
  assert(planBlocks.length === 0, "todo-shaped plan events should not render as a plan block")
  const firstTodoBlock = todoBlocks[0] as ConversationBlock
  assertJsonEqual(
    firstTodoBlock?.todos,
    [
      { status: "pending", content: "collect logs" },
      { status: "in_progress", content: "fix race" },
    ],
    "todo-shaped plan events should map entries into todo items",
  )
}

function verifyTodoPlanUpdatesWithinTurn() {
  const state = buildConversationState(
    [
      createEvent("evt-user-1", "user_message_chunk", { text: "todo turn" }),
      createEvent("evt-plan-1", "plan", {
        entries: [{ content: "collect logs", status: "pending" }],
      }),
      createEvent("evt-plan-2", "plan", {
        entries: [
          { content: "collect logs", status: "completed" },
          { content: "write regression", status: "in_progress" },
        ],
      }),
    ],
    false,
  )

  const todoBlocks = state.blocks.filter((block: ConversationBlock) => block.type === "todo")
  assert(todoBlocks.length === 1, "same turn todo-plan events should keep one todo block")
  const firstTodoBlock = todoBlocks[0] as ConversationBlock
  assertJsonEqual(
    firstTodoBlock?.todos,
    [
      { status: "completed", content: "collect logs" },
      { status: "in_progress", content: "write regression" },
    ],
    "latest todo-plan event should replace previous todo entries",
  )
}

async function verifyCancel409ConvergesToIdle() {
  const error = new Error("session does not have an active prompt to cancel") as Error & { status?: number }
  error.status = 409
  const state = createState({
    currentSessionId: "bs_1",
    isRunning: true,
  })
  const actions = createInteractionActions(
    createInput(state, {
      cancelSessionPrompt: async () => Promise.reject(error),
    }),
  )

  await actions.cancelPrompt()

  assert(state.isSubmitting === false, "cancel 409 should clear submitting state")
  assert(state.isRunning === false, "cancel 409 should clear running state")
  assert(state.isCancelling === false, "cancel 409 should clear cancelling state")
  assert(typeof state.flash === "string" && state.flash.length > 0, "cancel 409 should explain the convergence")
}

async function verifyQuestionSubmissionRemovesPending() {
  const questionEvent = createEvent("evt-question-1", "question_requested", {
    requestId: "q1",
    message: "Need answer",
  })
  const questionEvent2 = createEvent("evt-question-2", "question_requested", {
    requestId: "q2",
    message: "Need another answer",
  })
  const state = createState({
    currentSessionId: "bs_1",
    eventBuffer: [questionEvent, questionEvent2],
    conversationState: buildConversationState([questionEvent, questionEvent2], false),
    pendingQuestions: [{ requestId: "q1" }, { requestId: "q2" }],
  })
  const actions = createInteractionActions(
    createInput(state, {
      questionRespond: async () => ({ success: true }),
    }),
  )

  await actions.respondQuestion("q1", "accept", { language: "ts" })

  assertJsonEqual(
    state.pendingQuestions,
    [{ requestId: "q2", message: "Need another answer" }],
    "question submission should remove only the answered pending question",
  )
  assert(state.respondingQuestionIds.has("q1"), "question submission should track the responding request id")
  assert(state.isRunning === false, "accepted question should not claim running before upstream resumes")
  assert(state.awaitingTurnRestart === false, "accepted question should unlock the next upstream resume")
}

async function verifyPermissionSubmissionRemovesPending() {
  const permissionEvent = createEvent("evt-permission-1", "permission_requested", {
    requestId: "p1",
    toolName: "read",
  })
  const permissionEvent2 = createEvent("evt-permission-2", "permission_requested", {
    requestId: "p2",
    toolName: "write",
  })
  const state = createState({
    currentSessionId: "bs_1",
    eventBuffer: [permissionEvent, permissionEvent2],
    conversationState: buildConversationState([permissionEvent, permissionEvent2], false),
    pendingPermissions: [{ requestId: "p1" }, { requestId: "p2" }],
  })
  const actions = createInteractionActions(
    createInput(state, {
      permissionRespond: async () => ({ success: true }),
    }),
  )

  await actions.respondPermission("p1", true, "allow")

  assertJsonEqual(
    state.pendingPermissions,
    [{ requestId: "p2", toolName: "write" }],
    "permission submission should remove only the handled pending permission",
  )
  assert(state.respondingPermissionIds.has("p1"), "permission submission should track the responding request id")
  assert(state.isRunning === false, "approved permission should not claim running before upstream resumes")
  assert(state.awaitingTurnRestart === false, "approved permission should unlock the next upstream resume")
}

function verifyRunningStateStopsOnInteractionRequest() {
  assert(
    deriveRunningState(true, { eventType: "question_requested" }) === false,
    "question request should stop the active running state until the user responds",
  )
  assert(
    deriveRunningState(true, { eventType: "permission_requested" }) === false,
    "permission request should stop the active running state until the user responds",
  )
}

function verifyPhaseStaysBusyWhileAwaitingQuestionResolution() {
  const phase = deriveConversationPhase({
    isCancelling: false,
    pendingQuestions: 0,
    respondingQuestions: 1,
    pendingPermissions: 0,
    respondingPermissions: 0,
    isSubmitting: false,
    isRunning: false,
  })

  assert(phase.id === "waiting_question", "submitted question should stay in waiting-question phase")
  assert(phase.isBusy === true, "submitted question should keep the conversation busy")
  assert(phase.canCancel === false, "submitted question should not expose a stale cancel action")
}

function verifyLateChunkAfterTurnCompletedDoesNotReopenRunning() {
  const flags = deriveRuntimeFlagsFromEvents([
    createEvent("evt-user-1", "user_message_chunk", { text: "hello" }),
    createEvent("evt-thought-1", "agent_thought_chunk", { text: "thinking" }),
    createEvent("evt-stop-1", "turn_completed", { stopReason: "end_turn" }),
    createEvent("evt-late-1", "agent_message_chunk", { text: "late chunk" }),
  ])

  assert(flags.isRunning === false, "late chunk after turn completion should not reopen running")
  assert(flags.awaitingTurnRestart === true, "late chunk after turn completion should keep waiting for a new turn")
}

function verifyLateChunkAfterTurnCompletedDoesNotUseDirectStreamPath() {
  assert(
    shouldStreamAssistantChunk({
      isRunning: false,
      runningChanged: false,
      structureChanged: false,
      latestAssistantBlock: { key: "turn-1:assistant:msg-1" },
      latestAssistantIndex: 0,
      renderedBlock: { key: "turn-1:assistant:msg-1", streaming: false },
    }) === false,
    "late assistant chunk should force a render refresh instead of using the direct streaming path",
  )

  assert(
    shouldStreamAssistantChunk({
      isRunning: true,
      runningChanged: false,
      structureChanged: false,
      latestAssistantBlock: { key: "turn-1:assistant:msg-1" },
      latestAssistantIndex: 0,
      renderedBlock: { key: "turn-1:assistant:msg-1", streaming: true },
    }) === true,
    "active assistant streaming should still use the direct text-node path",
  )
}

function verifyOutOfOrderTurnCompletionStillKeepsFullAssistantText() {
  const state = buildConversationState(
    [
      createEvent("evt-user-1", "user_message_chunk", { text: "hello" }),
      createEvent("evt-assistant-1", "agent_message_chunk", { text: "P" }),
      createEvent("evt-stop-1", "turn_completed", { stopReason: "end_turn" }),
      createEvent("evt-assistant-2", "agent_message_chunk", { text: "ING" }),
      createEvent("evt-assistant-3", "agent_message_chunk", { text: "-" }),
      createEvent("evt-assistant-4", "agent_message_chunk", { text: "123" }),
    ],
    false,
  )

  const blocks = finalizeConversationBlocks(state, false)
  const assistantBlocks = blocks.filter((block: ConversationBlock) => block.type === "assistant")

  assert(assistantBlocks.length === 1, "out-of-order completion should still keep one assistant block")
  assert(assistantBlocks[0]?.message === "PING-123", "late assistant chunks should still be reflected in the final assistant text")
}

async function verifyPermissionResolutionRegistersBeforeExposure() {
  let resolvePermission: ((value: {
    outcome: { outcome: "cancelled" }
    optionKind: string
  }) => void) | undefined
  let waitRegistered = false
  const events: string[] = []
  const client = new RuntimeShellClient(
    {
      cwd: "/workspace",
      businessSessionId: "bs_1",
      workerId: "worker_local",
      onEvent: async (event: { eventType: string }) => {
        events.push(event.eventType)
      },
    },
    {
      onPermissionRequested: () => {
        assert(waitRegistered, "permission resolver should be registered before exposing the permission request")
        resolvePermission?.({
          outcome: {
            outcome: "cancelled",
          },
          optionKind: "reject",
        })
      },
      waitForPermission: () => {
        waitRegistered = true
        return new Promise((resolve) => {
          resolvePermission = resolve
        })
      },
      onQuestionRequested: () => {},
      waitForQuestion: () => Promise.resolve({ action: "decline" }),
    },
  )

  const response = await client.requestPermission({
    sessionId: "ses_1",
    toolCall: {
      toolCallId: "perm_1",
      title: "external_directory",
      rawInput: { filepath: "/workspace" },
    },
    options: [{ optionId: "reject", kind: "reject_once", name: "Reject" }],
  })

  assert(response.outcome.outcome === "cancelled", "permission should resolve even when the user response arrives immediately")
  assertJsonEqual(events, ["permission_requested", "permission_resolved"], "permission flow should emit request and resolved events in order")
}

async function verifyQuestionResolutionRegistersBeforeExposure() {
  let resolveQuestion: ((value: {
    action: "accept"
    content: { answer: string }
  }) => void) | undefined
  let waitRegistered = false
  const events: string[] = []
  const client = new RuntimeShellClient(
    {
      cwd: "/workspace",
      businessSessionId: "bs_1",
      workerId: "worker_local",
      onEvent: async (event: { eventType: string }) => {
        events.push(event.eventType)
      },
    },
    {
      onPermissionRequested: () => {},
      waitForPermission: () => Promise.resolve({
        outcome: {
          outcome: "cancelled",
        },
      }),
      onQuestionRequested: () => {
        assert(waitRegistered, "question resolver should be registered before exposing the question request")
        resolveQuestion?.({
          action: "accept",
          content: { answer: "ok" },
        })
      },
      waitForQuestion: () => {
        waitRegistered = true
        return new Promise((resolve) => {
          resolveQuestion = resolve
        })
      },
    },
  )

  const response = await client.unstable_createElicitation({
    mode: "form",
    message: "Need input",
    requestedSchema: {
      type: "object",
      properties: {
        answer: {
          type: "string",
        },
      },
    },
    requestId: "q_1",
  })

  assert(response.action === "accept", "question should resolve even when the answer arrives immediately")
  assertJsonEqual(events, ["question_requested", "question_resolved"], "question flow should emit request and resolved events in order")
}

async function verifyUpstreamDrainWaitsForLateTrackedWrites() {
  const drain = createUpstreamDrainController(15)
  const completed: string[] = []
  let releaseFirst: (() => void) | undefined
  let releaseSecond: (() => void) | undefined
  const firstWrite = new Promise((resolve) => {
    releaseFirst = () => {
      completed.push("first")
      resolve(undefined)
    }
  })
  const secondWrite = new Promise((resolve) => {
    releaseSecond = () => {
      completed.push("second")
      resolve(undefined)
    }
  })

  drain.track(firstWrite)
  const waitTask = drain.waitForQuiet().then(() => {
    completed.push("wait")
  })

  releaseFirst?.()
  await new Promise((resolve) => setTimeout(resolve, 1))
  drain.track(secondWrite)
  await new Promise((resolve) => setTimeout(resolve, 20))
  assertJsonEqual(completed, ["first"], "waitForQuiet should not finish before later tracked writes settle")

  releaseSecond?.()
  await waitTask
  assertJsonEqual(completed, ["first", "second", "wait"], "waitForQuiet should finish after the latest tracked write settles")
}

function verifyTurnCompletedClearsSubmittingWithoutVisibleChunks() {
  let state = {
    isSubmitting: true,
    isRunning: false,
    awaitingTurnRestart: false,
    isCancelling: false,
  }

  const events = [
    createEvent("evt-user-1", "user_message_chunk", { text: "hello" }),
    createEvent("evt-stop-1", "turn_completed", { stopReason: "end_turn" }),
  ]

  events.forEach((event) => {
    const nextRuntimeFlags = deriveRuntimeFlagsFromEvents(events.slice(0, events.indexOf(event) + 1))
    state = {
      ...state,
      isRunning: nextRuntimeFlags.isRunning,
      awaitingTurnRestart: nextRuntimeFlags.awaitingTurnRestart,
      isSubmitting: nextRuntimeFlags.isRunning || nextRuntimeFlags.awaitingTurnRestart ? false : state.isSubmitting,
      isCancelling: false,
    }
  })

  assert(state.isSubmitting === false, "turn_completed should clear submitting even when no visible upstream chunk arrived")
  assert(state.isRunning === false, "turn_completed should keep running false")
}

async function verifySessionListPollDoesNotReloadDetailForChunkOnlyProgress() {
  let detailReloads = 0
  const input = {
    api: {
      sessionList: async () => ({
        items: [
          {
            id: "bs_1",
            title: "Session 1",
            status: "waiting_input",
            eventCount: 2,
            capabilityState: { modelId: "deepseek/deepseek-v4-flash" },
            pendingPermissions: [],
            pendingQuestions: [],
          },
        ],
        workspaces: [],
      }),
    },
    get: () => ({
      currentSessionId: "bs_1",
      user: { id: "u_1" },
      sessions: [
        {
          id: "bs_1",
          title: "Session 1",
          status: "waiting_input",
          eventCount: 1,
          capabilityState: { modelId: "deepseek/deepseek-v4-flash" },
          pendingPermissions: [],
          pendingQuestions: [],
        },
      ],
      eventBuffer: [createEvent("evt-user-1", "user_message_chunk", { text: "hello" })],
      isSubmitting: false,
      isRunning: true,
      isCancelling: false,
      pendingPermissions: [],
      pendingQuestions: [],
      respondingPermissionIds: new Set(),
      respondingQuestionIds: new Set(),
      isConnected: true,
      activeSSESessionId: "bs_1",
      loadSessionDetail: async () => {
        detailReloads += 1
      },
      disconnectSSE: () => {},
    }),
    set: () => {},
    resetConversationState: (patch: Record<string, unknown>) => patch,
  }

  await loadSessionSummaries(input as never)

  assert(detailReloads === 0, "chunk-only eventCount progress should not force a detail reload during streaming")
}

async function verifySessionListPollReloadsDetailWhenBusyStateDiverges() {
  let detailReloads = 0
  const input = {
    api: {
      sessionList: async () => ({
        items: [
          {
            id: "bs_1",
            title: "Session 1",
            status: "active",
            eventCount: 5,
            capabilityState: { modelId: "deepseek/deepseek-v4-flash" },
            pendingPermissions: [],
            pendingQuestions: [],
          },
        ],
        workspaces: [],
      }),
    },
    get: () => ({
      currentSessionId: "bs_1",
      user: { id: "u_1" },
      sessions: [
        {
          id: "bs_1",
          title: "Session 1",
          status: "active",
          eventCount: 4,
          capabilityState: { modelId: "deepseek/deepseek-v4-flash" },
          pendingPermissions: [],
          pendingQuestions: [],
        },
      ],
      eventBuffer: [
        createEvent("evt-user-1", "user_message_chunk", { text: "hello" }),
        createEvent("evt-thought-1", "agent_thought_chunk", { text: "thinking" }),
        createEvent("evt-tool-1", "tool_call", { toolCallId: "call_1", status: "pending", title: "task" }),
      ],
      isSubmitting: false,
      isRunning: true,
      isCancelling: false,
      pendingPermissions: [],
      pendingQuestions: [],
      respondingPermissionIds: new Set(),
      respondingQuestionIds: new Set(),
      isConnected: true,
      activeSSESessionId: "bs_1",
      loadSessionDetail: async () => {
        detailReloads += 1
      },
      disconnectSSE: () => {},
    }),
    set: () => {},
    resetConversationState: (patch: Record<string, unknown>) => patch,
  }

  await loadSessionSummaries(input as never)

  assert(detailReloads === 1, "session-list polling should realign detail when summary and local busy state diverge")
}

function verifySessionDetailStatusTracksTurnLifecycle() {
  let detail = {
    session: {
      id: "bs_1",
      status: "active",
    },
  }

  detail = mergeSessionDetail(detail, createEvent("evt-user-1", "user_message_chunk", { text: "hello" }))
  assert(detail.session.status === "waiting_input", "user turn start should mark the live session as waiting_input")

  detail = mergeSessionDetail(detail, createEvent("evt-question-1", "question_requested", { requestId: "q_1" }))
  assert(detail.session.status === "active", "interactive pause should expose the session as active and awaiting input")

  detail = mergeSessionDetail(detail, createEvent("evt-question-2", "question_resolved", { requestId: "q_1" }))
  assert(detail.session.status === "waiting_input", "resolved interaction should return the session to upstream-running state")

  detail = mergeSessionDetail(detail, createEvent("evt-stop-1", "turn_completed", { stopReason: "end_turn" }))
  assert(detail.session.status === "active", "turn completion should settle the session back to active idle state")
}

async function verifySessionDetailReloadKeepsVisibleQuestionRequest() {
  const questionEvent = createEvent("evt-question-1", "question_requested", {
    requestId: "q_1",
    message: "Need answer",
  })
  const state = {
    currentSessionId: "bs_1",
    sessionSelectionVersion: 1,
    user: { id: "u_1" },
    eventBuffer: [questionEvent],
    sessions: [],
    workspaces: [],
    seenEventIds: new Set(["evt-question-1"]),
    pendingPermissions: [],
    pendingQuestions: [{ requestId: "q_1", message: "Need answer" }],
    respondingPermissionIds: new Set(),
    respondingQuestionIds: new Set(),
    disconnectSSE: () => {},
  } as Record<string, any>
  const input = createDetailInput(state, {
    sessionDetail: async () => ({
      session: {
        id: "bs_1",
        status: "active",
        pendingPermissions: [],
        pendingQuestions: [],
      },
      // 中文/English: simulate a slightly older detail response that has not yet
      // persisted the question event while the local live state already has it.
      events: [],
    }),
  })

  const data = await loadCurrentSessionDetail(input as never)

  assert(
    data.events.some((event: { eventType?: string }) => event.eventType === "question_requested"),
    "detail reload should keep the live question event",
  )
  assert(state.pendingQuestions.length === 1, "detail reload should keep the visible pending question")
  assert(state.conversationBlocks.some((block: ConversationBlock) => block.type === "question"), "detail reload should keep the question block visible")
}

async function verifySessionDetailReloadKeepsRespondingQuestionState() {
  const questionEvent = createEvent("evt-question-1", "question_requested", {
    requestId: "q_1",
    message: "Need answer",
  })
  const state = {
    currentSessionId: "bs_1",
    sessionSelectionVersion: 1,
    user: { id: "u_1" },
    eventBuffer: [questionEvent],
    sessions: [],
    workspaces: [],
    seenEventIds: new Set(["evt-question-1"]),
    pendingPermissions: [],
    pendingQuestions: [],
    respondingPermissionIds: new Set(),
    respondingQuestionIds: new Set(["q_1"]),
    disconnectSSE: () => {},
  } as Record<string, any>
  const input = createDetailInput(state, {
    sessionDetail: async () => ({
      session: {
        id: "bs_1",
        status: "active",
        pendingPermissions: [],
        pendingQuestions: [{ requestId: "q_1", message: "Need answer" }],
      },
      events: [questionEvent],
    }),
  })

  await loadCurrentSessionDetail(input as never)

  assert(state.respondingQuestionIds.has("q_1"), "detail reload should keep the local responding question state")
  assert(state.pendingQuestions.length === 0, "detail reload should not re-open a question that is already responding locally")
}

async function verifySessionDetailReloadKeepsRespondingPermissionState() {
  const permissionEvent = createEvent("evt-permission-1", "permission_requested", {
    requestId: "p_1",
    toolName: "read",
  })
  const state = {
    currentSessionId: "bs_1",
    sessionSelectionVersion: 1,
    user: { id: "u_1" },
    eventBuffer: [permissionEvent],
    sessions: [],
    workspaces: [],
    seenEventIds: new Set(["evt-permission-1"]),
    pendingPermissions: [],
    pendingQuestions: [],
    respondingPermissionIds: new Set(["p_1"]),
    respondingQuestionIds: new Set(),
    disconnectSSE: () => {},
  } as Record<string, any>
  const input = createDetailInput(state, {
    sessionDetail: async () => ({
      session: {
        id: "bs_1",
        status: "active",
        pendingPermissions: [{ requestId: "p_1", toolName: "read" }],
        pendingQuestions: [],
      },
      events: [permissionEvent],
    }),
  })

  await loadCurrentSessionDetail(input as never)

  assert(state.respondingPermissionIds.has("p_1"), "detail reload should keep the local responding permission state")
  assert(state.pendingPermissions.length === 0, "detail reload should not re-open a permission that is already responding locally")
}

function verifyConversationViewReconcilesMissingPermissionBlock() {
  const permissionEvent = createEvent("evt-permission-1", "permission_requested", {
    requestId: "p_1",
    toolName: "read",
    options: [{ optionId: "allow", kind: "allow", name: "Allow" }],
  })
  const conversationState = createConversationState()
  const view = finalizeConversationView({
    conversationState,
    isRunning: false,
    eventBuffer: [permissionEvent],
    pendingPermissions: [{ requestId: "p_1", toolName: "read" }],
    pendingQuestions: [],
    respondingPermissionIds: new Set(),
    respondingQuestionIds: new Set(),
  })

  assert(
    view.conversationBlocks.some((block: ConversationBlock) => block.type === "permission" && block.data?.requestId === "p_1"),
    "conversation view should synthesize a visible permission block when waiting state outpaces rendered blocks",
  )
  assert(
    view.conversationVersion > conversationState.latestVersion,
    "conversation view should bump version when it synthesizes a missing interaction block",
  )
}

function verifyConversationViewReconcilesRespondingQuestionBlock() {
  const questionEvent = createEvent("evt-question-1", "question_requested", {
    requestId: "q_1",
    message: "Need answer",
  })
  const conversationState = createConversationState()
  const view = finalizeConversationView({
    conversationState,
    isRunning: false,
    eventBuffer: [questionEvent],
    pendingPermissions: [],
    pendingQuestions: [],
    respondingPermissionIds: new Set(),
    respondingQuestionIds: new Set(["q_1"]),
  })

  assert(
    view.conversationBlocks.some((block: ConversationBlock) => block.type === "question" && block.data?.requestId === "q_1"),
    "conversation view should keep a visible question block while the local response is still awaiting upstream confirmation",
  )
}

function verifyDebugConversationViewReconcilesMissingQuestionBlock() {
  const questionEvent = createEvent("evt-question-1", "question_requested", {
    requestId: "q_1",
    message: "Need answer",
  })
  const conversationState = buildConversationState([questionEvent], true)
  const view = finalizeConversationView({
    conversationState,
    isRunning: false,
    eventBuffer: [questionEvent],
    pendingPermissions: [],
    pendingQuestions: [{ requestId: "q_1", message: "Need answer" }],
    respondingPermissionIds: new Set(),
    respondingQuestionIds: new Set(),
  })

  assert(
    view.conversationBlocks.some((block: ConversationBlock) => block.type === "question" && block.data?.requestId === "q_1"),
    "debug conversation replay should still reconcile a visible question block through the unified interaction view",
  )
}

async function verifyAttachmentLocalStatusKeepsVisiblePermissionBlock() {
  const permissionEvent = createEvent("evt-permission-1", "permission_requested", {
    requestId: "p_1",
    toolName: "read",
  })
  const state = {
    currentSessionId: "bs_1",
    eventBuffer: [permissionEvent],
    eventBufferVersion: 1,
    seenEventIds: new Set(["evt-permission-1"]),
    conversationState: buildConversationState([permissionEvent], false),
    conversationBlocks: finalizeConversationView({
      conversationState: buildConversationState([permissionEvent], false),
      isRunning: false,
      eventBuffer: [permissionEvent],
      pendingPermissions: [{ requestId: "p_1", toolName: "read" }],
      pendingQuestions: [],
      respondingPermissionIds: new Set(),
      respondingQuestionIds: new Set(),
    }).conversationBlocks,
    conversationVersion: 1,
    pendingPermissions: [{ requestId: "p_1", toolName: "read" }],
    pendingQuestions: [],
    respondingPermissionIds: new Set(),
    respondingQuestionIds: new Set(),
    isSubmitting: false,
    isRunning: false,
    awaitingTurnRestart: false,
    isCancelling: false,
    flash: "",
  } as Record<string, any>
  const actions = createInteractionActions(
    createInput(state as State, {
      sendInput: async (_businessSessionId: string, parts: unknown[]) => {
        assert(Array.isArray(parts) && parts.length >= 2, "attachment prompt should include text and attachment payloads")
        return { success: true }
      },
    }) as never,
  )

  const file = {
    name: "note.txt",
    type: "text/plain",
    text: async () => "hello",
  }

  await actions.sendPrompt("with attachment", [file] as never)

  assert(
    state.conversationBlocks.some((block: ConversationBlock) => block.type === "permission" && block.data?.requestId === "p_1"),
    "attachment-local status feedback should not bypass the unified interaction view or hide an open permission block",
  )
}

async function verifyActivateFailureClearsPendingSessionAction() {
  const state = createActivationState({
    currentSessionId: "bs_orphaned",
    sessions: [
      {
        id: "bs_orphaned",
        title: "Lost workspace",
        status: "orphaned",
        binding: { acpSessionId: null },
      },
    ],
  })

  await activateCurrentSession(
    createActivationInput(state, {
      openSession: async () => {
        throw new Error("runtime lease expired")
      },
    }) as never,
  ).catch(() => undefined)

  assert(state.pendingSessionAction === "", "failed automatic activation should release the session pending action")
  assert(
    state.flash.includes("打开会话失败") && state.flash.includes("runtime lease expired"),
    "failed automatic activation should surface the open failure",
  )
}

async function verifyOrphanedSessionWithBindingResumesInsteadOfOpening() {
  const calls: string[] = []
  const state = createActivationState({
    currentSessionId: "bs_orphaned",
    sessions: [
      {
        id: "bs_orphaned",
        title: "Recoverable session",
        status: "orphaned",
        binding: { acpSessionId: "ses_existing" },
      },
    ],
  })

  await activateCurrentSession(
    createActivationInput(state, {
      openSession: async () => {
        calls.push("open")
        return { success: true }
      },
      resumeSession: async () => {
        calls.push("resume")
        return { success: true }
      },
    }) as never,
  )

  assert(calls.length === 1 && calls[0] === "resume", "recoverable orphaned session should resume the persisted ACP session instead of opening a fresh one")
}

async function verifyMissingAcpSessionRebuildsFromRuntimeHome() {
  const root = await mkdtemp(path.join(tmpdir(), "runtime-shell-rebuild-"))
  try {
    const runtimeHomeRootDir = path.join(root, ".runtime-home")
    const dbDir = path.join(runtimeHomeRootDir, "worker_local", "runtime", "ws_rebuild", ".local", "share", "opencode")
    await mkdir(dbDir, { recursive: true })
    const dbPath = path.join(dbDir, "opencode.db")
    const db = new Database(dbPath)
    try {
      db.exec(`create table session (
        id text primary key,
        project_id text not null,
        workspace_id text,
        parent_id text,
        slug text not null,
        directory text not null,
        path text,
        title text not null,
        version text not null,
        share_url text,
        summary_additions integer,
        summary_deletions integer,
        summary_files integer,
        summary_diffs text,
        cost real not null default 0,
        tokens_input integer not null default 0,
        tokens_output integer not null default 0,
        tokens_reasoning integer not null default 0,
        tokens_cache_read integer not null default 0,
        tokens_cache_write integer not null default 0,
        revert text,
        permission text,
        agent text,
        model text,
        time_created integer not null,
        time_updated integer not null,
        time_compacting integer,
        time_archived integer
      )`)
      db.exec("create table message (id text primary key, session_id text not null, time_created integer not null, time_updated integer not null, data text not null)")
      db.exec("create table part (id text primary key, message_id text not null, session_id text not null, time_created integer not null, time_updated integer not null, data text not null)")
      db.exec("create table session_message (id text primary key, session_id text not null, type text not null, time_created integer not null, time_updated integer not null, data text not null)")
      db.exec("create table todo (session_id text not null, content text not null, status text not null, priority text not null, position integer not null, time_created integer not null, time_updated integer not null, primary key(session_id, position))")
      db.exec(`
        insert into session (
          id, project_id, workspace_id, parent_id, slug, directory, path, title, version,
          revert, cost, tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write,
          time_created, time_updated, time_compacting
        ) values (
          'ses_missing_history', 'proj_1', 'ws_rebuild', null, 'slug_1', '/workspace', null, 'History', '1.0.0',
          json('{"messageID":"msg_old","partID":"prt_old"}'), 0, 0, 0, 0, 0, 0, 1, 2, 999
        )
      `)
      db.query("insert into message (id, session_id, time_created, time_updated, data) values (?, ?, ?, ?, ?)").run(
        "msg_old",
        "ses_missing_history",
        10,
        10,
        JSON.stringify({
          role: "user",
          sessionID: "ses_missing_history",
          model: { providerID: "openai", modelID: "gpt-5" },
        }),
      )
      db.query("insert into part (id, message_id, session_id, time_created, time_updated, data) values (?, ?, ?, ?, ?, ?)").run(
        "prt_old",
        "msg_old",
        "ses_missing_history",
        10,
        10,
        JSON.stringify({
          type: "text",
          text: "hello",
          sessionID: "ses_missing_history",
          messageID: "msg_old",
        }),
      )
      db.query("insert into session_message (id, session_id, type, time_created, time_updated, data) values (?, ?, ?, ?, ?, ?)").run(
        "evt_old",
        "ses_missing_history",
        "prompted",
        11,
        11,
        JSON.stringify({
          sessionID: "ses_missing_history",
          messageID: "msg_old",
        }),
      )
      db.query("insert into todo (session_id, content, status, priority, position, time_created, time_updated) values (?, ?, ?, ?, ?, ?, ?)").run(
        "ses_missing_history",
        "rebuild",
        "pending",
        "medium",
        0,
        12,
        12,
      )
    } finally {
      db.close(false)
    }

    const rebuilt = await rebuildMissingAcpSessionFromRuntimeHome({
      session: {
        id: "bs_1",
        tenantId: "t_1",
        organizationId: "o_1",
        workspaceId: "ws_rebuild",
        title: "Recoverable",
        projectId: "proj_1",
        workspacePath: "/workspace",
        workerId: "worker_local",
        status: "orphaned",
        createdBy: "u_1",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      missingAcpSessionId: "ses_missing_history",
      runtimeHomeRootDir,
    })

    assert(rebuilt.sessionId !== "ses_missing_history", "rebuilt ACP session should get a fresh session id")

    const verifyDb = new Database(dbPath, { readonly: true })
    try {
      const rebuiltSession = verifyDb.query("select id, title, revert, time_compacting from session where id = ?").get(rebuilt.sessionId) as Record<string, unknown> | null
      const rebuiltMessage = verifyDb.query("select session_id, data from message where session_id = ?").get(rebuilt.sessionId) as Record<string, unknown> | null
      const rebuiltPart = verifyDb.query("select session_id, message_id, data from part where session_id = ?").get(rebuilt.sessionId) as Record<string, unknown> | null
      const rebuiltTodo = verifyDb.query("select content from todo where session_id = ?").get(rebuilt.sessionId) as Record<string, unknown> | null
      assert(Boolean(rebuiltSession), "rebuilt session row should exist")
      assert(rebuiltSession?.title === "History", "rebuilt session should preserve session metadata")
      assert(Boolean(rebuiltMessage), "rebuilt message row should exist")
      assert(Boolean(rebuiltPart), "rebuilt part row should exist")
      assert(Boolean(rebuiltTodo), "rebuilt todo row should exist")
      const rebuiltPartData = JSON.parse(String(rebuiltPart?.data))
      const rebuiltRevert = rebuiltSession?.revert ? JSON.parse(String(rebuiltSession.revert)) : null
      assert(rebuiltMessage?.session_id === rebuilt.sessionId, "rebuilt message row should point to the new session id")
      assert(rebuiltPart?.session_id === rebuilt.sessionId, "rebuilt part row should point to the new session id")
      assert(rebuiltPart?.message_id !== "msg_old", "rebuilt part row should point to the remapped message id")
      assert(rebuiltPartData.messageID !== "msg_old", "rebuilt part data should point to the remapped message id")
      assert(rebuiltRevert?.messageID !== "msg_old", "rebuilt revert should point to the remapped message id")
      assert(rebuiltRevert?.partID !== "prt_old", "rebuilt revert should point to the remapped part id")
      assert(rebuiltSession?.time_compacting == null, "rebuilt session should not preserve an in-progress compaction flag")
    } finally {
      verifyDb.close(false)
    }
  } finally {
    await rm(root, { recursive: true, force: true }).catch(() => {})
  }
}

async function verifyMissingAcpSessionRebuildPreservesStableOrdering() {
  const root = await mkdtemp(path.join(tmpdir(), "runtime-shell-order-"))
  try {
    const runtimeHomeRootDir = path.join(root, ".runtime-home")
    const dbDir = path.join(runtimeHomeRootDir, "worker_local", "runtime", "ws_rebuild", ".local", "share", "opencode")
    await mkdir(dbDir, { recursive: true })
    const dbPath = path.join(dbDir, "opencode.db")
    const db = new Database(dbPath)
    try {
      db.exec(`create table session (
        id text primary key,
        project_id text not null,
        workspace_id text,
        parent_id text,
        slug text not null,
        directory text not null,
        path text,
        title text not null,
        version text not null,
        share_url text,
        summary_additions integer,
        summary_deletions integer,
        summary_files integer,
        summary_diffs text,
        cost real not null default 0,
        tokens_input integer not null default 0,
        tokens_output integer not null default 0,
        tokens_reasoning integer not null default 0,
        tokens_cache_read integer not null default 0,
        tokens_cache_write integer not null default 0,
        revert text,
        permission text,
        agent text,
        model text,
        time_created integer not null,
        time_updated integer not null,
        time_compacting integer,
        time_archived integer
      )`)
      db.exec("create table message (id text primary key, session_id text not null, time_created integer not null, time_updated integer not null, data text not null)")
      db.exec("create table part (id text primary key, message_id text not null, session_id text not null, time_created integer not null, time_updated integer not null, data text not null)")
      db.exec("create table session_message (id text primary key, session_id text not null, type text not null, time_created integer not null, time_updated integer not null, data text not null)")
      db.exec("create table todo (session_id text not null, content text not null, status text not null, priority text not null, position integer not null, time_created integer not null, time_updated integer not null, primary key(session_id, position))")
      db.exec(`
        insert into session (
          id, project_id, workspace_id, parent_id, slug, directory, path, title, version,
          cost, tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write,
          time_created, time_updated
        ) values (
          'ses_missing_history', 'proj_1', 'ws_rebuild', null, 'slug_1', '/workspace', null, 'History', '1.0.0',
          0, 0, 0, 0, 0, 0, 1, 100
        )
      `)
      db.query("insert into message (id, session_id, time_created, time_updated, data) values (?, ?, ?, ?, ?)").run(
        "msg_b",
        "ses_missing_history",
        10,
        10,
        JSON.stringify({
          role: "user",
          sessionID: "ses_missing_history",
          model: { providerID: "openai", modelID: "gpt-5" },
        }),
      )
      db.query("insert into message (id, session_id, time_created, time_updated, data) values (?, ?, ?, ?, ?)").run(
        "msg_a",
        "ses_missing_history",
        10,
        10,
        JSON.stringify({
          role: "assistant",
          sessionID: "ses_missing_history",
          parentID: "msg_b",
          model: { providerID: "openai", modelID: "gpt-5" },
        }),
      )
      db.query("insert into part (id, message_id, session_id, time_created, time_updated, data) values (?, ?, ?, ?, ?, ?)").run(
        "prt_b",
        "msg_a",
        "ses_missing_history",
        20,
        20,
        JSON.stringify({
          type: "text",
          text: "second",
          sessionID: "ses_missing_history",
          messageID: "msg_a",
        }),
      )
      db.query("insert into part (id, message_id, session_id, time_created, time_updated, data) values (?, ?, ?, ?, ?, ?)").run(
        "prt_a",
        "msg_a",
        "ses_missing_history",
        20,
        20,
        JSON.stringify({
          type: "compaction",
          auto: true,
          tail_start_id: "msg_b",
          sessionID: "ses_missing_history",
          messageID: "msg_a",
        }),
      )
      db.query("insert into session_message (id, session_id, type, time_created, time_updated, data) values (?, ?, ?, ?, ?, ?)").run(
        "evt_b",
        "ses_missing_history",
        "assistant",
        30,
        30,
        JSON.stringify({
          messageID: "msg_b",
          sessionID: "ses_missing_history",
          time: { created: 30 },
        }),
      )
      db.query("insert into session_message (id, session_id, type, time_created, time_updated, data) values (?, ?, ?, ?, ?, ?)").run(
        "evt_a",
        "ses_missing_history",
        "compaction",
        30,
        30,
        JSON.stringify({
          messageID: "msg_a",
          sessionID: "ses_missing_history",
          time: { created: 30 },
        }),
      )
    } finally {
      db.close(false)
    }

    const rebuilt = await rebuildMissingAcpSessionFromRuntimeHome({
      session: {
        id: "bs_1",
        tenantId: "t_1",
        organizationId: "o_1",
        workspaceId: "ws_rebuild",
        title: "Recoverable",
        projectId: "proj_1",
        workspacePath: "/workspace",
        workerId: "worker_local",
        status: "orphaned",
        createdBy: "u_1",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      missingAcpSessionId: "ses_missing_history",
      runtimeHomeRootDir,
    })

    const verifyDb = new Database(dbPath, { readonly: true })
    try {
      const rebuiltMessages = verifyDb.query("select id, data from message where session_id = ? order by time_created asc, id asc").all(rebuilt.sessionId) as Array<Record<string, unknown>>
      const rebuiltParts = verifyDb.query("select id, message_id, data from part where session_id = ? order by message_id asc, id asc").all(rebuilt.sessionId) as Array<Record<string, unknown>>
      const rebuiltSessionMessages = verifyDb.query("select id, data from session_message where session_id = ? order by time_created asc, id asc").all(rebuilt.sessionId) as Array<Record<string, unknown>>

      assertJsonEqual(
        rebuiltMessages.map((row) => row.id),
        [
          "msg_000000000000_" + rebuilt.sessionId.slice(4),
          "msg_000000000001_" + rebuilt.sessionId.slice(4),
        ],
        "rebuilt messages should get deterministic ordered ids so same-timestamp ordering stays stable",
      )

      const rebuiltMessageData = rebuiltMessages.map((row) => ({
        id: String(row.id),
        data: JSON.parse(String(row.data)) as Record<string, unknown>,
      }))
      const rebuiltAssistantMessage = rebuiltMessageData.find((row) => row.data.role === "assistant")
      const rebuiltUserMessage = rebuiltMessageData.find((row) => row.data.role === "user")
      assert(
        rebuiltAssistantMessage?.data.parentID === rebuiltUserMessage?.id,
        "rebuilt message parentID should remap forward message references to the deterministic rebuilt message id",
      )

      assertJsonEqual(
        rebuiltParts.map((row) => row.id),
        [
          "prt_000000000000_" + rebuilt.sessionId.slice(4),
          "prt_000000000001_" + rebuilt.sessionId.slice(4),
        ],
        "rebuilt parts should get deterministic ordered ids so same-timestamp ordering stays stable",
      )

      const rebuiltCompactionPart = JSON.parse(String(rebuiltParts[0]?.data))
      const rebuiltTextPart = JSON.parse(String(rebuiltParts[1]?.data))
      assert(
        rebuiltCompactionPart.tail_start_id === rebuiltUserMessage?.id,
        "rebuilt compaction part should remap tail_start_id to the rebuilt message id",
      )
      assert(
        rebuiltTextPart.messageID === rebuiltAssistantMessage?.id,
        "rebuilt text part should point at the rebuilt assistant message id",
      )

      assertJsonEqual(
        rebuiltSessionMessages.map((row) => row.id),
        [
          "evt_000000000000_" + rebuilt.sessionId.slice(4),
          "evt_000000000001_" + rebuilt.sessionId.slice(4),
        ],
        "rebuilt session messages should get deterministic ordered ids so same-timestamp ordering stays stable",
      )
    } finally {
      verifyDb.close(false)
    }
  } finally {
    await rm(root, { recursive: true, force: true }).catch(() => {})
  }
}

async function verifyMissingAcpSessionPrefersNewestRuntimeHomeReplica() {
  const root = await mkdtemp(path.join(tmpdir(), "runtime-shell-replica-"))
  try {
    const runtimeHomeRootDir = path.join(root, ".runtime-home")
    const coldDbDir = path.join(runtimeHomeRootDir, "worker_local", "runtime", "ws_rebuild", ".local", "share", "opencode")
    const warmDbDir = path.join(runtimeHomeRootDir, "worker_local", "warm", "warm_slot_latest", ".local", "share", "opencode")
    await mkdir(coldDbDir, { recursive: true })
    await mkdir(warmDbDir, { recursive: true })
    const coldDbPath = path.join(coldDbDir, "opencode.db")
    const warmDbPath = path.join(warmDbDir, "opencode.db")

    seedReplicaDatabase(coldDbPath, {
      title: "older",
      sessionUpdatedAt: 10,
      messageText: "old history",
    })
    seedReplicaDatabase(warmDbPath, {
      title: "latest",
      sessionUpdatedAt: 99,
      messageText: "new history",
    })

    const rebuilt = await rebuildMissingAcpSessionFromRuntimeHome({
      session: {
        id: "bs_1",
        tenantId: "t_1",
        organizationId: "o_1",
        workspaceId: "ws_rebuild",
        title: "Recoverable",
        projectId: "proj_1",
        workspacePath: "/workspace",
        workerId: "worker_local",
        status: "orphaned",
        createdBy: "u_1",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      missingAcpSessionId: "ses_missing_history",
      runtimeHomeRootDir,
    })

    const verifyWarmDb = new Database(warmDbPath, { readonly: true })
    try {
      const rebuiltSession = verifyWarmDb.query("select title from session where id = ?").get(rebuilt.sessionId) as Record<string, unknown> | null
      const rebuiltTodo = verifyWarmDb.query("select content from todo where session_id = ?").get(rebuilt.sessionId) as Record<string, unknown> | null
      assert(rebuiltSession?.title === "latest", "rebuild should choose the newest runtime-home replica")
      assert(rebuiltTodo?.content === "new history", "rebuilt history should come from the newest replica")
    } finally {
      verifyWarmDb.close(false)
    }
  } finally {
    await rm(root, { recursive: true, force: true }).catch(() => {})
  }
}

async function verifyRuntimeManagerLocalMissingSessionRebuildsAndBinds() {
  const calls: string[] = []
  let boundResponse: Record<string, unknown> | undefined
  const session = createRecoverableBusinessSession()

  await recoverMissingAcpSessionForTest({
    session,
    acpSessionId: "ses_missing_history",
    step: "loadSession",
    client: {
      loadSession: async (cwd, sessionId) => {
        calls.push(`load:${cwd}:${sessionId}`)
        return {
          configOptions: [{ id: "history", value: "on" }],
          models: [{ id: "gpt-5", name: "GPT-5" }],
          modes: [{ id: "build", name: "Build" }],
        } as never
      },
      getSessionId: () => "",
    },
    rebuildMissingAcpSession: async ({ missingAcpSessionId }) => {
      calls.push(`rebuild-db:${missingAcpSessionId}`)
      return { sessionId: "ses_rebuilt_local" }
    },
    bindRecoveredRuntime: async (_targetSession, _targetClient, response) => {
      boundResponse = response as Record<string, unknown>
      calls.push(`bind:${String(response.sessionId)}`)
      return { client: null, transport: "real" } as never
    },
  })

  assertJsonEqual(
    calls,
    [
      "rebuild-db:ses_missing_history",
      "load:/workspace:ses_rebuilt_local",
      "bind:ses_rebuilt_local",
    ],
    "local missing-session recovery should rebuild from runtime-home, load the rebuilt ACP session, then bind it",
  )
  assert(boundResponse?.sessionId === "ses_rebuilt_local", "local recovery should bind the rebuilt ACP session id")
  assertJsonEqual(
    boundResponse?.configOptions,
    [{ id: "history", value: "on" }],
    "local recovery should preserve loaded config options when rebinding",
  )
}

async function verifyRuntimeManagerRemoteMissingSessionRebuildsAndBinds() {
  const calls: string[] = []
  let boundResponse: Record<string, unknown> | undefined
  const session = createRecoverableBusinessSession()

  await recoverMissingAcpSessionForTest({
    session,
    acpSessionId: "ses_missing_history",
    step: "resumeSession",
    client: {
      loadSession: async () => {
        throw new Error("remote recovery should not fall back to loadSession when rebuildSession is available")
      },
      rebuildSession: async (cwd, sessionId) => {
        calls.push(`rebuild-remote:${cwd}:${sessionId}`)
        return {
          configOptions: [{ id: "history", value: "remote" }],
          models: [{ id: "gpt-5", name: "GPT-5" }],
          modes: [{ id: "plan", name: "Plan" }],
        } as never
      },
      getSessionId: () => "ses_rebuilt_remote",
    },
    rebuildMissingAcpSession: async () => {
      throw new Error("remote recovery should not rebuild the ACP session from the shell-side runtime-home")
    },
    bindRecoveredRuntime: async (_targetSession, _targetClient, response) => {
      boundResponse = response as Record<string, unknown>
      calls.push(`bind:${String(response.sessionId)}`)
      return { client: null, transport: "real" } as never
    },
  })

  assertJsonEqual(
    calls,
    [
      "rebuild-remote:/workspace:ses_missing_history",
      "bind:ses_rebuilt_remote",
    ],
    "remote missing-session recovery should let the worker rebuild the ACP session, then bind the returned session id",
  )
  assert(boundResponse?.sessionId === "ses_rebuilt_remote", "remote recovery should bind the worker-returned ACP session id")
  assertJsonEqual(
    boundResponse?.configOptions,
    [{ id: "history", value: "remote" }],
    "remote recovery should preserve rebuilt remote config options when rebinding",
  )
}

async function verifyStaleActivateFailureDoesNotClearNewSelectionPending() {
  const state = createActivationState({
    currentSessionId: "bs_old",
    sessions: [
      {
        id: "bs_old",
        title: "Old session",
        status: "orphaned",
        binding: { acpSessionId: null },
      },
    ],
  })

  await activateCurrentSession(
    createActivationInput(state, {
      openSession: async () => {
        state.currentSessionId = "bs_new"
        state.sessionSelectionVersion += 1
        state.pendingSessionAction = "activate"
        throw new Error("old session failed late")
      },
    }) as never,
  ).catch(() => undefined)

  assert(state.currentSessionId === "bs_new", "stale activation failure should not change the new selection")
  assert(state.pendingSessionAction === "activate", "stale activation failure should not clear the new session pending action")
  assert(state.flash === "", "stale activation failure should not show an error for the previous selection")
}

async function verifyStaleCloseDoesNotClearNewSelection() {
  const state = createLifecycleState({
    currentSessionId: "bs_old",
    sessionSelectionVersion: 3,
    pendingSessionAction: "activate",
  })

  await closeCurrentSessionAndReset(
    createLifecycleInput(state, {
      closeSession: async () => {
        state.currentSessionId = "bs_new"
        state.sessionSelectionVersion += 1
        state.pendingSessionAction = "activate"
        return { success: true }
      },
    }) as never,
  )

  assert(state.currentSessionId === "bs_new", "stale close should not clear the newer selected session")
  assert(state.pendingSessionAction === "activate", "stale close should not clear the newer session pending action")
  assert(state.disconnected === false, "stale close should not disconnect the newer session SSE")
}

async function verifyStaleForkDoesNotSelectFork() {
  const state = createLifecycleState({
    currentSessionId: "bs_old",
    sessionSelectionVersion: 5,
    pendingSessionAction: "activate",
  })

  await forkCurrentSessionAndSelect(
    createLifecycleInput(state, {
      forkSession: async () => {
        state.currentSessionId = "bs_new"
        state.sessionSelectionVersion += 1
        state.pendingSessionAction = "activate"
        return { id: "bs_fork", title: "Forked" }
      },
    }) as never,
    "Forked",
  )

  assert(state.currentSessionId === "bs_new", "stale fork should not switch the current selection to the fork")
  assert(state.pendingSessionAction === "activate", "stale fork should not clear the newer session pending action")
}

async function verifyStaleCreateDoesNotOverrideNewSelection() {
  const state = createLifecycleState({
    currentSessionId: "bs_existing",
    sessionSelectionVersion: 7,
    sessions: [{ id: "bs_existing", title: "Existing" }],
    pendingSessionAction: "activate",
  })

  await createSessionAndActivate(
    createLifecycleInput(state, {
      createSession: async () => {
        state.currentSessionId = "bs_new"
        state.sessionSelectionVersion += 1
        state.pendingSessionAction = "activate"
        return { id: "bs_created", title: "Created", pendingPermissions: [], pendingQuestions: [] }
      },
    }) as never,
    "Created",
    "project_1",
    "workspace_1",
  )

  assert(state.currentSessionId === "bs_new", "stale create should not override the newer selected session")
  assert(state.pendingSessionAction === "activate", "stale create should not clear the newer session pending action")
  assert(
    state.sessions.some((session: { id?: string }) => session.id === "bs_created"),
    "stale create should still add the created session to the list",
  )
}

async function verifyStaleSettingsFailureDoesNotClearNewSelectionPending() {
  const state = createLifecycleState({
    currentSessionId: "bs_old",
    sessionSelectionVersion: 9,
    pendingSettingsAction: "config",
  })

  await updateCurrentSessionMode(
    createLifecycleInput(state, {
      updateMode: async () => {
        state.currentSessionId = "bs_new"
        state.sessionSelectionVersion += 1
        state.pendingSettingsAction = "model"
        throw new Error("old mode update failed late")
      },
    }) as never,
    "plan",
  ).catch(() => undefined)

  assert(state.currentSessionId === "bs_new", "stale settings failure should not change the newer selection")
  assert(state.pendingSettingsAction === "model", "stale settings failure should not clear the newer settings pending action")
  assert(state.flash === "", "stale settings failure should not show an error for the previous selection")
}

function createInput(state: State, apiOverrides: Partial<Input["api"]>): Input {
  return {
    api: {
      cancelSessionPrompt: async () => ({ success: true }),
      sendInput: async () => ({ success: true }),
      permissionRespond: async () => ({ success: true }),
      questionRespond: async () => ({ success: true }),
      ...apiOverrides,
    },
    get: () => ({
      ...state,
      setFlash: (message: string) => {
        state.flash = message
      },
    }),
    set: (patch: Partial<State> | ((state: State) => Partial<State>)) => {
      const next = typeof patch === "function" ? patch(state) : patch
      Object.assign(state, next)
    },
  }
}

function createDetailInput(state: Record<string, any>, apiOverrides: Record<string, unknown>) {
  return {
    api: {
      sessionDetail: async () => ({
        session: null,
        events: [],
      }),
      ...apiOverrides,
    },
    get: () => state,
    set: (patch: Record<string, unknown> | ((state: Record<string, any>) => Record<string, unknown>)) => {
      const next = typeof patch === "function" ? patch(state) : patch
      Object.assign(state, next)
    },
    resetConversationState: (patch: Record<string, unknown>) => patch,
  }
}

function createState(overrides: Partial<State>): State {
  return {
    currentSessionId: "",
    eventBuffer: [],
    eventBufferVersion: 0,
    seenEventIds: new Set(),
    conversationState: createConversationState(),
    conversationBlocks: [],
    conversationVersion: 0,
    pendingPermissions: [],
    pendingQuestions: [],
    respondingPermissionIds: new Set(),
    respondingQuestionIds: new Set(),
    isSubmitting: false,
    isRunning: false,
    awaitingTurnRestart: false,
    isCancelling: false,
    flash: "",
    ...overrides,
  }
}

function createActivationInput(state: Record<string, any>, apiOverrides: Record<string, unknown>) {
  return {
    api: {
      loadSession: async () => ({ success: true }),
      openSession: async () => ({ success: true }),
      resumeSession: async () => ({ success: true }),
      ...apiOverrides,
    },
    get: () => ({
      ...state,
      loadSessionDetail: async () => ({ session: null }),
      connectSSE: () => {
        state.connected = true
      },
      setFlash: (message: string) => {
        state.flash = message
      },
    }),
    set: (patch: Record<string, unknown> | ((state: Record<string, any>) => Record<string, unknown>)) => {
      const next = typeof patch === "function" ? patch(state) : patch
      Object.assign(state, next)
    },
  }
}

function createActivationState(overrides: Record<string, unknown>) {
  return {
    currentSessionId: "",
    sessionSelectionVersion: 0,
    pendingSessionAction: "",
    sessions: [],
    sessionDetail: null,
    flash: "",
    connected: false,
    ...overrides,
  } as Record<string, any>
}

function createLifecycleInput(state: Record<string, any>, apiOverrides: Record<string, unknown>) {
  return {
    api: {
      createSession: async () => ({ id: "bs_created", title: "Created" }),
      closeSession: async () => ({ success: true }),
      forkSession: async () => ({ id: "bs_fork", title: "Forked" }),
      loadSessions: async () => ({ items: state.sessions, workspaces: state.workspaces }),
      updateMode: async () => ({ success: true }),
      updateModel: async () => ({ success: true }),
      updateConfig: async () => ({ success: true }),
      ...apiOverrides,
    },
    get: () => ({
      ...state,
      activateSession: async () => {
        state.activated = true
      },
      loadSessions: async () => {
        state.loadedSessions = true
      },
      loadSessionDetail: async () => {
        state.loadedDetail = true
      },
      disconnectSSE: () => {
        state.disconnected = true
      },
      setFlash: (message: string) => {
        state.flash = message
      },
    }),
    set: (patch: Record<string, unknown> | ((state: Record<string, any>) => Record<string, unknown>)) => {
      const next = typeof patch === "function" ? patch(state) : patch
      Object.assign(state, next)
    },
    resetConversationState: (patch: Record<string, unknown>) => patch,
  }
}

function createLifecycleState(overrides: Record<string, unknown>) {
  return {
    user: { id: "u_1" },
    currentSessionId: "",
    sessionSelectionVersion: 0,
    pendingSessionAction: "",
    pendingSettingsAction: "",
    sessions: [],
    workspaces: [],
    sessionDetail: null,
    flash: "",
    disconnected: false,
    activated: false,
    loadedSessions: false,
    loadedDetail: false,
    ...overrides,
  } as Record<string, any>
}

function createEvent(eventId: string, eventType: string, payload: Record<string, unknown>) {
  return { eventId, eventType, payload }
}

function createRecoverableBusinessSession() {
  return {
    id: "bs_1",
    tenantId: "t_1",
    organizationId: "o_1",
    workspaceId: "ws_rebuild",
    title: "Recoverable",
    projectId: "proj_1",
    workspacePath: "/workspace",
    workerId: "worker_local",
    status: "orphaned",
    createdBy: "u_1",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

function seedReplicaDatabase(
  dbPath: string,
  input: {
    title: string
    sessionUpdatedAt: number
    messageText: string
  },
) {
  const db = new Database(dbPath)
  try {
    db.exec(`create table session (
      id text primary key,
      project_id text not null,
      workspace_id text,
      parent_id text,
      slug text not null,
      directory text not null,
      path text,
      title text not null,
      version text not null,
      share_url text,
      summary_additions integer,
      summary_deletions integer,
      summary_files integer,
      summary_diffs text,
      cost real not null default 0,
      tokens_input integer not null default 0,
      tokens_output integer not null default 0,
      tokens_reasoning integer not null default 0,
      tokens_cache_read integer not null default 0,
      tokens_cache_write integer not null default 0,
      revert text,
      permission text,
      agent text,
      model text,
      time_created integer not null,
      time_updated integer not null,
      time_compacting integer,
      time_archived integer
    )`)
    db.exec("create table message (id text primary key, session_id text not null, time_created integer not null, time_updated integer not null, data text not null)")
    db.exec("create table part (id text primary key, message_id text not null, session_id text not null, time_created integer not null, time_updated integer not null, data text not null)")
    db.exec("create table session_message (id text primary key, session_id text not null, type text not null, time_created integer not null, time_updated integer not null, data text not null)")
    db.exec("create table todo (session_id text not null, content text not null, status text not null, priority text not null, position integer not null, time_created integer not null, time_updated integer not null, primary key(session_id, position))")
    db.exec(`
      insert into session (
        id, project_id, workspace_id, parent_id, slug, directory, path, title, version,
        revert, cost, tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write,
        time_created, time_updated
      ) values (
        'ses_missing_history', 'proj_1', 'ws_rebuild', null, 'slug_1', '/workspace', null, '${input.title}', '1.0.0',
        json('{"messageID":"msg_old","partID":"prt_old"}'), 0, 0, 0, 0, 0, 0, 1, ${input.sessionUpdatedAt}
      )
    `)
    db.query("insert into message (id, session_id, time_created, time_updated, data) values (?, ?, ?, ?, ?)").run(
      "msg_old",
      "ses_missing_history",
      input.sessionUpdatedAt,
      input.sessionUpdatedAt,
      JSON.stringify({
        role: "user",
        model: { providerID: "openai", modelID: "gpt-5" },
      }),
    )
    db.query("insert into part (id, message_id, session_id, time_created, time_updated, data) values (?, ?, ?, ?, ?, ?)").run(
      "prt_old",
      "msg_old",
      "ses_missing_history",
      input.sessionUpdatedAt,
      input.sessionUpdatedAt,
      JSON.stringify({
        type: "text",
        text: input.messageText,
        messageID: "msg_old",
      }),
    )
    db.query("insert into session_message (id, session_id, type, time_created, time_updated, data) values (?, ?, ?, ?, ?, ?)").run(
      "evt_old",
      "ses_missing_history",
      "prompted",
      input.sessionUpdatedAt,
      input.sessionUpdatedAt,
      JSON.stringify({
        messageID: "msg_old",
      }),
    )
    db.query("insert into todo (session_id, content, status, priority, position, time_created, time_updated) values (?, ?, ?, ?, ?, ?, ?)").run(
      "ses_missing_history",
      input.messageText,
      "pending",
      "medium",
      0,
      input.sessionUpdatedAt,
      input.sessionUpdatedAt,
    )
  } finally {
    db.close(false)
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (condition) return
  throw new Error(message)
}

function assertJsonEqual(actual: unknown, expected: unknown, message: string) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) return
  throw new Error(`${message}\nactual=${JSON.stringify(actual)}\nexpected=${JSON.stringify(expected)}`)
}

type State = {
  currentSessionId: string
  eventBuffer: Array<Record<string, unknown>>
  eventBufferVersion: number
  seenEventIds: Set<string>
  conversationState: ReturnType<typeof createConversationState>
  conversationBlocks: ConversationBlock[]
  conversationVersion: number
  pendingPermissions: Array<{ requestId?: string; id?: string }>
  pendingQuestions: Array<{ requestId?: string; id?: string }>
  respondingPermissionIds: Set<string>
  respondingQuestionIds: Set<string>
  isSubmitting: boolean
  isRunning: boolean
  awaitingTurnRestart: boolean
  isCancelling: boolean
  flash: string
}

type Input = {
  api: {
    cancelSessionPrompt: (businessSessionId: string) => Promise<unknown>
    sendInput: (businessSessionId: string, parts: unknown[]) => Promise<unknown>
    permissionRespond: (
      businessSessionId: string,
      requestId: string,
      approved: boolean,
      optionId?: string,
    ) => Promise<unknown>
    questionRespond: (
      businessSessionId: string,
      requestId: string,
      action: string,
      content: Record<string, unknown>,
    ) => Promise<unknown>
  }
  get: () => State & { setFlash: (message: string) => void }
  set: (
    patch:
      | Partial<State>
      | ((state: State) => Partial<State>),
  ) => void
}
