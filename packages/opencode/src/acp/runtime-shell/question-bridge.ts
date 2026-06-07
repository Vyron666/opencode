import type {
  AgentSideConnection,
  CreateElicitationResponse,
  MultiSelectPropertySchema,
  StringPropertySchema,
} from "@agentclientprotocol/sdk"
import type { OpencodeClient } from "@opencode-ai/sdk/v2"
import { Question } from "@/question"

function questionRequestID(question: Question.Request) {
  return String(question.id)
}

// 中文/English: keep runtime-shell question customization in one small module
// so agent.ts only owns the event switch and session queue wiring.
export async function handleRuntimeShellQuestion(input: {
  connection: AgentSideConnection
  sdk: OpencodeClient
  question: Question.Request
  directory: string
}) {
  if (!input.connection.unstable_createElicitation) {
    await input.sdk.question.reject(
      {
        requestID: questionRequestID(input.question),
        directory: input.directory,
      },
      { throwOnError: true },
    )
    return
  }

  const response = await input.connection.unstable_createElicitation({
    sessionId: input.question.sessionID,
    toolCallId: input.question.tool?.callID ?? null,
    mode: "form",
    message: buildQuestionMessage(input.question),
    requestedSchema: buildQuestionElicitationSchema(input.question),
  })

  await replyQuestion(input.sdk, input.question, response, input.directory)
}

// 中文/English: build a concise human message for ACP elicitation while preserving
// opencode's original prompt list for the actual answer mapping.
function buildQuestionMessage(question: Question.Request) {
  if (question.questions.length === 1) return question.questions[0]?.question ?? "Question requires input"
  return `Please answer ${question.questions.length} questions to continue`
}

// 中文/English: convert opencode's question schema into ACP primitive-form schema
// so runtime-shell can render single-select, multi-select and custom input consistently.
function buildQuestionElicitationSchema(question: Question.Request) {
  return {
    type: "object" as const,
    title: "Question",
    description: "Provide answers to continue this session.",
    properties: Object.fromEntries(
      question.questions.map((item, index) => [
        `question_${index}`,
        item.multiple ? buildMultiSelectQuestionProperty(item) : buildSingleQuestionProperty(item),
      ]),
    ),
    required: question.questions.map((_, index) => `question_${index}`),
    _meta: {
      opencode: {
        questionId: questionRequestID(question),
        mode: "opencode-question",
        prompts: question.questions.map((item, index) => ({
          id: `question_${index}`,
          header: item.header,
          question: item.question,
          multiple: item.multiple === true,
          custom: item.custom !== false,
          options: item.options,
        })),
      },
    },
  }
}

function buildSingleQuestionProperty(question: Question.Info): StringPropertySchema & { type: "string" } {
  const options = question.options.map((item) => ({
    const: item.label,
    title: item.label,
  }))
  const description = question.custom === false ? question.question : `${question.question}\nCustom input is allowed.`
  if (options.length === 0) {
    return {
      type: "string",
      title: question.header,
      description,
      minLength: 1,
    }
  }
  return {
    type: "string",
    title: question.header,
    description,
    oneOf: options,
    minLength: 1,
  }
}

function buildMultiSelectQuestionProperty(question: Question.Info): MultiSelectPropertySchema & { type: "array" } {
  return {
    type: "array",
    title: question.header,
    description: question.custom === false ? question.question : `${question.question}\nCustom input is allowed.`,
    items: {
      anyOf: question.options.map((item) => ({
        const: item.label,
        title: item.label,
      })),
    },
    minItems: 1,
  }
}

// 中文/English: translate ACP elicitation form content back into opencode's
// `answers: string[][]` structure so sdk.question.reply can continue the tool call.
async function replyQuestion(
  sdk: OpencodeClient,
  question: Question.Request,
  response: CreateElicitationResponse,
  directory: string,
) {
  if (response.action === "decline" || response.action === "cancel") {
    // 中文/English: question reply/reject must target the same workspace-routed
    // opencode instance, otherwise the pending request cannot be found.
    await sdk.question.reject({ requestID: questionRequestID(question), directory }, { throwOnError: true })
    return
  }

  const answers = question.questions.map((item, index) => {
    const key = `question_${index}`
    const value = response.content?.[key]
    if (item.multiple) {
      if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
      if (typeof value === "string" && value) return [value]
      return []
    }
    if (typeof value === "string" && value) return [value]
    return []
  })

  await sdk.question.reply(
    {
      requestID: questionRequestID(question),
      directory,
      answers,
    },
    { throwOnError: true },
  )
}
