export function createConcurrencyGate(limit: number) {
  const maxConcurrent = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 1
  let running = 0
  const waiters: Array<() => void> = []

  return async function runWithConcurrencyGate<T>(task: () => Promise<T>) {
    await enterGate()
    try {
      return await task()
    } finally {
      leaveGate()
    }
  }

  async function enterGate() {
    if (running < maxConcurrent) {
      running += 1
      return
    }
    await new Promise<void>((resolve) => {
      waiters.push(resolve)
    })
    running += 1
  }

  function leaveGate() {
    running = Math.max(0, running - 1)
    const next = waiters.shift()
    next?.()
  }
}
