import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Pricing } from '../../client/pages/Pricing'

function renderPricing() {
  return render(
    <MemoryRouter>
      <Pricing />
    </MemoryRouter>,
  )
}

/** The plan card for a given plan name. */
function plan(name: string): HTMLElement {
  return screen.getByRole('article', { name: new RegExp(`^${name}`) })
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('pricing page', () => {
  it('renders all four plans with monthly prices', () => {
    renderPricing()
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument()

    expect(within(plan('Free')).getByText('$0')).toBeInTheDocument()
    expect(within(plan('Free')).getByText('forever')).toBeInTheDocument()
    expect(within(plan('Starter')).getByText('$5')).toBeInTheDocument()
    expect(within(plan('Pro')).getByText('$9')).toBeInTheDocument()
    expect(within(plan('Agency')).getByText('$29')).toBeInTheDocument()
  })

  it('switches to annual prices without reloading', async () => {
    const user = userEvent.setup()
    renderPricing()

    await user.click(screen.getByRole('button', { name: 'Yearly' }))

    expect(within(plan('Starter')).getByText('$50')).toBeInTheDocument()
    expect(within(plan('Pro')).getByText('$90')).toBeInTheDocument()
    expect(within(plan('Agency')).getByText('$290')).toBeInTheDocument()
    // Free stays free.
    expect(within(plan('Free')).getByText('$0')).toBeInTheDocument()
    expect(screen.getByText(/two months free on annual plans/i)).toBeInTheDocument()
    // The monthly equivalent is shown for each paid plan.
    expect(within(plan('Starter')).getByText('≈ $4.17 / month')).toBeInTheDocument()
  })

  it('exposes the billing toggle as an accessible pressed state', async () => {
    const user = userEvent.setup()
    renderPricing()
    const monthly = screen.getByRole('button', { name: 'Monthly' })
    const yearly = screen.getByRole('button', { name: 'Yearly' })

    expect(monthly).toHaveAttribute('aria-pressed', 'true')
    expect(yearly).toHaveAttribute('aria-pressed', 'false')

    await user.click(yearly)
    expect(monthly).toHaveAttribute('aria-pressed', 'false')
    expect(yearly).toHaveAttribute('aria-pressed', 'true')
  })

  it('marks Agency as live and gives it the same Early Access CTA as other plans', () => {
    renderPricing()
    const agency = plan('Agency')
    // Agency features are live during Early Access, so it gets a CTA like other plans.
    expect(within(agency).queryAllByText(/coming soon/i)).toHaveLength(0)
    expect(within(agency).queryAllByText(/not available yet/i)).toHaveLength(0)
    const cta = within(agency).getByRole('link')
    expect(cta).toHaveAttribute('href', '/signup')
    expect(cta.textContent).toMatch(/start free/i)
  })

  it('communicates Early Access and the founding-member offer', () => {
    renderPricing()
    expect(screen.getByText(/early access · free right now/i)).toBeInTheDocument()
    expect(screen.getByText(/no credit card, no trial clock/i)).toBeInTheDocument()
    expect(screen.getAllByText(/50% off their first year/i).length).toBeGreaterThan(0)
    expect(screen.getByText(/every feature that exists in ravewall is free/i)).toBeInTheDocument()
  })

  it('labels only genuinely unbuilt features as Soon', () => {
    renderPricing()
    const soonItems = document.querySelectorAll('.mkt-plan-features li.is-soon')
    // Only unbuilt features remain marked Soon: client limits, branding removal,
    // priority support, white-label.
    expect(soonItems.length).toBeGreaterThan(3)

    const soonText = Array.from(soonItems)
      .map((item) => item.textContent ?? '')
      .join(' | ')
    // Features that are now live must NOT appear in the Soon list.
    for (const liveFeature of ['CSV export', 'Custom testimonial questions', 'Tags and categories']) {
      expect(soonText).not.toContain(liveFeature)
    }
    // Every "soon" item is labelled in text, not only by colour.
    for (const item of Array.from(soonItems)) {
      expect(item.textContent).toMatch(/Soon/)
    }
  })

  it('never calls a payment or checkout API', async () => {
    const user = userEvent.setup()
    renderPricing()
    await user.click(screen.getByRole('button', { name: 'Yearly' }))
    // No network calls at all: prices are static and checkout does not exist.
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
    // No card fields anywhere.
    expect(document.querySelector('input[name*="card" i]')).toBeNull()
    // No checkout affordance exists — the word only appears in the FAQ prose.
    expect(screen.queryByRole('button', { name: /checkout|buy|subscribe/i })).toBeNull()
    expect(screen.queryByRole('link', { name: /checkout|buy|subscribe/i })).toBeNull()
  })

  it('points paid-plan CTAs at signup during Early Access', () => {
    renderPricing()
    const starter = within(plan('Starter')).getByRole('link')
    const pro = within(plan('Pro')).getByRole('link')
    expect(starter).toHaveAttribute('href', '/signup')
    expect(pro).toHaveAttribute('href', '/signup')
    expect(starter.textContent).toMatch(/start free during early access/i)
    expect(within(plan('Free')).getByRole('link')).toHaveAttribute('href', '/signup')
  })

  it('renders an accessible comparison table', () => {
    renderPricing()
    const table = screen.getByRole('table')
    expect(within(table).getByRole('columnheader', { name: 'Free' })).toBeInTheDocument()
    expect(within(table).getByRole('columnheader', { name: 'Agency' })).toBeInTheDocument()
    expect(within(table).getByRole('rowheader', { name: /CSV export/i })).toBeInTheDocument()
    // The explanatory note sits outside the scroll container but describes the table.
    expect(table).toHaveAttribute('aria-describedby', 'compare-note')
    expect(screen.getByText(/planned but not built/i)).toBeInTheDocument()
  })

  it('answers the awkward questions honestly', () => {
    renderPricing()
    expect(screen.getByText(/is ravewall free right now\?/i)).toBeInTheDocument()
    expect(screen.getByText(/do i need a credit card\?/i)).toBeInTheDocument()
    expect(screen.getByText(/paid subscriptions are not live yet/i)).toBeInTheDocument()
    // Agency features are live now; the old "not yet scheduled" copy is gone.
    expect(screen.getByText(/are the agency features available now\?/i)).toBeInTheDocument()
  })
})
