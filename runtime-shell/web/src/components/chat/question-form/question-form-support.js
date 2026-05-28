export function buildInitialLegacyAnswers(prompts) {
  return prompts.map(() => [])
}

const CUSTOM_INPUT_SENTINEL = '__custom__'
const CUSTOM_INPUT_HINT = 'Custom input is allowed.'

export function buildLegacyQuestionAnswers(prompts, legacyAnswers, legacyCustomAnswers) {
  return prompts.map((prompt, index) => {
    const selected = Array.isArray(legacyAnswers[index]) ? [...legacyAnswers[index]] : []
    const custom = typeof legacyCustomAnswers[index] === 'string' ? legacyCustomAnswers[index].trim() : ''
    if (prompt.custom === true && custom) selected.push(custom)
    return selected
  })
}

export function buildQuestionFields(schema) {
  const properties = schema?.properties
  if (!properties || typeof properties !== 'object') return []

  const required = new Set(Array.isArray(schema?.required) ? schema.required : [])

  // 中文/English: ACP elicitation form is standardized as object properties; normalize once for inline rendering.
  return Object.entries(properties).flatMap(([id, property]) => {
    if (!property || typeof property !== 'object') return []

    const baseField = {
      id,
      label: property.title || id,
      description: normalizeQuestionDescription(property.description || ''),
      required: required.has(id),
      defaultValue: property.default,
    }

    if (property.type === 'boolean') {
      return [{ ...baseField, kind: 'boolean' }]
    }

    if (property.type === 'array') {
      const options = questionArrayOptions(property.items)
      if (!options.length) return []
      return [{ ...baseField, kind: 'multiselect', options }]
    }

    if (property.type === 'string') {
      const options = questionStringOptions(property)
      if (options.length) {
        return [{ ...baseField, kind: 'select', options, allowCustom: questionAllowsCustomInput(property) }]
      }
      return [{
        ...baseField,
        kind: 'string',
        inputType: questionInputType(property.format),
        placeholder: property.pattern || '',
      }]
    }

    if (property.type === 'number' || property.type === 'integer') {
      return [{
        ...baseField,
        kind: property.type,
        inputType: 'number',
      }]
    }

    return []
  })
}

export function buildInitialQuestionFormValues(fields) {
  return fields.reduce((result, field) => {
    if (field.kind === 'boolean') {
      result[field.id] = typeof field.defaultValue === 'boolean' ? field.defaultValue : false
      return result
    }

    if (field.kind === 'multiselect') {
      result[field.id] = Array.isArray(field.defaultValue) ? field.defaultValue : []
      return result
    }

    if (field.kind === 'select' && field.allowCustom) {
      const customValue = typeof field.defaultValue === 'string' ? field.defaultValue : ''
      const matched = field.options.some((option) => option.value === customValue)
      result[field.id] = matched ? customValue : customValue ? CUSTOM_INPUT_SENTINEL : ''
      result[buildQuestionCustomValueKey(field.id)] = matched ? '' : customValue
      return result
    }

    result[field.id] = field.defaultValue ?? ''
    return result
  }, {})
}

export function buildQuestionFormContent(fields, formValues) {
  return fields.reduce((result, field) => {
    const value = formValues[field.id]

    if (field.kind === 'boolean') {
      result[field.id] = Boolean(value)
      return result
    }

    if (field.kind === 'multiselect') {
      result[field.id] = Array.isArray(value) ? value : []
      return result
    }

    if (field.kind === 'number' || field.kind === 'integer') {
      if (value === '' || value == null) return result
      result[field.id] = Number(value)
      return result
    }

    if (field.kind === 'select') {
      const resolved = readQuestionFieldValue(field, formValues)
      if (!resolved && !field.required) return result
      result[field.id] = resolved
      return result
    }

    if (typeof value === 'string') {
      if (!value && !field.required) return result
      result[field.id] = value
    }

    return result
  }, {})
}

export function hasEmptyRequiredQuestionField(fields, formValues) {
  return fields.some((field) => {
    if (!field.required) return false
    const value = formValues[field.id]
    if (field.kind === 'boolean') return value !== true && value !== false
    if (field.kind === 'multiselect') return !Array.isArray(value) || value.length === 0
    if (field.kind === 'select') return !readQuestionFieldValue(field, formValues)
    return value === '' || value == null
  })
}

export function formatData(value) {
  if (value == null) return ''
  if (typeof value === 'string') return value
  return JSON.stringify(value, null, 2)
}

export function buildQuestionCustomValueKey(fieldId) {
  return `${fieldId}__custom`
}

function questionStringOptions(property) {
  if (Array.isArray(property.oneOf)) {
    return property.oneOf
      .filter((item) => item && typeof item === 'object' && typeof item.const === 'string')
      .map((item) => ({
        value: item.const,
        label: item.title || item.const,
      }))
  }

  if (Array.isArray(property.enum)) {
    return property.enum
      .filter((item) => typeof item === 'string')
      .map((item) => ({
        value: item,
        label: item,
      }))
  }

  return []
}

function questionArrayOptions(items) {
  if (!items || typeof items !== 'object') return []

  if (Array.isArray(items.anyOf)) {
    return items.anyOf
      .filter((item) => item && typeof item === 'object' && typeof item.const === 'string')
      .map((item) => ({
        value: item.const,
        label: item.title || item.const,
      }))
  }

  if (Array.isArray(items.enum)) {
    return items.enum
      .filter((item) => typeof item === 'string')
      .map((item) => ({
        value: item,
        label: item,
      }))
  }

  return []
}

function questionInputType(format) {
  if (format === 'email') return 'email'
  if (format === 'uri') return 'url'
  if (format === 'date') return 'date'
  if (format === 'date-time') return 'datetime-local'
  return 'text'
}

function questionAllowsCustomInput(property) {
  return typeof property?.description === 'string' && property.description.includes(CUSTOM_INPUT_HINT)
}

function normalizeQuestionDescription(description) {
  if (typeof description !== 'string') return ''
  return description.replace(CUSTOM_INPUT_HINT, '').trim()
}

function readQuestionFieldValue(field, formValues) {
  const value = formValues[field.id]
  if (field.kind !== 'select' || !field.allowCustom) {
    return typeof value === 'string' ? value : ''
  }
  if (value !== CUSTOM_INPUT_SENTINEL) {
    return typeof value === 'string' ? value : ''
  }
  const customValue = formValues[buildQuestionCustomValueKey(field.id)]
  return typeof customValue === 'string' ? customValue.trim() : ''
}
