import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { MarketingFooter } from '../components/MarketingFooter'
import { MarketingNav } from '../components/MarketingNav'
import '../marketing.css'

type Billing = 'monthly' | 'yearly'

/**
 * Feature availability, audited against the running product.
 *
 * `live` — works today (and is free for everyone during Early Access).
 * `soon` — planned for this plan when paid plans launch; not built yet.
 * Anything not built is labelled "Soon" in the UI, never sold as available.
 */
type Availability = 'live' | 'soon'

interface Feature {
  label: string
  state: Availability
}

interface Plan {
  id: string
  name: string
  monthly: number | null
  yearly: number | null
  bestFor: string
  features: Feature[]
  featured?: boolean
  comingSoon?: boolean
}

const PLANS: Plan[] = [
  {
    id: 'free',
    name: 'Free',
    monthly: 0,
    yearly: 0,
    bestFor: 'Trying RaveWall on a real client',
    features: [
      { label: 'One client with a collection link and public wall', state: 'live' },
      { label: 'Moderation inbox — approve, reject, delete', state: 'live' },
      { label: 'Five-star ratings', state: 'live' },
      { label: 'All four widget layouts', state: 'live' },
      { label: 'Your logo, tagline and accent colour', state: 'live' },
      { label: 'Search, filter and sort testimonials', state: 'live' },
      { label: 'One client, up to 25 testimonials', state: 'soon' },
    ],
  },
  {
    id: 'starter',
    name: 'Starter',
    monthly: 5,
    yearly: 50,
    bestFor: 'Freelancers running proof for a few clients',
    features: [
      { label: 'Everything in Free', state: 'live' },
      { label: 'Up to 3 clients', state: 'soon' },
      { label: 'Projects inside each client', state: 'live' },
      { label: 'CSV export and import', state: 'live' },
      { label: 'Project and workspace analytics', state: 'live' },
      { label: 'Remove the “Powered by RaveWall” line', state: 'soon' },
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    monthly: 9,
    yearly: 90,
    bestFor: 'Studios managing a steady roster',
    featured: true,
    features: [
      { label: 'Everything in Starter', state: 'live' },
      { label: 'Up to 10 clients', state: 'soon' },
      { label: 'Custom testimonial questions', state: 'live' },
      { label: 'Tags and categories', state: 'live' },
      { label: 'Saved widgets with rating and tag filters', state: 'live' },
      { label: 'Priority support', state: 'soon' },
    ],
  },
  {
    id: 'agency',
    name: 'Agency',
    monthly: 29,
    yearly: 290,
    bestFor: 'Agencies running proof for many clients',
    features: [
      { label: 'Everything in Pro', state: 'live' },
      { label: 'One workspace with multiple clients', state: 'live' },
      { label: 'Agency dashboard with attention items', state: 'live' },
      { label: 'Team roles and client-scoped access', state: 'live' },
      { label: 'Per-client analytics', state: 'live' },
      { label: 'White-label widgets and forms', state: 'soon' },
    ],
  },
]

const COMPARISON: { label: string; values: (string | { soon: string })[] }[] = [
  { label: 'Clients', values: ['1', { soon: '3' }, { soon: '10' }, 'Unlimited'] },
  { label: 'Projects per client', values: ['Unlimited', 'Unlimited', 'Unlimited', 'Unlimited'] },
  { label: 'Widget layouts', values: ['4', '4', '4', '4'] },
  { label: 'Moderation inbox', values: ['Yes', 'Yes', 'Yes', 'Yes'] },
  { label: 'Remove RaveWall branding', values: ['—', { soon: 'Yes' }, { soon: 'Yes' }, { soon: 'Yes' }] },
  { label: 'CSV export and import', values: ['—', 'Yes', 'Yes', 'Yes'] },
  { label: 'Analytics', values: ['Basic', 'Project + workspace', 'Project + workspace', 'Per client'] },
  { label: 'Custom questions', values: ['—', '—', 'Yes', 'Yes'] },
  { label: 'Tags and categories', values: ['—', '—', 'Yes', 'Yes'] },
  { label: 'Team roles and client access', values: ['—', '—', '—', 'Yes'] },
  { label: 'White-label', values: ['—', '—', '—', { soon: 'Yes' }] },
]

const FAQ = [
  {
    q: 'Is RaveWall free right now?',
    a: 'Yes. RaveWall is in Early Access, so every feature that exists today is free. No trial clock, no feature gates.',
  },
  {
    q: 'Do I need a credit card?',
    a: 'No. We do not ask for payment details during Early Access, and there is no checkout on this site yet.',
  },
  {
    q: 'What happens when Early Access ends?',
    a: 'Paid plans switch on at the prices above. Anyone who joined during Early Access gets 50% off their first year. The Free plan stays free.',
  },
  {
    q: 'Will I lose my testimonials if I stay on Free?',
    a: 'No. Your approved testimonials stay on your wall. When paid plans launch, Free will cover one wall and up to 25 testimonials.',
  },
  {
    q: 'Can I cancel later?',
    a: 'Paid subscriptions are not live yet, so there is nothing to cancel today. When they launch you will be able to cancel from your account at any time.',
  },
  {
    q: 'Are the agency features available now?',
    a: 'Yes. Multiple clients, projects, team roles, saved widgets and per-client analytics all work today during Early Access. A dedicated Agency plan (billing) will launch later; the price above is planned, not charged.',
  },
]

function priceLabel(plan: Plan, billing: Billing): string {
  if (plan.monthly === 0) return '$0'
  return billing === 'monthly' ? `$${plan.monthly}` : `$${plan.yearly}`
}

function periodLabel(plan: Plan, billing: Billing): string {
  if (plan.monthly === 0) return 'forever'
  return billing === 'monthly' ? '/ month' : '/ year'
}

/** Monthly equivalent, shown under an annual price. */
function monthlyEquivalent(plan: Plan, billing: Billing): string | null {
  if (billing !== 'yearly' || !plan.yearly) return null
  const value = plan.yearly / 12
  return `≈ $${value.toFixed(2)} / month`
}

export function Pricing() {
  const [billing, setBilling] = useState<Billing>('monthly')

  useEffect(() => {
    const previousTitle = document.title
    document.title = 'RaveWall Pricing — free during Early Access'
    const meta = document.querySelector('meta[name="description"]')
    const previousDescription = meta?.getAttribute('content') ?? null
    meta?.setAttribute(
      'content',
      'Simple testimonial software pricing. Free during Early Access, no credit card. Starter $5/month, Pro $9/month, Agency coming soon.',
    )
    let canonical = document.querySelector('link[rel="canonical"]')
    const created = !canonical
    if (!canonical) {
      canonical = document.createElement('link')
      canonical.setAttribute('rel', 'canonical')
      document.head.appendChild(canonical)
    }
    const previousCanonical = canonical.getAttribute('href')
    canonical.setAttribute('href', 'https://ravewall.vercel.app/pricing')

    return () => {
      document.title = previousTitle
      if (previousDescription !== null) meta?.setAttribute('content', previousDescription)
      if (created) canonical?.remove()
      else if (previousCanonical) canonical?.setAttribute('href', previousCanonical)
    }
  }, [])

  return (
    <div className="mkt">
      <MarketingNav />

      <main>
        <section className="mkt-pricing-hero">
          <div className="mkt-gridlines" aria-hidden="true" />
          <div className="mkt-wrap">
            <p className="mkt-ea-badge">Early access · free right now</p>
            <h1 className="mkt-pricing-h1">
              Start free.
              <span className="mkt-h1-soft">Stay cheap when you grow.</span>
            </h1>
            <p className="mkt-hero-sub">
              RaveWall is free during Early Access — no credit card, no trial clock. When paid plans
              launch, they start at $5 a month.
            </p>
            <p className="mkt-ea-note">
              Founding members get <strong>50% off their first year</strong> when paid plans launch.
            </p>
          </div>
        </section>

        <section className="mkt-wrap mkt-pricing-body">
          <div className="mkt-billing">
            <span className="mkt-billing-label" id="billing-label">
              Billing
            </span>
            <div className="mkt-switch" role="group" aria-labelledby="billing-label">
              <button
                type="button"
                aria-pressed={billing === 'monthly'}
                onClick={() => setBilling('monthly')}
              >
                Monthly
              </button>
              <button
                type="button"
                aria-pressed={billing === 'yearly'}
                onClick={() => setBilling('yearly')}
              >
                Yearly
              </button>
            </div>
            <span className="mkt-billing-hint" aria-live="polite">
              {billing === 'yearly' ? 'Two months free on annual plans' : 'Switch to yearly and get two months free'}
            </span>
          </div>

          <p className="mkt-truth-note">
            <strong>Nothing to pay today.</strong> Every feature that exists in RaveWall is free
            during Early Access. The lists below show what each plan will include when paid plans
            launch — items marked <span className="mkt-soon-inline">Soon</span> are not built yet.
          </p>

          <div className="mkt-plans">
            {PLANS.map((plan) => (
              <article
                key={plan.id}
                className={`mkt-plan ${plan.featured ? 'mkt-plan-featured' : ''} ${plan.comingSoon ? 'mkt-plan-soon' : ''}`.trim()}
                aria-labelledby={`plan-${plan.id}`}
              >
                <div className="mkt-plan-head">
                  <h2 id={`plan-${plan.id}`} className="mkt-plan-name">
                    {plan.name}
                  </h2>
                  {plan.featured ? <span className="mkt-plan-flag">Most popular</span> : null}
                  {plan.comingSoon ? <span className="mkt-plan-flag mkt-plan-flag-soon">Coming soon</span> : null}
                </div>

                <p className="mkt-plan-price">
                  <span className="mkt-plan-amount">{priceLabel(plan, billing)}</span>
                  <span className="mkt-plan-period">{periodLabel(plan, billing)}</span>
                  {plan.monthly !== 0 ? <span className="mkt-plan-planned">Planned price</span> : null}
                </p>
                <p className="mkt-plan-sub">
                  {plan.monthly === 0
                    ? 'No card. No expiry.'
                    : monthlyEquivalent(plan, billing) ?? 'Billed monthly'}
                </p>

                <p className="mkt-plan-best">{plan.bestFor}</p>

                <ul className="mkt-plan-features">
                  {plan.features.map((feature) => (
                    <li key={feature.label} className={feature.state === 'soon' ? 'is-soon' : ''}>
                      <span className="mkt-plan-mark" aria-hidden="true">
                        {feature.state === 'soon' ? '○' : '✓'}
                      </span>
                      <span>
                        {feature.label}
                        {feature.state === 'soon' ? <span className="mkt-soon-inline">Soon</span> : null}
                      </span>
                    </li>
                  ))}
                </ul>

                <div className="mkt-plan-cta">
                  {plan.comingSoon ? (
                    <p className="mkt-plan-status">Coming soon — not available yet</p>
                  ) : (
                    <Link to="/signup" className="mkt-btn mkt-btn-primary mkt-btn-block">
                      {plan.monthly === 0 ? 'Start free' : 'Start free during Early Access'}
                    </Link>
                  )}
                  <p className="mkt-plan-fine">
                    {plan.comingSoon
                      ? 'No date yet. We will announce it here first.'
                      : 'No card needed. Paid plans are not on sale yet.'}
                  </p>
                </div>
              </article>
            ))}
          </div>

          <p className="mkt-caption mkt-pricing-caption">
            Prices in US dollars. Annual prices are billed once a year — two months cheaper than
            paying monthly.
          </p>

          <section className="mkt-pricing-section" aria-labelledby="compare-heading">
            <h2 id="compare-heading" className="mkt-h2">
              What each plan will include
            </h2>
            <p className="mkt-table-note" id="compare-note">
              Features marked “Soon” are planned but not built. Everything available today is free
              during Early Access.
            </p>
            <p className="mkt-table-hint" aria-hidden="true">
              Swipe to compare →
            </p>
            <div className="mkt-table-scroll">
              <table className="mkt-table" aria-describedby="compare-note">
                <thead>
                  <tr>
                    <th scope="col">Feature</th>
                    <th scope="col">Free</th>
                    <th scope="col">Starter</th>
                    <th scope="col">Pro</th>
                    <th scope="col">Agency</th>
                  </tr>
                </thead>
                <tbody>
                  {COMPARISON.map((row) => (
                    <tr key={row.label}>
                      <th scope="row">{row.label}</th>
                      {row.values.map((value, index) => (
                        <td key={index}>
                          {typeof value === 'string' ? (
                            value
                          ) : (
                            <>
                              {value.soon} <span className="mkt-soon-inline">Soon</span>
                            </>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="mkt-founding" aria-labelledby="founding-heading">
            <div>
              <p className="mkt-kicker">Founding members</p>
              <h2 id="founding-heading" className="mkt-h2">
                Join now, pay half for the first year.
              </h2>
            </div>
            <div>
              <p className="mkt-lede">
                RaveWall is free while we are in Early Access. If you join now and choose a paid plan
                later, you get 50% off your first year at launch prices.
              </p>
              <p className="mkt-lede">
                No credit card during Early Access, no countdown, no spots running out. It is simply
                cheaper for the people who helped us build it.
              </p>
              <Link to="/signup" className="mkt-btn mkt-btn-primary mkt-btn-lg" style={{ marginTop: 20 }}>
                Start free during Early Access
              </Link>
            </div>
          </section>

          <section className="mkt-pricing-section" aria-labelledby="faq-heading">
            <h2 id="faq-heading" className="mkt-h2">
              Questions people actually ask
            </h2>
            <dl className="mkt-faq">
              {FAQ.map((item) => (
                <div className="mkt-faq-item" key={item.q}>
                  <dt>{item.q}</dt>
                  <dd>{item.a}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="mkt-pricing-end">
            <h2 className="mkt-h2">Start with one link. Decide on a plan later.</h2>
            <p className="mkt-lede">
              Everything RaveWall can do today is free while we are in Early Access.
            </p>
            <Link to="/signup" className="mkt-btn mkt-btn-primary mkt-btn-lg">
              Create your collection link
            </Link>
          </section>
        </section>
      </main>

      <MarketingFooter />
    </div>
  )
}
