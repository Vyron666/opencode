import path from "node:path"
import os from "node:os"
import fs from "node:fs"
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { createLogger } from "../log"
import type { RuntimeClientOptions } from "./types"

const log = createLogger("acp")
const DEFAULT_ACP_CONFIG_PATH = path.resolve(import.meta.dir, "../../../config/opencode.example.jsonc")
const DEFAULT_ACP_MODELS_PATH = path.resolve(import.meta.dir, "../../../config/models-api.runtime.json")

export function spawnAcpProcess(options: RuntimeClientOptions): ChildProcessWithoutNullStreams {
  ensureLocalOpencodeDbMarker()
  const env = {
    ...process.env,
    // 中文/English: Docker 内也要保证子进程能解析 PATH 里的命令。
    PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin",
    // 中文/English: 固定 UTF-8 locale，避免非 ASCII 文本穿过 stdio 时损坏。
    LANG: process.env.LANG || "C.UTF-8",
    LC_ALL: process.env.LC_ALL || "C.UTF-8",
    // 中文/English: 开启 QuestionTool，把上游提问完整暴露给前端。
    OPENCODE_ENABLE_QUESTION_TOOL: process.env.OPENCODE_ENABLE_QUESTION_TOOL || "1",
    // 中文/English: runtime-shell now defaults to ACP-next so future upstream ACP
    // updates land on the primary path first; allow explicit env override.
    OPENCODE_ACP_NEXT: process.env.OPENCODE_ACP_NEXT || "0",
    // 中文/English: keep a stable base config for builtin provider defaults, but
    // stop auto-scanning the shared repo `.opencode` directory for user-specific provider state.
    OPENCODE_CONFIG: process.env.OPENCODE_CONFIG || DEFAULT_ACP_CONFIG_PATH,
    // 中文/English: runtime-shell injects session-scoped config explicitly and
    // must not silently merge the repo root `.opencode` provider settings into every user session.
    OPENCODE_DISABLE_PROJECT_CONFIG: process.env.OPENCODE_DISABLE_PROJECT_CONFIG || "1",
    // 中文/English: runtime-shell keeps a slim built-in model catalog on the ACP
    // cold path; user-defined providers/models still arrive through configContent.
    OPENCODE_MODELS_PATH: process.env.OPENCODE_MODELS_PATH || DEFAULT_ACP_MODELS_PATH,
    // 中文/English: 必须在子进程启动前声明 ACP 身份，避免误走 cli 分支。
    OPENCODE_CLIENT: "acp",
    ...(options.configContent ? { OPENCODE_CONFIG_CONTENT: options.configContent } : {}),
  }
  const entry = process.env.OPENCODE_ACP_ENTRY || path.resolve(import.meta.dir, "../../../packages/opencode/src/index.ts")
  const spawnCwd = process.env.OPENCODE_ACP_SPAWN_CWD || options.cwd
  const args = [entry, "acp", `--cwd=${options.cwd}`]
  log.info("spawning ACP process", {
    command: process.execPath,
    args: args.join(" "),
    cwd: spawnCwd,
    sessionCwd: options.cwd,
  })
  return spawn(process.execPath, args, {
    stdio: ["pipe", "pipe", "pipe"],
    cwd: spawnCwd,
    env,
  })
}

function ensureLocalOpencodeDbMarker() {
  const dataDir = path.join(os.homedir(), ".local", "share", "opencode")
  const marker = path.join(dataDir, "opencode.db")
  fs.mkdirSync(dataDir, { recursive: true })
  if (fs.existsSync(marker)) return
  // 中文/English: touch the default db marker before concurrent ACP boot so
  // multiple first-open sessions do not race on the one-time json migration gate.
  fs.closeSync(fs.openSync(marker, "a"))
}

export function logAcpStderr(proc: ChildProcessWithoutNullStreams, onChunk?: (text: string) => void) {
  proc.stderr.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf-8").trimEnd()
    if (text) {
      onChunk?.(text)
      // 中文/English: ACP stderr 是上游认证、模型和协议错误的直接来源，必须原样记日志。
      log.error("acp stderr", { text })
    }
  })
}
