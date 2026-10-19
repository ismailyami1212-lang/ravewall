import { useState } from 'react'

/**
 * Moderation demonstration: a pending example testimonial that the visitor can
 * approve, showing the state change the product performs for real. Purely
 * local state — no API calls, no real data.
 */
export function ModerationDemo() {
  const [approved, setApproved] = useState(false)

  return (
    <div className="mkt-demo">
      <div className="mkt-demo-head">
        <span className="mkt-demo-title">Inbox — example submission</span>
        <span className={`mkt-badge ${approved ? 'mkt-badge-approved' : 'mkt-badge-pending'}`}>
          {approved ? 'Approved' : 'Pending'}
        </span>
      </div>

      <div className="mkt-demo-body">
        <div className="mkt-quote">
          <span className="mkt-stars" aria-hidden="true">
            ★★★★★
          </span>
          <p className="mkt-quote-text">
            “They untangled our checkout in a week. I keep sending the link because the replies are
            this good.”
          </p>
          <div className="mkt-quote-meta">
            <span className="mkt-quote-avatar" aria-hidden="true">
              EC
            </span>
            <span className="mkt-quote-who">
              <strong>Example customer</strong>
              <span>Example Co.</span>
            </span>
            <span className="mkt-example-tag">Example</span>
          </div>
        </div>
      </div>

      <div className="mkt-demo-actions">
        {approved ? (
          <button type="button" className="mkt-demo-reset" onClick={() => setApproved(false)}>
            Reset the demo
          </button>
        ) : (
          <button
            type="button"
            className="mkt-btn mkt-btn-primary mkt-btn-sm"
            onClick={() => setApproved(true)}
          >
            Approve this testimonial
          </button>
        )}
        <span className="mkt-demo-status" aria-live="polite">
          {approved ? (
            <>
              On your wall: <strong>yes</strong> — and the widget updates too.
            </>
          ) : (
            'On your wall: not yet.'
          )}
        </span>
      </div>

      <p className="mkt-demo-note">
        Try it. This is the real moderation state change, using an example submission.
      </p>
    </div>
  )
}
