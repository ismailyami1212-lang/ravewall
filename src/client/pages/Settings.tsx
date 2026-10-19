import { useState } from 'react'
import { Link } from 'react-router-dom'
import { collectUrl, copyText, wallUrl } from '../api'
import { AppBar } from '../components/AppBar'
import { BusinessForm } from '../components/BusinessForm'
import { Button } from '../components/Primitives'
import { useToast } from '../components/Toast'
import { useSession } from '../session'

export function Settings() {
  const { business } = useSession()
  const { notify } = useToast()
  const [copied, setCopied] = useState('')

  if (!business) return null

  async function handleCopy(value: string, label: string) {
    const ok = await copyText(value)
    if (ok) {
      setCopied(label)
      notify(`${label} copied.`, 'success')
      window.setTimeout(() => setCopied(''), 2000)
    } else {
      notify('Could not access the clipboard — copy it manually.', 'error')
    }
  }

  return (
    <div className="app-shell">
      <AppBar />
      <main className="container narrow">
        <div className="page-head">
          <h1>Business settings</h1>
          <p>Update how your collection page and wall look, or change your link.</p>
        </div>

        <section className="card card-pad stack">
          <h2 className="section-title">Share links</h2>
          <div className="link-row">
            <div>
              <span className="link-label">Collection link</span>
              <code>{collectUrl(business.slug)}</code>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleCopy(collectUrl(business.slug), 'Collection link')}
            >
              {copied === 'Collection link' ? 'Copied' : 'Copy'}
            </Button>
          </div>
          <div className="link-row">
            <div>
              <span className="link-label">Public wall</span>
              <code>{wallUrl(business.slug)}</code>
            </div>
            <div className="row-actions">
              <Link to={`/wall/${business.slug}`} className="btn btn-ghost btn-sm">
                Preview
              </Link>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleCopy(wallUrl(business.slug), 'Wall link')}
              >
                {copied === 'Wall link' ? 'Copied' : 'Copy'}
              </Button>
            </div>
          </div>
          <p className="fine-print">
            Changing your link name breaks any links you have already shared. Existing testimonials
            are kept.
          </p>
        </section>

        <section className="card card-pad">
          <h2 className="section-title">Branding</h2>
          <BusinessForm mode="edit" initial={business} />
        </section>
      </main>
    </div>
  )
}
