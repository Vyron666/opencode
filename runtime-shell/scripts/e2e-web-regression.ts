import { RuntimeShellClient } from "../server/src/acp/runtime-shell-client.ts"
import { createUpstreamDrainController } from "../server/src/runtime/upstream-drain.ts"
import { buildConversationState, finalizeConversationBlocks } from "../web/src/components/chat/conversation-blocks.js"
import { createInteractionActions } from "../web/src/store/actions/interaction-actions.js"
import {
  deriveConversationPhase,
  deriveRunningState,
  deriveRuntimeFlagsFromEvents,
} from "../web/src/store/runtime-phase.js"
import { shouldStreamAssistantChunk } from "../web/src/store/sse/sse-runtime.js"
import { loadSessionSummaries } from "../web/src/store/actions/session-list-sync-support.js"

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
  const state = createState({
    currentSessionId: "bs_1",
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
    [{ requestId: "q2" }],
    "question submission should remove only the answered pending question",
  )
  assert(state.respondingQuestionIds.has("q1"), "question submission should track the responding request id")
  assert(state.isRunning === false, "accepted question should not claim running before upstream resumes")
  assert(state.awaitingTurnRestart === false, "accepted question should unlock the next upstream resume")
}

async function verifyPermissionSubmissionRemovesPending() {
  const state = createState({
    currentSessionId: "bs_1",
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
    [{ requestId: "p2" }],
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
      onEvent: async (event) => {
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
      onEvent: async (event) => {
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

function createInput(state: State, apiOverrides: Partial<Input["api"]>): Input {
  return {
    api: {
      cancelSessionPrompt: async () => ({ success: true }),
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
    set: (patch) => {
      const next = typeof patch === "function" ? patch(state) : patch
      Object.assign(state, next)
    },
  }
}

function createState(overrides: Partial<State>): State {
  return {
    currentSessionId: "",
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

function createEvent(eventId: string, eventType: string, payload: Record<string, unknown>) {
  return { eventId, eventType, payload }
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
