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
      <div className="grid w-full max-w-[620px] gap-3 rounded-[20px] border border-brand/15 bg-[linear-gradient(180deg,#ffffff,#f8fbff)] px-4 py-4 shadow-[0_14px_34px_rgba(15,23,42,0.08)]">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-[14px] bg-brand/10 text-sm font-bold text-brand">
            问
          </div>
          <div className="min-w-0 grid gap-1">
            <div className="text-[10px] font-bold uppercase tracking-widest text-brand">交互提问</div>
            <div className="text-sm font-semibold text-[var(--text)]">{block.data?.message || '需要你的确认'}</div>
            <div className="text-[12px] leading-relaxed text-[var(--text-muted)]">
              当前会话正在等待你回答这个问题，提交后会继续运行。
            </div>
          </div>
        </div>

        {resolved ? (
          <div className="rounded-[12px] border border-[var(--line)] bg-[var(--surface-muted)] px-3 py-2 text-[11px] text-[var(--text-muted)]">
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
              <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-[12px] border border-[var(--line)] bg-[var(--surface-muted)] p-3 text-xs text-[var(--text-dim)]">
                {formatData(schema)}
              </pre>
            ) : null}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => respondQuestion(requestId, 'decline', {})}
                disabled={submitting}
                className="rounded-[10px] border border-danger/20 bg-danger/10 px-3 py-2 text-xs text-danger transition-colors hover:bg-danger/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? '提交中...' : '拒绝'}
              </button>
              <button
                onClick={() => respondQuestion(requestId, 'accept', {})}
                disabled={submitting}
                className="rounded-[10px] border border-success/20 bg-success/10 px-3 py-2 text-xs text-success transition-colors hover:bg-success/20 disabled:cursor-not-allowed disabled:opacity-50"
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
