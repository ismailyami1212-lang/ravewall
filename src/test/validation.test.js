import { describe, expect, it } from 'vitest'
import {
  businessSetupSchema,
  fieldErrors,
  loginSchema,
  signupSchema,
  slugify,
  slugSchema,
  testimonialSubmissionSchema,
  validate,
} from '../shared/validation.js'

describe('slugify', () => {
  it('normalises a business name into a link-safe slug', () => {
    expect(slugify('Northwind Studio')).toBe('northwind-studio')
    expect(slugify('  Café  &  Co.  ')).toBe('cafe-co')
    expect(slugify('---Already---Dashed---')).toBe('already-dashed')
    expect(slugify('')).toBe('')
  })

  it('caps the slug at the maximum length', () => {
    expect(slugify('a'.repeat(80)).length).toBe(40)
  })
})

describe('slugSchema', () => {
  it('accepts a valid slug', () => {
    expect(slugSchema.parse('northwind')).toBe('northwind')
    expect(slugSchema.parse('  north-wind-2 ')).toBe('north-wind-2')
  })

  it('rejects reserved, short, uppercase and malformed slugs', () => {
    for (const bad of ['ab', 'Dashboard', 'north wind', '-leading', 'trailing-', 'double--dash']) {
      expect(slugSchema.safeParse(bad).success, bad).toBe(false)
    }
    expect(slugSchema.safeParse('admin').success).toBe(false)
    expect(slugSchema.safeParse('settings').success).toBe(false)
  })
})

describe('signupSchema', () => {
  it('lowercases and trims the email', () => {
    const parsed = signupSchema.parse({
      email: '  Mara@Example.COM ',
      password: 'Passw0rd!',
      name: '  Mara Ellis  ',
    })
    expect(parsed.email).toBe('mara@example.com')
    expect(parsed.name).toBe('Mara Ellis')
  })

  it('enforces password strength', () => {
    const base = { email: 'a@b.com', name: 'A' }
    expect(signupSchema.safeParse({ ...base, password: 'short1' }).success).toBe(false)
    expect(signupSchema.safeParse({ ...base, password: 'alllettersnodigits' }).success).toBe(false)
    expect(signupSchema.safeParse({ ...base, password: '12345678' }).success).toBe(false)
    expect(signupSchema.safeParse({ ...base, password: 'Passw0rd!' }).success).toBe(true)
  })

  it('reports the failing field', () => {
    const result = validate(signupSchema, { email: 'nope', password: 'x', name: '' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.email).toMatch(/valid email/i)
    expect(result.errors.password).toBeDefined()
    expect(result.errors.name).toBeDefined()
  })
})

describe('loginSchema', () => {
  it('does not apply signup password rules to login', () => {
    // An existing account may predate the current strength rules.
    expect(loginSchema.safeParse({ email: 'a@b.com', password: 'legacy' }).success).toBe(true)
    expect(loginSchema.safeParse({ email: 'a@b.com', password: '' }).success).toBe(false)
  })
})

describe('businessSetupSchema', () => {
  it('applies defaults for optional fields', () => {
    const parsed = businessSetupSchema.parse({ name: 'Northwind', slug: 'northwind' })
    expect(parsed.tagline).toBe('')
    expect(parsed.logoUrl).toBe('')
    expect(parsed.accentColor).toBe('#15803d')
  })

  it('rejects a non-http logo and an invalid colour', () => {
    expect(
      businessSetupSchema.safeParse({ name: 'N', slug: 'northwind', logoUrl: 'javascript:alert(1)' })
        .success,
    ).toBe(false)
    expect(
      businessSetupSchema.safeParse({ name: 'N', slug: 'northwind', accentColor: 'red' }).success,
    ).toBe(false)
  })

  it('accepts a valid https logo', () => {
    const parsed = businessSetupSchema.parse({
      name: 'N',
      slug: 'northwind',
      logoUrl: 'https://cdn.example.com/logo.png',
    })
    expect(parsed.logoUrl).toBe('https://cdn.example.com/logo.png')
  })
})

describe('testimonialSubmissionSchema', () => {
  const valid = {
    rating: 5,
    name: 'Mara',
    company: 'Northwind',
    text: 'They shipped ahead of schedule and it worked.',
  }

  it('accepts a well formed submission and defaults the company', () => {
    const parsed = testimonialSubmissionSchema.parse(valid)
    expect(parsed.rating).toBe(5)
    expect(testimonialSubmissionSchema.parse({ ...valid, company: undefined }).company).toBe('')
  })

  it('coerces a numeric string rating', () => {
    expect(testimonialSubmissionSchema.parse({ ...valid, rating: '4' }).rating).toBe(4)
  })

  it('rejects out-of-range ratings and too-short text', () => {
    expect(testimonialSubmissionSchema.safeParse({ ...valid, rating: 0 }).success).toBe(false)
    expect(testimonialSubmissionSchema.safeParse({ ...valid, rating: 6 }).success).toBe(false)
    expect(testimonialSubmissionSchema.safeParse({ ...valid, rating: 3.5 }).success).toBe(false)
    expect(testimonialSubmissionSchema.safeParse({ ...valid, text: 'too short' }).success).toBe(false)
    expect(
      testimonialSubmissionSchema.safeParse({ ...valid, text: 'x'.repeat(1001) }).success,
    ).toBe(false)
  })
})

describe('fieldErrors', () => {
  it('keeps the first message per field', () => {
    const result = signupSchema.safeParse({ email: 'a@b.com', password: '', name: '' })
    if (result.success) throw new Error('expected a failure')
    const errors = fieldErrors(result.error)
    expect(Object.keys(errors).sort()).toEqual(['name', 'password'])
  })
})
