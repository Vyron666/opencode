import { Writable } from "node:stream"
import net from "node:net"
import Docker from "dockerode"
import { SANDBOX_BRIDGE_PORT, WARM_POOL_RUNTIME_CWD, docker } from "./docker-sandbox-state"

export async function connectSandboxBridge(container: Docker.Container) {
  const info = await container.inspect()
  const host = Object.values(info.NetworkSettings?.Networks || {}).find((network) => network.IPAddress)?.IPAddress
  if (!host) throw new Error("docker sandbox bridge address is unavailable")
  return connectTcp(host, SANDBOX_BRIDGE_PORT, 50)
}

export async function connectTcp(host: string, port: number, attempts: number): Promise<net.Socket> {
  try {
    return await new Promise<net.Socket>((resolve, reject) => {
      const socket = net.connect({ host, port })
      socket.once("connect", () => resolve(socket))
      socket.once("error", reject)
    })
  } catch (error) {
    if (attempts <= 1) throw error
    await delay(200)
    return connectTcp(host, port, attempts - 1)
  }
}

export function createBridgeScript() {
  return `
const net = require("node:net")
const { spawn } = require("node:child_process")
const server = net.createServer((socket) => {
  let handshakeBuffer = ""
  const onHandshakeData = (chunk) => {
    handshakeBuffer += chunk.toString("utf8")
    const newlineIndex = handshakeBuffer.indexOf("\\n")
    if (newlineIndex < 0) return
    socket.off("data", onHandshakeData)
    const line = handshakeBuffer.slice(0, newlineIndex)
    const rest = handshakeBuffer.slice(newlineIndex + 1)
    const handshake = line ? JSON.parse(line) : {}
    const childEnv = { ...process.env }
    if (handshake.configB64) {
      childEnv.OPENCODE_CONFIG_CONTENT = Buffer.from(handshake.configB64, "base64").toString("utf8")
    } else {
      delete childEnv.OPENCODE_CONFIG_CONTENT
    }
    let childStopTimer
    let child = spawn("bun", [process.env.RUNTIME_SHELL_ACP_ENTRY, "acp", "--print-logs", "--cwd=" + (handshake.cwd || "${WARM_POOL_RUNTIME_CWD}")], {
      // 中文/English: start ACP inside the target sandbox workspace so upstream
      // bootstrap does not materialize a separate repo-root instance first.
      cwd: handshake.cwd || process.env.RUNTIME_SHELL_ACP_SPAWN_CWD,
      env: childEnv,
      stdio: ["pipe", "pipe", "pipe"],
    })
    const stopChild = () => {
      if (!child || child.exitCode !== null || child.killed) return
      child.kill("SIGTERM")
      childStopTimer = setTimeout(() => {
        if (!child || child.exitCode !== null || child.killed) return
        child.kill("SIGKILL")
      }, 1000)
      childStopTimer.unref?.()
    }
    child.stderr.pipe(process.stderr)
    if (rest) child.stdin.write(rest)
    socket.pipe(child.stdin)
    child.stdout.pipe(socket)
    child.on("exit", () => {
      if (childStopTimer) clearTimeout(childStopTimer)
      socket.end()
    })
    // 中文/English: warm containers can outlive many ACP sessions, so closing the
    // bridge socket must also stop the child process to avoid heap drift.
    socket.once("close", stopChild)
    socket.once("end", stopChild)
    socket.once("error", stopChild)
  }
  socket.on("data", onHandshakeData)
})
server.listen(Number(process.env.RUNTIME_SHELL_BRIDGE_PORT || "${SANDBOX_BRIDGE_PORT}"), "0.0.0.0")
`.trim()
}

export function delay(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
}

export async function followContainerStderr(container: Docker.Container, stderr: NodeJS.WritableStream) {
  try {
    const stream = await container.logs({
      follow: true,
      stdout: true,
      stderr: true,
    })
    const discard = new Writable({
      write(_chunk, _encoding, callback) {
        callback()
      },
    })
    docker.modem.demuxStream(stream, discard, stderr)
    stream.once("end", () => {
      discard.end()
    })
    stream.once("error", () => {
      discard.end()
    })
  } catch (error) {
    stderr.write(`failed to follow sandbox stderr: ${error instanceof Error ? error.message : String(error)}\n`)
  }
}

export function createExitState() {
  let settled:
    | {
        code: number | null
        signal: NodeJS.Signals | null
      }
    | undefined
  const handlers: Array<(code: number | null, signal: NodeJS.Signals | null) => void> = []
  return {
    onExit(handler: (code: number | null, signal: NodeJS.Signals | null) => void) {
      if (settled) {
        handler(settled.code, settled.signal)
        return
      }
      handlers.push(handler)
    },
    settle(result: { code: number | null; signal: NodeJS.Signals | null }) {
      if (settled) return
      settled = result
      while (handlers.length > 0) {
        const next = handlers.shift()
        next?.(result.code, result.signal)
      }
    },
  }
}
