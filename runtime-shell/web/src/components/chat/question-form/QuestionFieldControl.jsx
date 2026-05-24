export function QuestionFieldControl({ field, value, setFormValues }) {
  if (field.kind === 'boolean') {
    return (
      <label className="flex items-center gap-2 rounded-[10px] border border-[var(--line)] bg-black/30 px-3 py-2 text-xs text-[var(--text-dim)]">
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
              className="flex items-start gap-2 rounded-[10px] border border-[var(--line)] bg-black/30 px-3 py-2 text-left"
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
    return (
      <select
        value={typeof value === 'string' ? value : ''}
        onChange={(event) =>
          setFormValues((current) => ({
            ...current,
            [field.id]: event.target.value,
          }))
        }
        className="w-full rounded-[10px] border border-[var(--line-strong)] px-3 py-2 bg-black/55 text-xs outline-none focus:border-[rgba(212,160,90,0.28)]"
      >
        <option value="">请选择</option>
        {field.options.map((option) => (
          <option key={`${field.id}-${option.value}`} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
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
      className="w-full rounded-[10px] border border-[var(--line-strong)] px-3 py-2 bg-black/55 text-xs outline-none focus:border-[rgba(212,160,90,0.28)]"
    />
  )
}
