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
  }, [requestId])

  useEffect(() => {
    setFormValues(buildInitialQuestionFormValues(fields))
  }, [requestId])

  const hasLegacyPrompts = prompts.length > 0
  const hasSchemaFields = fields.length > 0
  const submitting = requestId ? respondingQuestionIds.has(requestId) : false
  const pending = requestId
    ? pendingQuestions.some((item) => (item.requestId || item.id) === requestId)
    : false
  const resolved = Boolean(requestId) && !pending && !submitting

  return (
    <div className="flex justify-center px-4">
      <div className="rounded-[16px] px-4 py-3 border border-brand/20 bg-brand/5 w-full max-w-[540px] grid gap-2">
        <div className="text-[10px] font-bold text-brand tracking-widest uppercase">交互提问</div>
        <div className="text-xs font-semibold text-[var(--text)]">{block.data?.message || '需要你的确认'}</div>
        <div className="text-[11px] text-[var(--text-muted)]">
          当前会话正在等待你回答这个问题，提交后会继续运行。
        </div>

        {resolved ? (
          <div className="text-[11px] text-[var(--text-muted)]">
            已提交，等待会话继续。
          </div>
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
            {schema && (
              <pre className="text-xs text-[var(--text-dim)] bg-black/30 rounded-[10px] p-2 whitespace-pre-wrap break-words overflow-x-auto">
                {formatData(schema)}
              </pre>
            )}
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => respondQuestion(requestId, 'decline', {})}
                disabled={submitting}
                className="text-xs px-3 py-1 rounded-[8px] bg-danger/10 text-danger border border-danger/20 hover:bg-danger/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? '提交中...' : '拒绝'}
              </button>
              <button
                onClick={() => respondQuestion(requestId, 'accept', {})}
                disabled={submitting}
                className="text-xs px-3 py-1 rounded-[8px] bg-success/10 text-success border border-success/20 hover:bg-success/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
