import { QuestionFieldControl } from './QuestionFieldControl'
import { buildQuestionFormContent, hasEmptyRequiredQuestionField } from './question-form-support'

export function QuestionSchemaForm(input) {
  return (
    <div className="grid gap-3">
      {input.schema?.title || input.schema?.description ? (
        <div className="grid gap-1 rounded-[12px] border border-[var(--line)] bg-[var(--surface-muted)] px-3 py-2">
          {input.schema?.title ? <div className="text-xs font-semibold text-[var(--text)]">{input.schema.title}</div> : null}
          {input.schema?.description ? <div className="text-[11px] text-[var(--text-muted)]">{input.schema.description}</div> : null}
        </div>
      ) : null}

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

      <div className="flex justify-end gap-2">
        <button
          onClick={() => input.respondQuestion(input.requestId, 'cancel', {})}
          disabled={input.submitting}
          className="rounded-[8px] border border-[var(--line)] bg-white px-3 py-1 text-xs text-[var(--text-dim)] transition-colors hover:bg-[var(--surface-muted)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {input.submitting ? '提交中...' : '取消'}
        </button>
        <button
          onClick={() => input.respondQuestion(input.requestId, 'decline', {})}
          disabled={input.submitting}
          className="rounded-[8px] border border-danger/20 bg-danger/10 px-3 py-1 text-xs text-danger transition-colors hover:bg-danger/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {input.submitting ? '提交中...' : '拒绝'}
        </button>
        <button
          onClick={() => input.respondQuestion(input.requestId, 'accept', buildQuestionFormContent(input.fields, input.formValues))}
          disabled={input.submitting || hasEmptyRequiredQuestionField(input.fields, input.formValues)}
          className="rounded-[8px] border border-success/20 bg-success/10 px-3 py-1 text-xs text-success transition-colors hover:bg-success/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {input.submitting ? '提交中...' : '提交'}
        </button>
      </div>
    </div>
  )
}
