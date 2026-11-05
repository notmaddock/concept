import { act } from 'react'

export async function waitForAct(
  assertion: () => void | Promise<void>,
  { timeout = 1000 }: { timeout?: number } = {},
) {
  const deadline = Date.now() + timeout
  for (;;) {
    // Keep external work such as IndexedDB callbacks inside act between assertions.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
    try {
      await assertion()
      return
    } catch (error) {
      if (Date.now() >= deadline) throw error
    }
  }
}
