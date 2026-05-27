import path from "node:path"
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { createLogger } from "../log"
import type { RuntimeClientOptions } from "./types"

const log = createLogger("acp")

export function spawnAcpProcess(options: RuntimeClientOptions): ChildProcessWithoutNullStreams {
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
    // 中文/English: 必须在子进程启动前声明 ACP 身份，避免误走 cli 分支。
    OPENCODE_CLIENT: "acp",
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

export function logAcpStderr(proc: ChildProcessWithoutNullStreams) {
  proc.stderr.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf-8").trimEnd()
    if (text) {
      // 中文/English: ACP stderr 是上游认证、模型和协议错误的直接来源，必须原样记日志。
      log.error("acp stderr", { text })
    }
  })
}
