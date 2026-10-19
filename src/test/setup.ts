import '@testing-library/jest-dom/vitest'
import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

// jsdom has no secure context, so clipboard tests opt in explicitly.
if (!('clipboard' in navigator)) {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true,
  })
}

/** Minimal `Response` stand-in: the API client only reads ok/status/text(). */
export function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status < 400,
    status,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}
