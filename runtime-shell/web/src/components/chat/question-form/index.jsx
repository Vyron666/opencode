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
  const pending = requestId
    ? pendingQuestions.some((item) => (item.requestId || item.id) === requestId)
    : false
  const resolved = Boolean(requestId) && !pending && !submitting

  return (
    <div className="flex justify-center px-4">
      <div className="rounded-[18px] px-4 py-4 border border-brand/20 bg-[rgba(212,160,90,0.06)] w-full max-w-[620px] grid gap-3 shadow-[0_8px_24px_rgba(0,0,0,0.12)]">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 h-10 w-10 shrink-0 rounded-[14px] grid place-items-center bg-brand/15 text-brand font-bold text-sm">
            问
          </div>
          <div className="min-w-0 grid gap-1">
            <div className="text-[10px] font-bold text-brand tracking-widest uppercase">交互提问</div>
            <div className="text-sm font-semibold text-[var(--text)]">{block.data?.message || '需要你的确认'}</div>
            <div className="text-[12px] text-[var(--text-muted)] leading-relaxed">
              当前会话正在等待你回答这个问题，提交后会继续运行。
            </div>
          </div>
        </div>

        {resolved ? (
          <div className="rounded-[12px] border border-[var(--line)] bg-black/20 px-3 py-2 text-[11px] text-[var(--text-muted)]">
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
            {schema ? (
              <pre className="text-xs text-[var(--text-dim)] bg-black/30 rounded-[12px] p-3 whitespace-pre-wrap break-words overflow-x-auto border border-[var(--line)]">
                {formatData(schema)}
              </pre>
            ) : null}
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => respondQuestion(requestId, 'decline', {})}
                disabled={submitting}
                className="text-xs px-3 py-2 rounded-[10px] bg-danger/10 text-danger border border-danger/20 hover:bg-danger/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? '提交中...' : '拒绝'}
              </button>
              <button
                onClick={() => respondQuestion(requestId, 'accept', {})}
                disabled={submitting}
                className="text-xs px-3 py-2 rounded-[10px] bg-success/10 text-success border border-success/20 hover:bg-success/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
