import { useEffect, useRef, useState } from 'react'
import { LAYOUTS } from '../../widget/options'
import { mountWidgetWithData } from '../../widget/mount'
import type { WidgetData, WidgetLayout } from '../../widget/types'

const LAYOUT_LABEL: Record<WidgetLayout, string> = {
  grid: 'Grid',
  carousel: 'Carousel',
  single: 'Single',
  compact: 'Compact',
}

/**
 * Example widget data for the marketing page. Clearly fictional, labelled as
 * an example in the surrounding copy — never presented as a real customer.
 */
const EXAMPLE: WidgetData = {
  business: {
    name: 'Northwind Studio',
    slug: 'example',
    tagline: 'Design studio for ambitious teams',
    logoUrl: '',
    accentColor: '#15803d',
  },
  testimonials: [
    {
      id: 'ex-1',
      rating: 5,
      name: 'Example customer',
      company: 'Example Co.',
      text: 'We had twelve good sentences buried in email threads. Now they sit on the site, where people actually read them.',
      createdAt: '2026-09-18T10:00:00.000Z',
    },
    {
      id: 'ex-2',
      rating: 5,
      name: 'Example customer',
      company: 'Second example',
      text: 'I send the link the day we ship. Whatever comes back waits for me — nothing goes live by accident.',
      createdAt: '2026-09-12T10:00:00.000Z',
    },
    {
      id: 'ex-3',
      rating: 4,
      name: 'Example customer',
      company: 'Third example',
      text: 'Set it up on a Tuesday. The wall has looked like our own brand ever since.',
      createdAt: '2026-09-02T10:00:00.000Z',
    },
  ],
  stats: { count: 3, averageRating: 4.7 },
}

/**
 * Widget showcase driven by the REAL renderer (`mountWidgetWithData`), so the
 * demonstration is always the same code that ships to customer websites.
 */
export function WidgetShowcase() {
  const [layout, setLayout] = useState<WidgetLayout>('grid')
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    mountWidgetWithData(host, EXAMPLE, {
      slug: 'example',
      layout,
      theme: 'light',
      accent: '#15803d',
      accentExplicit: true,
      showStars: true,
      showCompany: true,
      max: 6,
    })
  }, [layout])

  return (
    <div>
      <div className="mkt-switch" role="group" aria-label="Widget layout">
        {LAYOUTS.map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={layout === value}
            onClick={() => setLayout(value)}
          >
            {LAYOUT_LABEL[value]}
          </button>
        ))}
      </div>

      <div className="mkt-site" style={{ marginTop: 22 }}>
        <div className="mkt-site-chrome" aria-hidden="true">
          <span className="mkt-site-dot" />
          <span className="mkt-site-dot" />
          <span className="mkt-site-dot" />
          <span className="mkt-site-url">yourstudio.com</span>
        </div>
        <div className="mkt-site-body">
          <p className="mkt-site-heading">What our clients say</p>
          {/* The widget mounts its own Shadow DOM here — real renderer, real isolation. */}
          <div className="mkt-site-host" ref={hostRef} />
        </div>
      </div>

      <p className="mkt-widget-note">
        <span>Example content, rendered by the same widget your site loads.</span>
        <span>No framework. One script tag.</span>
      </p>
    </div>
  )
}
