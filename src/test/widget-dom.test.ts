import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mountWidget } from '../widget/mount'
import { embedAttributes, optionsFromElement, parseAccent, parseBoolean, parseCount, parseLayout, parseTheme } from '../widget/options'
import type { WidgetData } from '../widget/types'

const DATA: WidgetData = {
  business: {
    name: 'Northwind Studio',
    slug: 'northwind',
    tagline: 'Design studio',
    logoUrl: '',
    accentColor: '#0d9488',
  },
  testimonials: [
    {
      id: 't1',
      rating: 5,
      name: 'Priya Nair',
      company: 'Cobalt Labs',
      text: '<img src=x onerror="window.__pwned = true">Fast, kind and precise work.',
      createdAt: '2026-10-01T10:00:00.000Z',
    },
    {
      id: 't2',
      rating: 4,
      name: 'Sam Okafor',
      company: '',
      text: 'A second, more ordinary testimonial.',
      createdAt: '2026-09-20T10:00:00.000Z',
    },
  ],
  stats: { count: 2, averageRating: 4.5 },
}

function stubFetch(data: WidgetData = DATA, ok = true) {
  const mock = vi.fn(async () => ({
    ok,
    status: ok ? 200 : 500,
    json: async () => ({ data }),
  }))
  vi.stubGlobal('fetch', mock)
  return mock
}

function hostWithAttrs(attributes: Record<string, string>): HTMLElement {
  const element = document.createElement('div')
  element.setAttribute('data-ravewall-widget', '')
  for (const [key, value] of Object.entries(attributes)) {
    element.setAttribute(key, value)
  }
  document.body.appendChild(element)
  return element
}

beforeEach(() => {
  document.body.innerHTML = ''
})

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('widget option parsing', () => {
  it('falls back to safe defaults for malformed values', () => {
    expect(parseLayout('sideways')).toBe('grid')
    expect(parseLayout('carousel')).toBe('carousel')
    expect(parseTheme('neon')).toBe('light')
    expect(parseAccent('red')).toBe('#15803d')
    expect(parseAccent('#ABCDEF')).toBe('#abcdef')
    expect(parseBoolean('banana')).toBe(true)
    expect(parseBoolean('no', true)).toBe(false)
    expect(parseCount('999')).toBe(50)
    expect(parseCount('0')).toBe(1)
    expect(parseCount('six')).toBe(9)
  })

  it('round-trips options through embed attributes', () => {
    const element = document.createElement('div')
    const options = {
      slug: 'northwind',
      layout: 'compact' as const,
      theme: 'dark' as const,
      accent: '#0d9488',
      accentExplicit: true,
      showStars: false,
      showCompany: true,
      max: 12,
    }
    for (const [key, value] of Object.entries(embedAttributes(options))) {
      element.setAttribute(key, value)
    }
    expect(optionsFromElement(element)).toEqual(options)
  })

  it('marks the accent as non-explicit when the attribute is absent', () => {
    const element = document.createElement('div')
    element.setAttribute('data-rw-slug', 'northwind')
    const options = optionsFromElement(element)
    expect(options.accentExplicit).toBe(false)
  })

  it('falls back to the business accent when the embed omits one', async () => {
    stubFetch()
    const host = hostWithAttrs({ 'data-rw-slug': 'northwind' })
    await mountWidget(host, optionsFromElement(host))
    // DATA.business.accentColor is #0d9488.
    expect(host.shadowRoot?.querySelector('style')?.textContent).toContain('--rw-accent: #0d9488')
  })
})

describe('widget mounting', () => {
  it('renders approved testimonials inside a shadow root', async () => {
    stubFetch()
    const host = hostWithAttrs({ 'data-rw-slug': 'northwind' })
    const result = await mountWidget(host, optionsFromElement(host))

    expect(result).toEqual({ rendered: true, count: 2 })
    const root = host.shadowRoot
    expect(root).not.toBeNull()
    expect(root?.querySelectorAll('.rw-card')).toHaveLength(2)
    expect(root?.querySelector('.rw-powered')?.textContent).toContain('Powered by RaveWall')
  })

  it('treats markup in testimonial content as literal text (no XSS)', async () => {
    stubFetch()
    const host = hostWithAttrs({ 'data-rw-slug': 'northwind' })
    await mountWidget(host, optionsFromElement(host))

    const root = host.shadowRoot
    expect(root?.querySelectorAll('img')).toHaveLength(0)
    expect(root?.querySelectorAll('script')).toHaveLength(0)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((window as any).__pwned).toBeUndefined()
    expect(root?.querySelector('.rw-text')?.textContent).toContain('<img src=x onerror=')
  })

  it('renders nothing when there are no approved testimonials', async () => {
    stubFetch({ ...DATA, testimonials: [] })
    const host = hostWithAttrs({ 'data-rw-slug': 'northwind' })
    const result = await mountWidget(host, optionsFromElement(host))

    expect(result.rendered).toBe(false)
    const root = host.shadowRoot
    expect(root?.querySelectorAll('.rw-card')).toHaveLength(0)
    expect(root?.querySelector('.rw-powered')).toBeNull()
  })

  it('stays silent when the API fails', async () => {
    stubFetch(DATA, false)
    const host = hostWithAttrs({ 'data-rw-slug': 'missing' })
    const result = await mountWidget(host, optionsFromElement(host))
    expect(result.rendered).toBe(false)
  })

  it('refuses to mount without a slug', async () => {
    stubFetch()
    const host = hostWithAttrs({})
    const result = await mountWidget(host, optionsFromElement(host))
    expect(result.rendered).toBe(false)
  })

  it('honours show-company and accent options', async () => {
    stubFetch()
    const host = hostWithAttrs({
      'data-rw-slug': 'northwind',
      'data-rw-company': 'false',
      'data-rw-accent': '#123456',
      'data-rw-theme': 'dark',
    })
    await mountWidget(host, optionsFromElement(host))

    const root = host.shadowRoot
    // Company exists on t1 but must be hidden.
    const who = root?.querySelectorAll('.rw-who span')
    expect(who).toHaveLength(0)
    expect(root?.querySelector('.rw-root')?.getAttribute('data-theme')).toBe('dark')
    expect(root?.querySelector('style')?.textContent).toContain('--rw-accent: #123456')
  })

  it('caps the number of rendered testimonials at max', async () => {
    stubFetch()
    const host = hostWithAttrs({ 'data-rw-slug': 'northwind', 'data-rw-max': '1' })
    const result = await mountWidget(host, optionsFromElement(host))
    expect(result.count).toBe(1)
  })

  it('renders the carousel with keyboard-reachable controls', async () => {
    stubFetch()
    const host = hostWithAttrs({ 'data-rw-slug': 'northwind', 'data-rw-layout': 'carousel' })
    await mountWidget(host, optionsFromElement(host))

    const root = host.shadowRoot
    const prev = root?.querySelector('button[aria-label="Previous testimonial"]') as HTMLButtonElement
    const next = root?.querySelector('button[aria-label="Next testimonial"]') as HTMLButtonElement
    expect(prev).toBeTruthy()
    expect(next).toBeTruthy()
    expect(root?.querySelectorAll('.rw-carousel-slide')).toHaveLength(2)
    expect(root?.querySelector('.rw-dot[aria-current="true"]')).toBeTruthy()

    next.click()
    expect(root?.querySelector('.rw-carousel-track')?.getAttribute('style')).toContain(
      'translateX(-100%)',
    )
    expect(root?.querySelectorAll('.rw-dot[aria-current="true"]')).toHaveLength(1)
  })

  it('replaces the shadow tree on a second mount (preview re-render)', async () => {
    stubFetch()
    const host = hostWithAttrs({ 'data-rw-slug': 'northwind' })
    await mountWidget(host, optionsFromElement(host))
    await mountWidget(host, optionsFromElement(host))
    expect(host.shadowRoot?.querySelectorAll('.rw-card')).toHaveLength(2)
  })
})
