import { Stars } from './Stars'

/**
 * A faithful, non-interactive mock of the RaveWall moderation inbox. It is shown in
 * the landing hero so visitors see the actual product surface — a pending
 * submission with the Approve / Reject controls — rather than an abstract
 * marketing graphic. Content is clearly example data and the whole block is
 * hidden from assistive technology.
 */
export function ProductPreview() {
  return (
    <div className="product-preview" aria-hidden="true">
      <div className="pp-bar">
        <span className="pp-dot" />
        <span className="pp-dot" />
        <span className="pp-dot" />
        <span className="pp-bar-title">RaveWall · Inbox</span>
      </div>
      <div className="pp-body">
        <div className="pp-rowhead">
          <span className="pp-count">1 new submission</span>
          <span className="pp-tab">Pending</span>
        </div>
        <div className="pp-review">
          <div className="pp-review-head">
            <span className="avatar avatar-sm">JL</span>
            <div className="pp-identity">
              <strong>Jordan Lee</strong>
              <span>Northwind Studio</span>
            </div>
            <Stars value={5} size="sm" />
          </div>
          <p className="pp-text">
            “Working with this team changed how we collect reviews. Setup took minutes and the wall
            looks like us.”
          </p>
          <div className="pp-actions">
            <button type="button" tabIndex={-1} className="btn btn-primary btn-sm">
              Approve
            </button>
            <button type="button" tabIndex={-1} className="btn btn-outline btn-sm">
              Reject
            </button>
          </div>
        </div>
        <div className="pp-foot">
          <span className="chip">Example</span>
          <span>Approve to publish · Reject to discard</span>
        </div>
      </div>
    </div>
  )
}
