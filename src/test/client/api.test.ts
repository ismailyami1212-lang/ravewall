import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, api, copyText, testimonialToText } from '../../client/api'
import { jsonResponse } from '../setup'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('testimonialToText', () => {
  it('formats a quote with the company when present', () => {
    expect(
      testimonialToText({ text: 'Great work.', name: 'Mara', company: 'Northwind', rating: 5 }),
    ).toBe('"Great work."\n— Mara, Northwind (5/5)')
  })

  it('omits the company when it is empty', () => {
    expect(testimonialToText({ text: 'Great work.', name: 'Mara', rating: 4 })).toBe(
      '"Great work."\n— Mara (4/5)',
    )
  })
})

describe('copyText', () => {
  it('uses the async clipboard in a secure context', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true })

    await expect(copyText('hello')).resolves.toBe(true)
    expect(writeText).toHaveBeenCalledWith('hello')
  })

  it('falls back to the legacy path and reports failure honestly', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
    Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true })
    // jsdom has no execCommand, so the fallback cannot succeed.
    await expect(copyText('hello')).resolves.toBe(false)
  })
})

describe('api error handling', () => {
  it('throws an ApiError carrying per-field messages', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(
          {
            error: {
              code: 'bad_request',
              message: 'Please check the highlighted fields.',
              fields: { slug: 'That link name is taken.' },
            },
          },
          400,
        ),
      ),
    )

    const error = await api.createBusiness({ name: 'A', slug: 'taken' }).catch((thrown) => thrown)
    expect(error).toBeInstanceOf(ApiError)
    expect(error.status).toBe(400)
    expect(error.code).toBe('bad_request')
    expect(error.fields.slug).toBe('That link name is taken.')
  })

  it('reports a network failure without leaking internals', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed')
      }),
    )
    const error = await api.me().catch((thrown) => thrown)
    expect(error).toBeInstanceOf(ApiError)
    expect(error.code).toBe('network')
    expect(error.message).toMatch(/could not reach the server/i)
  })

  it('sends cookies with every request', async () => {
    const mock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse({ data: { user: null, business: null } }),
    )
    vi.stubGlobal('fetch', mock)
    await api.me()
    expect(mock.mock.calls[0][1]).toMatchObject({ credentials: 'same-origin' })
  })

  it('treats a 204 as an empty success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(null, 204)))
    await expect(api.logout()).resolves.toBeUndefined()
  })
})
