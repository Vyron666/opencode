import { buildQuestionCustomValueKey } from './question-form-support'

const CUSTOM_INPUT_SENTINEL = '__custom__'

export function QuestionFieldControl({ field, value, formValues, setFormValues }) {
  if (field.kind === 'boolean') {
    return (
      <label className="flex items-center gap-2 rounded-[10px] border border-[var(--line)] bg-[var(--surface-muted)] px-3 py-2 text-xs text-[var(--text-dim)]">
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(event) =>
            setFormValues((current) => ({
              ...current,
              [field.id]: event.target.checked,
            }))
          }
          className="h-3.5 w-3.5 accent-brand"
        />
        <span>{field.label}</span>
      </label>
    )
  }

  if (field.kind === 'multiselect') {
    return (
      <div className="grid gap-2">
        {field.options.map((option) => {
          const selectedValues = Array.isArray(value) ? value : []
          const selected = selectedValues.includes(option.value)
          return (
            <label
              key={`${field.id}-${option.value}`}
              className="flex items-start gap-2 rounded-[10px] border border-[var(--line)] bg-[var(--surface-muted)] px-3 py-2 text-left"
            >
              <input
                type="checkbox"
                checked={selected}
                onChange={() =>
                  setFormValues((current) => {
                    const currentValues = Array.isArray(current[field.id]) ? [...current[field.id]] : []
                    return {
                      ...current,
                      [field.id]: selected
                        ? currentValues.filter((item) => item !== option.value)
                        : [...currentValues, option.value],
                    }
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
        })}
      </div>
    )
  }

  if (field.kind === 'select') {
    const customValueKey = buildQuestionCustomValueKey(field.id)
    const customValue = typeof formValues?.[customValueKey] === 'string' ? formValues[customValueKey] : ''

    return (
      <div className="grid gap-2">
        <select
          value={typeof value === 'string' ? value : ''}
          onChange={(event) =>
            setFormValues((current) => ({
              ...current,
              [field.id]: event.target.value,
              ...(event.target.value === CUSTOM_INPUT_SENTINEL ? {} : { [customValueKey]: '' }),
            }))
          }
          className="w-full rounded-[10px] border border-[var(--line-strong)] bg-white px-3 py-2 text-xs outline-none transition-colors focus:border-[var(--brand)] focus:shadow-[0_0_0_3px_rgba(37,99,235,0.10)]"
        >
          <option value="">请选择</option>
          {field.options.map((option) => (
            <option key={`${field.id}-${option.value}`} value={option.value}>
              {option.label}
            </option>
          ))}
          {field.allowCustom ? <option value={CUSTOM_INPUT_SENTINEL}>让我填写</option> : null}
        </select>
        {field.allowCustom && value === CUSTOM_INPUT_SENTINEL ? (
          <input
            type="text"
            value={customValue}
            onChange={(event) =>
              setFormValues((current) => ({
                ...current,
                [customValueKey]: event.target.value,
              }))
            }
            placeholder="请输入"
            className="w-full rounded-[10px] border border-[var(--line-strong)] bg-white px-3 py-2 text-xs outline-none transition-colors focus:border-[var(--brand)] focus:shadow-[0_0_0_3px_rgba(37,99,235,0.10)]"
          />
        ) : null}
      </div>
    )
  }

  return (
    <input
      type={field.inputType}
      value={value ?? ''}
      onChange={(event) =>
        setFormValues((current) => ({
          ...current,
          [field.id]: event.target.value,
        }))
      }
      placeholder={field.placeholder}
      className="w-full rounded-[10px] border border-[var(--line-strong)] bg-white px-3 py-2 text-xs outline-none transition-colors focus:border-[var(--brand)] focus:shadow-[0_0_0_3px_rgba(37,99,235,0.10)]"
    />
  )
}
