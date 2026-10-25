import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'
import { Logo } from '../components/Primitives'
import { applyPrivacyMetadata, applyTermsMetadata } from '../seo'

/**
 * Shared shell for the legal pages. Deliberately plain and readable — these
 * are documents, not marketing. Placeholder owner details are marked clearly
 * so they are impossible to ship by accident.
 */
function LegalShell({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <div className="legal-page">
      <header className="container nav">
        <Link to="/" className="appbar-brand" aria-label="RaveWall home">
          <Logo />
        </Link>
        <nav className="nav-links">
          <Link to="/privacy">Privacy</Link>
          <Link to="/terms">Terms</Link>
        </nav>
      </header>
      <main className="container narrow legal-body">
        <h1>{title}</h1>
        <p className="muted legal-updated">Last updated {updated}</p>
        {children}
        <p className="legal-placeholder">
          [PLACEHOLDER — replace with the operating entity&apos;s legal name, address and contact
          email before launch.]
        </p>
      </main>
      <footer className="footer">
        <div className="container footer-inner">
          <Logo />
          <p className="muted">RaveWall — collect customer stories worth sharing.</p>
          <nav className="footer-links">
            <Link to="/privacy">Privacy</Link>
            <Link to="/terms">Terms</Link>
            <Link to="/login">Sign in</Link>
          </nav>
        </div>
      </footer>
    </div>
  )
}

export function Privacy() {
  useEffect(() => applyPrivacyMetadata(), [])

  return (
    <LegalShell title="Privacy policy" updated="17 October 2026">
      <p>
        This policy explains what information RaveWall collects, why, and the choices you have. It
        applies to the RaveWall website and the testimonial collection, moderation and wall features.
      </p>

      <h2>Information we collect</h2>
      <ul>
        <li>
          <strong>Account information</strong> — your email address, display name and a hashed
          password. Passwords are stored as scrypt hashes with a per-account salt and are never
          recoverable.
        </li>
        <li>
          <strong>Testimonial information</strong> — the name, company, star rating and message that
          customers submit through a business&apos;s collection link, together with when it was
          submitted.
        </li>
        <li>
          <strong>Business profile information</strong> — your business name, link name (slug),
          tagline, logo URL and accent colour, used to render your collection page and wall.
        </li>
        <li>
          <strong>Technical and security information</strong> — a pseudonymous session cookie, and
          for abuse prevention a one-way fingerprint of the submitter&apos;s IP address and their
          browser&apos;s user-agent string, stored against submissions only.
        </li>
      </ul>

      <h2>Cookies and sessions</h2>
      <p>
        RaveWall uses a single essential cookie that keeps you signed in. It is httpOnly (not
        readable by scripts), restricted to same-site requests and marked Secure in production.
        There are no advertising or analytics cookies.
      </p>

      <h2>Why we process this information</h2>
      <ul>
        <li>To create and secure your account and session.</li>
        <li>To deliver submitted testimonials to the business they were written for.</li>
        <li>To publish the testimonials that a business approves, on that business&apos;s wall.</li>
        <li>To protect the service against abuse, spam and unauthorised access.</li>
      </ul>

      <h2>Who can see testimonials</h2>
      <p>
        Testimonials are only visible to the business they belong to until the business approves
        them. Approved testimonials are publicly visible on the business&apos;s public wall.
        Rejected or pending testimonials are never shown publicly.
      </p>

      <h2>Retention</h2>
      <p>
        Account and testimonial data is kept while the account is active. Session records expire
        automatically. You can ask us to delete your account and its testimonials at any time
        (contact below) and we will action verified requests.
      </p>

      <h2>Service providers</h2>
      <p>
        RaveWall runs on Vercel (application hosting) and Supabase (hosted PostgreSQL database).
        These providers process data only as needed to operate the service. If email delivery is
        enabled, a transactional email provider is used for password-reset messages only.
      </p>

      <h2>Security</h2>
      <p>
        We use industry-standard protections: hashed passwords, hashed session tokens, encrypted
        database connections, row-level security with no public database grants, rate limiting and
        input validation. No system is perfectly secure, but we design for it.
      </p>

      <h2>Your choices and requests</h2>
      <p>
        You can edit your business profile and delete individual testimonials at any time from the
        dashboard. For account deletion or questions about your data, contact the address below.
      </p>

      <h2>Changes</h2>
      <p>
        This policy may be updated as the product changes. The &ldquo;last updated&rdquo; date above
        always reflects the current version.
      </p>
    </LegalShell>
  )
}

export function Terms() {
  useEffect(() => applyTermsMetadata(), [])

  return (
    <LegalShell title="Terms of service" updated="17 October 2026">
      <p>
        These terms govern your use of RaveWall. By creating an account or using the service you
        agree to them.
      </p>

      <h2>The service</h2>
      <p>
        RaveWall provides a unique collection link for customer testimonials, a moderation inbox to
        review them, and a public wall that displays approved testimonials. Features may change over
        time; we will not remove core functionality without notice.
      </p>

      <h2>Your account</h2>
      <ul>
        <li>You are responsible for your account credentials and for activity under your account.</li>
        <li>
          You must be able to form a binding contract and provide an accurate email address.
        </li>
        <li>
          You may not attempt to access another business&apos;s data, circumvent rate limits, or
          interfere with the service.
        </li>
      </ul>

      <h2>Testimonials and content</h2>
      <ul>
        <li>
          When customers submit a testimonial through your link, they grant you permission to
          review and publish it. The submission form states this plainly.
        </li>
        <li>
          You are responsible for the testimonials you publish. Do not publish content that is
          unlawful, misleading, defamatory or infringing.
        </li>
        <li>
          You grant RaveWall a limited licence to store, process and display your content as needed
          to operate the service.
        </li>
      </ul>

      <h2>Moderation</h2>
      <p>
        Nothing is published without your approval. You can approve, reject, re-open or delete any
        testimonial at any time. We may remove content that is clearly unlawful or that threatens
        the security of the service.
      </p>

      <h2>Availability</h2>
      <p>
        The service is provided on an &ldquo;as available&rdquo; basis. We work to keep it online
        and backed up, but we do not guarantee uninterrupted availability.
      </p>

      <h2>Termination</h2>
      <p>
        You can stop using the service at any time and may request deletion of your account. We may
        suspend accounts that violate these terms, and will say why where we are able to.
      </p>

      <h2>Disclaimers</h2>
      <p>
        The service is provided without warranties beyond those implied by law. RaveWall is not
        liable for indirect or consequential loss arising from use of the service.
      </p>

      <h2>Changes</h2>
      <p>
        These terms may be updated as the product evolves. Continued use after an update means you
        accept the revised terms.
      </p>
    </LegalShell>
  )
}
