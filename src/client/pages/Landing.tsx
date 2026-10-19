import { useState } from 'react'
import { Link } from 'react-router-dom'
import { copyText } from '../api'
import { MarketingFooter } from '../components/MarketingFooter'
import { MarketingNav } from '../components/MarketingNav'
import { ModerationDemo } from '../components/ModerationDemo'
import { WidgetShowcase } from '../components/WidgetShowcase'
import '../marketing.css'

/** Clearly-marked example content — never presented as a real endorsement. */
const HERO_QUOTES = [
  {
    rating: 5,
    text: 'We run nine clients through one workspace now. Every collection link and every approval lives in the same place.',
    name: 'Example customer',
    company: 'Example agency',
    large: true,
  },
  {
    rating: 5,
    text: 'I send the link the day we ship. Whatever comes back waits for me — nothing goes live by accident.',
    name: 'Example customer',
    company: 'Second example',
    large: false,
  },
  {
    rating: 4,
    text: 'Set it up on a Tuesday. The wall has looked like our own brand ever since.',
    name: 'Example customer',
    company: 'Third example',
    large: false,
  },
]

const WALL_EXAMPLES = [
  {
    rating: 5,
    text: 'They rebuilt our pricing page in a week and it finally reads like the rest of the site.',
    name: 'Example customer',
    company: 'Example Co.',
  },
  {
    rating: 5,
    text: 'Clear communication, no surprises on the invoice. I have already sent them to two friends.',
    name: 'Example customer',
    company: 'Second example',
  },
  {
    rating: 4,
    text: 'The work speaks for itself, which is exactly why I wanted it written down somewhere.',
    name: 'Example customer',
    company: 'Third example',
  },
]

const STEPS = [
  {
    title: 'Share the link',
    body: 'One permanent address for your business. Put it in a thank-you email, a receipt, or the last screen of onboarding.',
    visual: <span className="mkt-chip">ravewall.app/t/your-studio</span>,
  },
  {
    title: 'They write it',
    body: 'A rating, a name and a few lines. No account, no password, no “verify your email” detour.',
    visual: (
      <div className="mkt-visual-card">
        <span className="mkt-stars" aria-hidden="true">
          ★★★★★
        </span>
        <p style={{ marginTop: 6 }}>“Fast, kind, and the work held up months later.”</p>
      </div>
    ),
  },
  {
    title: 'You approve it',
    body: 'Every submission waits in your inbox. Approve what represents you; reject or delete the rest.',
    visual: (
      <div className="mkt-visual-card" style={{ display: 'flex', gap: 8 }}>
        <span className="mkt-badge mkt-badge-pending">Pending</span>
        <span className="mkt-mini-btn mkt-mini-btn-primary">Approve</span>
        <span className="mkt-mini-btn">Reject</span>
      </div>
    ),
  },
  {
    title: 'It shows up',
    body: 'On your wall, and in the widget on your site. Approved once, current everywhere.',
    visual: (
      <div className="mkt-visual-card">
        <span className="mkt-badge mkt-badge-approved">Approved</span>
        <p style={{ marginTop: 8 }}>Now on your wall and in your site’s widget.</p>
      </div>
    ),
  },
]

const AUDIENCE = [
  { role: 'Agencies', body: 'One link per client, so proof lives with the work instead of a slide deck.' },
  { role: 'Designers', body: 'Turn the feedback you already get into the proof that wins the next project.' },
  { role: 'Consultants', body: 'Ask after every engagement, while the result is still fresh in their mind.' },
  { role: 'Studios', body: 'Show client outcomes in a wall that looks like your own site, not a plugin.' },
]

const EMBED_SNIPPET = `<script src="https://ravewall.vercel.app/widget/ravewall-widget.js" async></script>
<div data-ravewall-widget data-rw-slug="your-studio" data-rw-layout="grid"></div>`

function Quote({
  quote,
}: {
  quote: { rating: number; text: string; name: string; company: string; large?: boolean }
}) {
  return (
    <figure className={`mkt-quote ${quote.large ? 'mkt-quote-lg' : ''}`.trim()}>
      <span className="mkt-stars" aria-hidden="true">
        {'★'.repeat(quote.rating)}
        <span style={{ color: '#e0dbcf' }}>{'★'.repeat(5 - quote.rating)}</span>
      </span>
      <blockquote className="mkt-quote-text" style={{ margin: 0 }}>
        “{quote.text}”
      </blockquote>
      <figcaption className="mkt-quote-meta">
        <span className="mkt-quote-avatar" aria-hidden="true">
          {quote.name.slice(0, 2).toUpperCase()}
        </span>
        <span className="mkt-quote-who">
          <strong>{quote.name}</strong>
          <span>{quote.company}</span>
        </span>
        <span className="mkt-example-tag">Example</span>
      </figcaption>
    </figure>
  )
}

export function Landing() {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    const ok = await copyText(EMBED_SNIPPET)
    setCopied(ok)
    window.setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="mkt">
      <MarketingNav home />

      <main>
        {/* ------------------------------------------------------------ hero */}
        <section className="mkt-hero">
          <div className="mkt-gridlines" aria-hidden="true" />
          <div className="mkt-wrap mkt-hero-grid">
            <div className="mkt-hero-copy">
              <h1>
                <span className="mkt-h1-line">Testimonials for</span>
                <span className="mkt-h1-line">every client.</span>
                <span className="mkt-h1-soft">One simple workspace.</span>
              </h1>
              <p className="mkt-hero-sub">
                Collect, manage and publish customer testimonials across all your clients — one
                workspace, one place to approve, and widgets that keep every client&apos;s site
                current.
              </p>
              <div className="mkt-hero-cta">
                <Link to="/signup" className="mkt-btn mkt-btn-primary mkt-btn-lg">
                  Start free
                </Link>
                <a href="#agency" className="mkt-link-arrow">
                  See the agency workspace <span aria-hidden="true">→</span>
                </a>
              </div>
              <p className="mkt-hero-note">
                <span>Free during Early Access</span>
                <span className="mkt-dot" aria-hidden="true" />
                <span>No card needed</span>
              </p>
            </div>

            <div className="mkt-hero-proof" aria-label="Example testimonials">
              {HERO_QUOTES.map((quote) => (
                <Quote key={quote.text} quote={quote} />
              ))}
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------- agency */}
        <section className="mkt-section mkt-section-tight" id="agency">
          <div className="mkt-wrap">
            <div className="mkt-head-row">
              <div>
                <p className="mkt-kicker">For agencies and freelancers</p>
                <h2 className="mkt-h2">One workspace for every client&apos;s social proof.</h2>
              </div>
              <p className="mkt-lede" style={{ marginTop: 0, maxWidth: '38ch' }}>
                Clients, projects, approvals and widgets live in one place — so you can run proof
                for a whole roster without a spreadsheet or a shared login.
              </p>
            </div>

            <div className="mkt-agency-benefits">
              <div className="mkt-agency-benefit">
                <h3>Every client, organised</h3>
                <p>
                  Each client has its own collection links, projects and testimonial inbox. Nothing
                  bleeds between accounts.
                </p>
              </div>
              <div className="mkt-agency-benefit">
                <h3>Widgets per client</h3>
                <p>
                  Save a widget once, embed it with a stable snippet, and it stays current as you
                  approve new feedback.
                </p>
              </div>
              <div className="mkt-agency-benefit">
                <h3>Work as a team</h3>
                <p>
                  Invite teammates with owner, admin, manager or viewer roles — and scope managers
                  to only the clients they handle.
                </p>
              </div>
            </div>

            <div className="mkt-shots">
              <figure className="mkt-shot">
                <img
                  src="/marketing/agency-overview.png"
                  alt="RaveWall agency overview showing four clients, nine testimonials, two pending approvals and two live widgets."
                  width={1280}
                  height={860}
                  loading="lazy"
                />
                <figcaption>
                  The agency overview: every client, the approvals waiting on you, and live widgets
                  in one place.
                </figcaption>
              </figure>
              <figure className="mkt-shot">
                <img
                  src="/marketing/agency-widgets.png"
                  alt="RaveWall widgets page listing saved widgets for a client, with draft and live status."
                  width={1280}
                  height={860}
                  loading="lazy"
                />
                <figcaption>
                  Saved widgets per client — draft, publish and embed without re-pasting code.
                </figcaption>
              </figure>
            </div>
            <p className="mkt-caption">
              Screens from the live product, shown with example client data.
            </p>
          </div>
        </section>

        {/* --------------------------------------------------------- product */}
        <section className="mkt-section mkt-section-tight" id="product">
          <div className="mkt-wrap">
            <div className="mkt-head-row">
              <div>
                <p className="mkt-kicker">The loop</p>
                <h2 className="mkt-h2">Send one link. Get words worth showing.</h2>
              </div>
              <p className="mkt-lede" style={{ marginTop: 0, maxWidth: '38ch' }}>
                Your customer never creates an account. You never chase a reply. It takes about
                twenty seconds on their side, and one decision on yours.
              </p>
            </div>

            <div className="mkt-board" role="group" aria-label="How a testimonial travels through RaveWall">
              <div className="mkt-panel">
                <span className="mkt-panel-label">01 — Collect</span>
                <div className="mkt-panel-card">
                  <span className="mkt-stars" aria-hidden="true">
                    ★★★★★
                  </span>
                  <div className="mkt-fake-input">
                    “They fixed the thing nobody else would look at.”
                  </div>
                  <div className="mkt-fake-btn">Send testimonial</div>
                </div>
                <p className="mkt-caption">Your collection page. Your logo, your accent colour.</p>
              </div>

              <div className="mkt-board-arrow" aria-hidden="true">
                →
              </div>

              <div className="mkt-panel">
                <span className="mkt-panel-label">02 — Moderate</span>
                <div className="mkt-panel-card">
                  <span className="mkt-badge mkt-badge-pending">Pending</span>
                  <div className="mkt-fake-input">Example customer · Example Co.</div>
                  <div className="mkt-mini-actions">
                    <span className="mkt-mini-btn mkt-mini-btn-primary">Approve</span>
                    <span className="mkt-mini-btn">Reject</span>
                  </div>
                </div>
                <p className="mkt-caption">The inbox. Nothing is public until you choose it.</p>
              </div>

              <div className="mkt-board-arrow" aria-hidden="true">
                →
              </div>

              <div className="mkt-panel">
                <span className="mkt-panel-label">03 — Publish</span>
                <div className="mkt-panel-card">
                  <span className="mkt-badge mkt-badge-approved">Approved</span>
                  <span className="mkt-stars" aria-hidden="true">
                    ★★★★★
                  </span>
                  <div className="mkt-fake-input">Now on your wall and in your widget.</div>
                </div>
                <p className="mkt-caption">One approval. Every surface updates.</p>
              </div>
            </div>
            <p className="mkt-caption">
              Screens shown with example data. This is the product layout, not a mock-up of one.
            </p>
          </div>
        </section>

        {/* ------------------------------------------------------ moderation */}
        <section className="mkt-section">
          <div className="mkt-wrap mkt-split">
            <div>
              <p className="mkt-kicker">Control</p>
              <h2 className="mkt-h2">Nothing goes live until you say so.</h2>
              <p className="mkt-lede">
                A testimonial is a public claim about your business. RaveWall treats it that way:
                every submission waits for a human decision, and the wall only ever shows what you
                approved.
              </p>
              <p className="mkt-lede" style={{ marginTop: 14 }}>
                Reject quietly. Delete entirely. Change your mind later — the wall follows.
              </p>
            </div>
            <ModerationDemo />
          </div>
        </section>

        {/* --------------------------------------------------------- widgets */}
        <section className="mkt-section mkt-section-warm" id="widgets">
          <div className="mkt-wrap">
            <div className="mkt-head-row">
              <div>
                <p className="mkt-kicker">Widgets</p>
                <h2 className="mkt-h2">Four ways to put proof on your site.</h2>
              </div>
              <p className="mkt-lede" style={{ marginTop: 0, maxWidth: '36ch' }}>
                Pick a layout, copy one snippet, paste it where the decision happens. No build step,
                no framework, no restyling your site.
              </p>
            </div>
            <WidgetShowcase />
          </div>
        </section>

        {/* ----------------------------------------------------------- embed */}
        <section className="mkt-section mkt-section-tight">
          <div className="mkt-wrap mkt-embed">
            <div>
              <p className="mkt-kicker">Embed</p>
              <h2 className="mkt-h2">Paste it once. It keeps itself current.</h2>
              <p className="mkt-lede">
                The snippet loads the approved testimonials at that moment. Approve something new
                and it appears on your site without another deploy.
              </p>
              <p className="mkt-lede" style={{ marginTop: 14 }}>
                It renders inside its own shadow root, so your styles stay yours and ours stay ours.
              </p>
            </div>

            <div className="mkt-code">
              <div className="mkt-code-bar">
                <span className="mkt-code-label">Your site</span>
                <button type="button" className="mkt-copy" onClick={handleCopy}>
                  {copied ? 'Copied' : 'Copy code'}
                </button>
              </div>
              <pre>
                <code>{EMBED_SNIPPET}</code>
              </pre>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------- comparison */}
        <section className="mkt-section">
          <div className="mkt-wrap">
            <div className="mkt-head-row">
              <div>
                <p className="mkt-kicker">Placement</p>
                <h2 className="mkt-h2">Proof belongs next to the decision.</h2>
              </div>
              <p className="mkt-lede" style={{ marginTop: 0, maxWidth: '38ch' }}>
                The moment someone is deciding whether to work with you is the moment a real sentence
                from a real customer does the most work.
              </p>
            </div>

            <div className="mkt-compare">
              <div className="mkt-compare-side mkt-compare-side-plain">
                <p className="mkt-compare-label">Without proof</p>
                <div className="mkt-decision mkt-decision-plain">
                  <h3>Start a project</h3>
                  <p className="mkt-decision-meta">Six weeks · two people · fixed scope</p>
                  <div className="mkt-decision-btn">Request a quote</div>
                </div>
                <div className="mkt-compare-void" aria-hidden="true">
                  <span>Nothing here but your own claims.</span>
                </div>
                <p className="mkt-caption">A decision with nothing but your own claims behind it.</p>
              </div>
              <div className="mkt-compare-side">
                <p className="mkt-compare-label">With proof</p>
                <div className="mkt-decision">
                  <h3>Start a project</h3>
                  <p className="mkt-decision-meta">Six weeks · two people · fixed scope</p>
                  <div className="mkt-decision-btn">Request a quote</div>
                </div>
                <div className="mkt-compare-quote">
                  <Quote
                    quote={{
                      rating: 5,
                      text: 'They said six weeks and it was six weeks. The handover was the calmest I have had.',
                      name: 'Example customer',
                      company: 'Example Co.',
                    }}
                  />
                </div>
                <p className="mkt-caption">
                  Same offer. One sentence of evidence sitting beside the button.
                </p>
              </div>
            </div>
            <p className="mkt-caption">
              An illustration of placement, not a performance claim. Example content throughout.
            </p>
          </div>
        </section>

        {/* ------------------------------------------------------------- how */}
        <section className="mkt-section" id="how">
          <div className="mkt-wrap">
            <div className="mkt-head-row">
              <div>
                <p className="mkt-kicker">How it works</p>
                <h2 className="mkt-h2">From a happy customer to your homepage.</h2>
              </div>
            </div>

            <div className="mkt-steps">
              {STEPS.map((step, index) => (
                <div className="mkt-step" key={step.title}>
                  <span className="mkt-step-num" aria-hidden="true">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <div className="mkt-step-copy">
                    <h3>{step.title}</h3>
                    <p>{step.body}</p>
                  </div>
                  <div className="mkt-step-visual" aria-hidden="true">
                    {step.visual}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* -------------------------------------------------------- examples */}
        <section className="mkt-section mkt-section-warm" id="examples">
          <div className="mkt-wrap">
            <div className="mkt-head-row">
              <div>
                <p className="mkt-kicker">Examples</p>
                <h2 className="mkt-h2">This is what a wall looks like.</h2>
              </div>
              <p className="mkt-lede" style={{ marginTop: 0, maxWidth: '36ch' }}>
                Same layout, your branding. Only approved testimonials appear — the ones below are
                example content.
              </p>
            </div>

            <div className="mkt-wall">
              {WALL_EXAMPLES.map((item) => (
                <article className="mkt-wall-card" key={item.text}>
                  <span className="mkt-stars" aria-hidden="true">
                    {'★'.repeat(item.rating)}
                  </span>
                  <p className="mkt-quote-text">“{item.text}”</p>
                  <div className="mkt-quote-meta">
                    <span className="mkt-quote-avatar" aria-hidden="true">
                      EC
                    </span>
                    <span className="mkt-quote-who">
                      <strong>{item.name}</strong>
                      <span>{item.company}</span>
                    </span>
                    <span className="mkt-example-tag">Example</span>
                  </div>
                </article>
              ))}
            </div>

            <p className="mkt-caption">
              <Link to="/wall/reda-studio" className="mkt-link-arrow" style={{ marginTop: 8 }}>
                Open a real RaveWall wall <span aria-hidden="true">→</span>
              </Link>
            </p>
          </div>
        </section>

        {/* -------------------------------------------------------- audience */}
        <section className="mkt-section">
          <div className="mkt-wrap">
            <div className="mkt-head-row">
              <div>
                <p className="mkt-kicker">Who it is for</p>
                <h2 className="mkt-h2">Built for people whose work needs proof.</h2>
              </div>
            </div>

            <dl className="mkt-audience">
              {AUDIENCE.map((item) => (
                <div className="mkt-audience-row" key={item.role}>
                  <dt>{item.role}</dt>
                  <dd>{item.body}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* ----------------------------------------------------------- final */}
        <section className="mkt-final" id="start">
          <div className="mkt-gridlines" aria-hidden="true" />
          <div className="mkt-wrap mkt-final-inner">
            <div>
              <h2>Your clients are already saying it.</h2>
              <p>
                Start with one client. Add the next whenever you like — nothing publishes until you
                approve it, and every widget stays current.
              </p>
            </div>
            <div className="mkt-final-actions">
              <Link to="/signup" className="mkt-btn mkt-btn-primary mkt-btn-lg">
                Start free
              </Link>
              <a href="#widgets" className="mkt-btn mkt-btn-quiet">
                See the widgets
              </a>
              <p className="mkt-hero-note">
                <span>Free during Early Access</span>
                <span className="mkt-dot" aria-hidden="true" />
                <span>No card needed</span>
              </p>
            </div>
          </div>
        </section>
      </main>

      <MarketingFooter />
    </div>
  )
}
