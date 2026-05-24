const levels = ["debug", "info", "warn", "error"] as const
type Level = (typeof levels)[number]

const envLevel = (process.env.RUNTIME_SHELL_LOG_LEVEL?.toLowerCase() ?? "info") as Level
const minLevel = levels.indexOf(envLevel) >= 0 ? levels.indexOf(envLevel) : 1

function shouldLog(level: Level) {
  return levels.indexOf(level) >= minLevel
}

function format(level: Level, service: string, message: string, extra?: Record<string, unknown>) {
  const ts = new Date().toISOString()
  const base = `${ts} [${level.toUpperCase().padEnd(5)}] [${service}] ${message}`
  if (!extra || !Object.keys(extra).length) return base
  const pairs = Object.entries(extra)
    .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join(" ")
  return `${base} ${pairs}`
}

function out(level: Level, text: string) {
  if (level === "error" || level === "warn") {
    process.stderr.write(text + "\n")
    return
  }
  process.stdout.write(text + "\n")
}

export type Logger = {
  debug: (message: string, extra?: Record<string, unknown>) => void
  info: (message: string, extra?: Record<string, unknown>) => void
  warn: (message: string, extra?: Record<string, unknown>) => void
  error: (message: string, extra?: Record<string, unknown>) => void
}

export function createLogger(service: string): Logger {
  return {
    debug(message, extra) {
      if (!shouldLog("debug")) return
      out("debug", format("debug", service, message, extra))
    },
    info(message, extra) {
      if (!shouldLog("info")) return
      out("info", format("info", service, message, extra))
    },
    warn(message, extra) {
      if (!shouldLog("warn")) return
      out("warn", format("warn", service, message, extra))
    },
    error(message, extra) {
      out("error", format("error", service, message, extra))
    },
  }
}
