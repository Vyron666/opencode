import {
  buildInitialQuestionFormValues,
  buildQuestionFields,
  buildQuestionFormContent,
  hasEmptyRequiredQuestionField,
} from "../web/src/components/chat/question-form/question-form-support.js"

const schema = {
  type: "object",
  required: ["brandColor", "tone"],
  properties: {
    brandColor: {
      type: "string",
      title: "品牌色",
      description: "选择一个主色。 Custom input is allowed.",
      oneOf: [
        { const: "red", title: "红色" },
        { const: "blue", title: "蓝色" },
      ],
    },
    tone: {
      type: "string",
      title: "语气",
      enum: ["正式", "轻松"],
    },
    audience: {
      type: "string",
      title: "受众",
    },
  },
}

const fields = buildQuestionFields(schema)
assert(fields.length === 3, "question fields should include all supported schema properties")

const brandColorField = fields.find((field) => field.id === "brandColor")
assert(brandColorField, "brandColor field should exist")
assert(brandColorField.kind === "select", "brandColor should be normalized as select")
assert(brandColorField.allowCustom === true, "brandColor should allow custom input")
assert(brandColorField.description === "选择一个主色。", "custom input hint should be removed from rendered description")

const toneField = fields.find((field) => field.id === "tone")
assert(toneField, "tone field should exist")
assert(toneField.kind === "select", "tone should be normalized as select")
assert(toneField.allowCustom !== true, "tone should not allow custom input")

const initialValues = buildInitialQuestionFormValues(fields)
assert(initialValues.brandColor === "", "custom select should default to empty choice")
assert(initialValues.brandColor__custom === "", "custom select should initialize custom input state")
assert(initialValues.tone === "", "required enum should default to empty choice")
assert(hasEmptyRequiredQuestionField(fields, initialValues), "empty required fields should block submission")

const presetFields = buildQuestionFields({
  type: "object",
  properties: {
    color: {
      type: "string",
      title: "颜色",
      description: "Custom input is allowed.",
      oneOf: [{ const: "red", title: "红色" }],
      default: "emerald",
    },
  },
})
const presetValues = buildInitialQuestionFormValues(presetFields)
assert(presetValues.color === "__custom__", "unknown default should fall back to custom option")
assert(presetValues.color__custom === "emerald", "unknown default should seed custom input value")

const selectedOptionValues = {
  ...initialValues,
  brandColor: "red",
  tone: "正式",
}
assert(!hasEmptyRequiredQuestionField(fields, selectedOptionValues), "selected built-in options should satisfy required validation")
assertJsonEqual(
  buildQuestionFormContent(fields, selectedOptionValues),
  {
    brandColor: "red",
    tone: "正式",
  },
  "selected built-in options should submit original values",
)

const missingCustomInputValues = {
  ...initialValues,
  brandColor: "__custom__",
  tone: "轻松",
}
assert(
  hasEmptyRequiredQuestionField(fields, missingCustomInputValues),
  "custom mode without input should still block required submission",
)

const customInputValues = {
  ...initialValues,
  brandColor: "__custom__",
  brandColor__custom: "sunset-orange",
  tone: "轻松",
  audience: "设计团队",
}
assert(!hasEmptyRequiredQuestionField(fields, customInputValues), "custom input should satisfy required validation once filled")
assertJsonEqual(
  buildQuestionFormContent(fields, customInputValues),
  {
    brandColor: "sunset-orange",
    tone: "轻松",
    audience: "设计团队",
  },
  "custom input should be submitted as the field value",
)

console.log(
  JSON.stringify({
    ok: true,
    fieldCount: fields.length,
    customFieldId: brandColorField.id,
    customFieldOptions: brandColorField.options.length,
  }),
)

function assert(condition: unknown, message: string): asserts condition {
  if (condition) return
  throw new Error(message)
}

function assertJsonEqual(actual: unknown, expected: unknown, message: string) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) return
  throw new Error(`${message}\nactual=${JSON.stringify(actual)}\nexpected=${JSON.stringify(expected)}`)
}
