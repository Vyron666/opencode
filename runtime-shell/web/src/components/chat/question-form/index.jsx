import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../../../store'
import { QuestionLegacyForm } from './QuestionLegacyForm'
import { QuestionSchemaForm } from './QuestionSchemaForm'
import {
  buildInitialLegacyAnswers,
  buildInitialQuestionFormValues,
  buildQuestionFields,
  formatData,
} from './question-form-support'

export function QuestionInlineBlock({ block }) {
  const respondQuestion = useStore((state) => state.respondQuestion)
  const pendingQuestions = useStore((state) => state.pendingQuestions)
  const respondingQuestionIds = useStore((state) => state.respondingQuestionIds)
  const requestId = block.data?.requestId || block.data?.id
  const schema = block.data?.requestedSchema
  const promptMeta = block.data?.meta?.opencode
  const prompts = Array.isArray(promptMeta?.prompts)
    ? promptMeta.prompts
    : Array.isArray(schema?.questions)
      ? schema.questions
      : []
  const fields = useMemo(() => buildQuestionFields(schema), [schema])
  const [legacyAnswers, setLegacyAnswers] = useState([])
  const [legacyCustomAnswers, setLegacyCustomAnswers] = useState({})
  const [formValues, setFormValues] = useState({})

  useEffect(() => {
    setLegacyAnswers(buildInitialLegacyAnswers(prompts))
    setLegacyCustomAnswers({})
  }, [requestId, prompts])

  useEffect(() => {
    setFormValues(buildInitialQuestionFormValues(fields))
  }, [requestId, fields])

  const hasLegacyPrompts = prompts.length > 0
  const hasSchemaFields = fields.length > 0
  const submitting = requestId ? respondingQuestionIds.has(requestId) : false
  const pending = requestId ? pendingQuestions.some((item) => (item.requestId || item.id) === requestId) : false
  const resolved = Boolean(requestId) && !pending && !submitting

  return (
    <div className="flex justify-center px-4">
      <div className="grid w-full max-w-[680px] gap-3 rounded-[18px] border border-[#dce6f8] bg-[#f7f9fe] px-4 py-4 shadow-[0_10px_24px_rgba(15,23,42,0.04)]">
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-[14px] bg-[#e8efff] text-sm font-bold text-[#3566df]">
            问
          </div>
          <div className="min-w-0 grid gap-1">
            <div className="text-[11px] font-bold tracking-[0.12em] text-[#3566df]">交互提问</div>
            <div className="text-sm font-semibold text-[#24324a]">{block.data?.message || '需要你的确认'}</div>
            <div className="text-[12px] leading-6 text-[#61718d]">当前会话正在等待你回答这个问题，提交后会继续执行。</div>
          </div>
        </div>

        {resolved ? (
          <div className="rounded-[12px] border border-[#dce6f8] bg-white px-3 py-2 text-[11px] text-[#61718d]">已提交，等待会话继续。</div>
        ) : hasLegacyPrompts ? (
          <QuestionLegacyForm
            prompts={prompts}
            requestId={requestId}
            submitting={submitting}
            legacyAnswers={legacyAnswers}
            legacyCustomAnswers={legacyCustomAnswers}
            setLegacyAnswers={setLegacyAnswers}
            setLegacyCustomAnswers={setLegacyCustomAnswers}
            respondQuestion={respondQuestion}
          />
        ) : hasSchemaFields ? (
          <QuestionSchemaForm
            schema={schema}
            fields={fields}
            requestId={requestId}
            submitting={submitting}
            formValues={formValues}
            setFormValues={setFormValues}
            respondQuestion={respondQuestion}
          />
        ) : (
          <>
            {schema ? (
              <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-[12px] border border-[#dce6f8] bg-white p-3 text-xs text-[#61718d]">
                {formatData(schema)}
              </pre>
            ) : null}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => respondQuestion(requestId, 'decline', {})}
                disabled={submitting}
                className="rounded-[10px] border border-[#efc4c4] bg-[#fff3f3] px-3 py-2 text-xs text-[#cf4040] transition-colors hover:bg-[#ffeaea] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? '提交中...' : '拒绝'}
              </button>
              <button
                onClick={() => respondQuestion(requestId, 'accept', {})}
                disabled={submitting}
                className="rounded-[10px] border border-[#bce5d6] bg-[#eef9f4] px-3 py-2 text-xs text-[#0f9f6e] transition-colors hover:bg-[#e5f7ef] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? '提交中...' : '提交'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
