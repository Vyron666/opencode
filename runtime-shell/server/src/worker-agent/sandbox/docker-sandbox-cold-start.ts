import { runWithColdStartGate, runWithRuntimeBootGate, runWithWarmPoolBootGate } from "./docker-sandbox-state"

export function runColdStartWorkspacePrepare<T>(task: () => Promise<T>) {
  // 中文/English: workspace copy is part of the same cold-start budget as
  // runtime-home prepare and first container boot, so high concurrency degrades
  // into controlled wait instead of parallel resource spikes.
  return runWithColdStartGate(task)
}

export function runColdStartRuntimeHomePrepare<T>(task: () => Promise<T>) {
  // 中文/English: runtime-home seed/copy competes with workspace copy and boot IO,
  // so it must stay inside the shared cold-start back-pressure window.
  return runWithColdStartGate(task)
}

export function runColdStartContainerBoot<T>(task: () => Promise<T>) {
  // 中文/English: cold ACP container boot needs both the global cold-start budget
  // and the narrower runtime-boot budget for actual container bring-up.
  return runWithColdStartGate(() => runWithRuntimeBootGate(task))
}

export function runColdStartWarmSlotCreate<T>(task: () => Promise<T>) {
  // 中文/English: warm-slot creation is still a cold-start cost and must not
  // bypass the same shared budget that protects live business opens.
  return runWithColdStartGate(() => runWithWarmPoolBootGate(task))
}
