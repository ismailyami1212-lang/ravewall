import { Link } from 'react-router-dom'
import { Logo } from './Primitives'

/** Marketing footer, shared by the landing and pricing pages. */
export function MarketingFooter() {
  return (
    <footer className="mkt-footer">
      <div className="mkt-wrap">
        <div className="mkt-footer-grid">
          <div className="mkt-footer-brand">
            <Logo />
            <p>Real praise, displayed beautifully. Collect the words your customers already have.</p>
          </div>

          <div>
            <h3>Product</h3>
            <ul>
              <li>
                <a href="/#product">Collect</a>
              </li>
              <li>
                <a href="/#widgets">Widgets</a>
              </li>
              <li>
                <Link to="/pricing">Pricing</Link>
              </li>
              <li>
                <Link to="/wall/reda-studio">A real wall</Link>
              </li>
            </ul>
          </div>

          <div>
            <h3>Legal</h3>
            <ul>
              <li>
                <Link to="/privacy">Privacy</Link>
              </li>
              <li>
                <Link to="/terms">Terms</Link>
              </li>
            </ul>
          </div>

          <div>
            <h3>Account</h3>
            <ul>
              <li>
                <Link to="/login">Log in</Link>
              </li>
              <li>
                <Link to="/signup">Create account</Link>
              </li>
              <li>
                <Link to="/forgot-password">Reset password</Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="mkt-footer-base">
          <span>© 2026 RaveWall</span>
          <span>Testimonials shown on this site are example content.</span>
        </div>
      </div>
    </footer>
  )
}
