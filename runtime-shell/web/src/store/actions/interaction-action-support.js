export function createRequestFailureHandler(input, patch, messagePrefix, cleanup) {
  return (error) => {
    if (cleanup) cleanup()
    input.set(patch)
    input.get().setFlash(`${messagePrefix}: ${readErrorMessage(error)}`)
    throw error
  }
}

export function readErrorMessage(error) {
  if (error instanceof Error && error.message) return error.message
  return String(error)
}
