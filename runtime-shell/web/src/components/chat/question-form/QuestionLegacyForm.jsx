import {
  buildInitialLegacyAnswers,
  buildLegacyQuestionContent,
  hasEmptyLegacyQuestionAnswer,
} from './question-form-support'

export function QuestionLegacyForm(input) {
  return (
    <div className="grid gap-3">
      {input.prompts.map((prompt, promptIndex) => (
        <div key={promptIndex} className="grid gap-2 rounded-[12px] border border-[var(--line)] bg-[var(--surface-muted)] p-3">
          <div className="grid gap-0.5">
            {prompt.header ? <div className="text-[11px] font-semibold text-[var(--text-muted)]">{prompt.header}</div> : null}
            <div className="text-xs font-semibold text-[var(--text)]">{prompt.question}</div>
          </div>

          <div className="grid gap-2">
            {(Array.isArray(prompt.options) ? prompt.options : []).map((option, optionIndex) => {
              const selected = Array.isArray(input.legacyAnswers[promptIndex]) && input.legacyAnswers[promptIndex].includes(String(option.label))

              if (prompt.multiple) {
                return (
                  <label
                    key={`${promptIndex}-${optionIndex}`}
                    className="flex items-start gap-2 rounded-[10px] border border-[var(--line)] bg-white px-3 py-2 text-left"
                  >
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() =>
                        input.setLegacyAnswers((current) => {
                          const next = Array.isArray(current) ? [...current] : buildInitialLegacyAnswers(input.prompts)
                          const currentValues = Array.isArray(next[promptIndex]) ? [...next[promptIndex]] : []
                          next[promptIndex] = selected
                            ? currentValues.filter((item) => item !== String(option.label))
                            : [...currentValues, String(option.label)]
                          return next
                        })
                      }
                      className="mt-0.5 h-3.5 w-3.5 accent-brand"
                    />
                    <span className="grid gap-1">
                      <span className="text-xs font-semibold text-[var(--text-dim)]">{option.label}</span>
                      {option.description ? <span className="text-[11px] text-[var(--text-muted)]">{option.description}</span> : null}
                    </span>
                  </label>
                )
              }

              return (
                <button
                  key={`${promptIndex}-${optionIndex}`}
                  type="button"
                  onClick={() =>
                    input.setLegacyAnswers((current) => {
                      const next = Array.isArray(current) ? [...current] : buildInitialLegacyAnswers(input.prompts)
                      next[promptIndex] = [String(option.label)]
                      return next
                    })
                  }
                  className={`rounded-[10px] border px-3 py-2 text-left transition-colors ${
                    selected
                      ? 'border-brand bg-brand/10 text-brand'
                      : 'border-[var(--line)] bg-white hover:bg-[var(--surface-muted)]'
                  }`}
                >
                  <div className="text-xs font-semibold text-[var(--text-dim)]">{option.label}</div>
                  {option.description ? <div className="mt-1 text-[11px] text-[var(--text-muted)]">{option.description}</div> : null}
                </button>
              )
            })}

            {prompt.custom === true ? (
              <input
                type="text"
                value={input.legacyCustomAnswers[promptIndex] || ''}
                onChange={(event) =>
                  input.setLegacyCustomAnswers((current) => ({
                    ...current,
                    [promptIndex]: event.target.value,
                  }))
                }
                placeholder="请输入自定义答案"
                className="w-full rounded-[10px] border border-[var(--line-strong)] bg-white px-3 py-2 text-xs outline-none transition-colors focus:border-[var(--brand)] focus:shadow-[0_0_0_3px_rgba(37,99,235,0.10)]"
              />
            ) : null}
          </div>
        </div>
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
          onClick={() =>
            input.respondQuestion(input.requestId, 'accept', {
              // 中文/English: opencode Question tool expects `answers` aligned to the original prompt order.
              ...buildLegacyQuestionContent(input.prompts, input.legacyAnswers, input.legacyCustomAnswers),
            })
          }
          disabled={input.submitting || hasEmptyLegacyQuestionAnswer(input.prompts, input.legacyAnswers, input.legacyCustomAnswers)}
          className="rounded-[8px] border border-success/20 bg-success/10 px-3 py-1 text-xs text-success transition-colors hover:bg-success/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {input.submitting ? '提交中...' : '提交'}
        </button>
      </div>
    </div>
  )
}
