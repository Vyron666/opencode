export const databaseDialects = ["postgres", "mysql"] as const

export type DatabaseDialect = (typeof databaseDialects)[number]

export function isDatabaseDialect(value: string): value is DatabaseDialect {
  return databaseDialects.includes(value as DatabaseDialect)
}
