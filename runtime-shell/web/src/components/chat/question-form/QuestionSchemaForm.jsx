import { QuestionFieldControl } from './QuestionFieldControl'
import { buildQuestionFormContent, hasEmptyRequiredQuestionField } from './question-form-support'

export function QuestionSchemaForm(input) {
  return (
    <div className="grid gap-3">
      {(input.schema?.title || input.schema?.description) && (
        <div className="rounded-[12px] border border-[var(--line)] bg-black/20 px-3 py-2 grid gap-1">
          {input.schema?.title && <div className="text-xs font-semibold text-[var(--text)]">{input.schema.title}</div>}
          {input.schema?.description && <div className="text-[11px] text-[var(--text-muted)]">{input.schema.description}</div>}
        </div>
      )}

      {input.fields.map((field) => (
        <label key={field.id} className="grid gap-1.5">
          <span className="text-xs font-semibold text-[var(--text)]">
            {field.label}
            {field.required ? <span className="ml-1 text-danger">*</span> : null}
          </span>
          {field.description ? <span className="text-[11px] text-[var(--text-muted)]">{field.description}</span> : null}
          <QuestionFieldControl
            field={field}
            value={input.formValues[field.id]}
            formValues={input.formValues}
            setFormValues={input.setFormValues}
          />
        </label>
      ))}

      <div className="flex gap-2 justify-end">
        <button
          onClick={() => input.respondQuestion(input.requestId, 'cancel', {})}
          disabled={input.submitting}
          className="text-xs px-3 py-1 rounded-[8px] bg-black/20 text-[var(--text-dim)] border border-[var(--line)] hover:bg-black/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {input.submitting ? '提交中...' : '取消'}
        </button>
        <button
          onClick={() => input.respondQuestion(input.requestId, 'decline', {})}
          disabled={input.submitting}
          className="text-xs px-3 py-1 rounded-[8px] bg-danger/10 text-danger border border-danger/20 hover:bg-danger/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {input.submitting ? '提交中...' : '拒绝'}
        </button>
        <button
          onClick={() => input.respondQuestion(input.requestId, 'accept', buildQuestionFormContent(input.fields, input.formValues))}
          disabled={input.submitting || hasEmptyRequiredQuestionField(input.fields, input.formValues)}
          className="text-xs px-3 py-1 rounded-[8px] bg-success/10 text-success border border-success/20 hover:bg-success/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {input.submitting ? '提交中...' : '提交'}
        </button>
      </div>
    </div>
  )
}
