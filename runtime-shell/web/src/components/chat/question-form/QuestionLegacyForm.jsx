import { buildInitialLegacyAnswers, buildLegacyQuestionAnswers } from './question-form-support'

export function QuestionLegacyForm(input) {
  return (
    <div className="grid gap-3">
      {input.prompts.map((prompt, promptIndex) => (
        <div key={promptIndex} className="rounded-[12px] border border-[var(--line)] bg-black/25 p-3 grid gap-2">
          <div className="grid gap-0.5">
            {prompt.header && <div className="text-[11px] font-semibold text-[var(--text-muted)]">{prompt.header}</div>}
            <div className="text-xs font-semibold text-[var(--text)]">{prompt.question}</div>
          </div>

          <div className="grid gap-2">
            {(Array.isArray(prompt.options) ? prompt.options : []).map((option, optionIndex) => {
              const selected = Array.isArray(input.legacyAnswers[promptIndex]) && input.legacyAnswers[promptIndex].includes(String(option.label))

              if (prompt.multiple) {
                return (
                  <label
                    key={`${promptIndex}-${optionIndex}`}
                    className="flex items-start gap-2 rounded-[10px] border border-[var(--line)] bg-black/30 px-3 py-2 text-left"
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
                  className={`text-left rounded-[10px] border px-3 py-2 transition-colors ${
                    selected
                      ? 'border-brand bg-brand/10'
                      : 'border-[var(--line)] bg-black/30 hover:bg-black/40'
                  }`}
                >
                  <div className="text-xs font-semibold text-[var(--text-dim)]">{option.label}</div>
                  {option.description ? <div className="text-[11px] text-[var(--text-muted)] mt-1">{option.description}</div> : null}
                </button>
              )
            })}

            {prompt.custom === true && (
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
                className="w-full rounded-[10px] border border-[var(--line-strong)] px-3 py-2 bg-black/55 text-xs outline-none focus:border-[rgba(212,160,90,0.28)]"
              />
            )}
          </div>
        </div>
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
          onClick={() =>
            input.respondQuestion(input.requestId, 'accept', {
              // 中文/English: opencode Question tool expects `answers` aligned to the original prompt order.
              answers: buildLegacyQuestionAnswers(input.prompts, input.legacyAnswers, input.legacyCustomAnswers),
            })
          }
          disabled={input.submitting}
          className="text-xs px-3 py-1 rounded-[8px] bg-success/10 text-success border border-success/20 hover:bg-success/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {input.submitting ? '提交中...' : '提交'}
        </button>
      </div>
    </div>
  )
}
