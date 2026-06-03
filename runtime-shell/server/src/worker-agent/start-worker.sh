#!/usr/bin/env bash
set -euo pipefail

bun /workspace/packages/opencode/src/index.ts serve --hostname 0.0.0.0 --port 4096 &
opencode_pid=$!

bun /workspace/runtime-shell/server/src/worker-agent/index.ts &
agent_pid=$!

cleanup() {
  kill "$opencode_pid" "$agent_pid" 2>/dev/null || true
  wait "$agent_pid" 2>/dev/null || true
}

trap cleanup EXIT INT TERM

wait -n "$opencode_pid" "$agent_pid"
