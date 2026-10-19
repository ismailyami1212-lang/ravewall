import { describe, expect, it } from 'vitest'
import { SlidingWindowLimiter } from '../server/rateLimit.js'

// The limiter records a sweep timestamp when it is constructed, so tests drive it
// with real wall-clock timestamps rather than an arbitrary origin.
const BASE = Date.now()

describe('SlidingWindowLimiter', () => {
  it('allows up to the limit and then blocks', () => {
    const limiter = new SlidingWindowLimiter({ windowMs: 1000, max: 3 })
    expect(limiter.hit('a', BASE).allowed).toBe(true)
    expect(limiter.hit('a', BASE + 1).allowed).toBe(true)
    const third = limiter.hit('a', BASE + 2)
    expect(third.allowed).toBe(true)
    expect(third.remaining).toBe(0)

    const blocked = limiter.hit('a', BASE + 3)
    expect(blocked.allowed).toBe(false)
    // The oldest hit (BASE) expires at BASE + 1000.
    expect(blocked.retryAfterMs).toBe(997)
  })

  it('keeps keys independent', () => {
    const limiter = new SlidingWindowLimiter({ windowMs: 1000, max: 1 })
    expect(limiter.hit('a', BASE).allowed).toBe(true)
    expect(limiter.hit('b', BASE).allowed).toBe(true)
    expect(limiter.hit('a', BASE + 1).allowed).toBe(false)
    expect(limiter.hit('b', BASE + 1).allowed).toBe(false)
  })

  it('frees capacity once hits fall outside the window', () => {
    const limiter = new SlidingWindowLimiter({ windowMs: 1000, max: 2 })
    limiter.hit('a', BASE)
    limiter.hit('a', BASE + 100)
    expect(limiter.hit('a', BASE + 200).allowed).toBe(false)
    // Both earlier hits are outside the window by BASE + 1100.
    expect(limiter.hit('a', BASE + 1100).allowed).toBe(true)
  })

  it('reports the remaining allowance', () => {
    const limiter = new SlidingWindowLimiter({ windowMs: 1000, max: 5 })
    expect(limiter.hit('a', BASE).remaining).toBe(4)
    expect(limiter.hit('a', BASE).remaining).toBe(3)
  })

  it('sweeps expired buckets instead of growing without bound', () => {
    const limiter = new SlidingWindowLimiter({ windowMs: 100, max: 1 })
    for (let i = 0; i < 50; i += 1) limiter.hit(`key-${i}`, BASE + i)
    expect(limiter.buckets.size).toBeGreaterThan(1)
    // A hit far enough in the future triggers a sweep that clears every stale bucket.
    limiter.hit('fresh', BASE + 10_000)
    expect(limiter.buckets.size).toBe(1)
    expect(limiter.buckets.has('fresh')).toBe(true)
  })
})
