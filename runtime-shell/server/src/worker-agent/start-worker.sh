#!/usr/bin/env bash
set -euo pipefail

bun /workspace/runtime-shell/server/src/worker-agent/index.ts &
agent_pid=$!

cleanup() {
  kill "$agent_pid" 2>/dev/null || true
  wait "$agent_pid" 2>/dev/null || true
}

trap cleanup EXIT INT TERM

wait "$agent_pid"
