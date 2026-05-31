const DEFAULT_UPSTREAM_QUIET_WINDOW_MS = 120

export function createUpstreamDrainController(quietWindowMs = DEFAULT_UPSTREAM_QUIET_WINDOW_MS) {
  let upstreamEventVersion = 0
  let lastUpstreamEventAt = 0
  let lastUpstreamWrite = Promise.resolve()

  return {
    track<T>(write: Promise<T>) {
      upstreamEventVersion += 1
      lastUpstreamEventAt = Date.now()
      lastUpstreamWrite = write.then(
        () => undefined,
        () => undefined,
      )
      return write
    },

    async waitForQuiet() {
      while (true) {
        const observedVersion = upstreamEventVersion
        const observedWrite = lastUpstreamWrite
        const observedEventAt = lastUpstreamEventAt

        await observedWrite
        const quietForMs = observedEventAt ? Date.now() - observedEventAt : Number.POSITIVE_INFINITY
        const waitMs = Math.max(quietWindowMs - quietForMs, 0)
        if (waitMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, waitMs))
        }
        if (
          observedVersion === upstreamEventVersion &&
          observedWrite === lastUpstreamWrite &&
          observedEventAt === lastUpstreamEventAt
        ) {
          return
        }
      }
    },
  }
}
