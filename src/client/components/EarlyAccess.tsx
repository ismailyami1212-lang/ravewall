import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { Button } from './Primitives'

export const EARLY_ACCESS_TITLE = 'RaveWall is currently 100% Free during Early Access.'
export const EARLY_ACCESS_BODY =
  'Enjoy unrestricted workspace access with no credit card required.'

const MODAL_TITLE_ID = 'early-access-title'
const MODAL_BODY_ID = 'early-access-body'

/**
 * Accessible Early Access explanation.
 *
 * Payments are intentionally dormant, so every "upgrade" affordance in the
 * signed-in app opens this instead of a checkout that cannot work. The dialog
 * is rendered in a portal so the sticky app bar can never clip it.
 */
export function EarlyAccessModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return undefined
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow

    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)

    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', onKeyDown)
      previous?.focus()
    }
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div
      className="ea-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        className="ea-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={MODAL_TITLE_ID}
        aria-describedby={MODAL_BODY_ID}
      >
        <button
          ref={closeRef}
          type="button"
          className="ea-modal-close"
          onClick={onClose}
          aria-label="Close Early Access details"
        >
          ✕
        </button>

        <p className="ea-modal-eyebrow">Early Access</p>
        <h2 id={MODAL_TITLE_ID}>{EARLY_ACCESS_TITLE}</h2>
        <p id={MODAL_BODY_ID} className="ea-modal-lede">
          {EARLY_ACCESS_BODY}
        </p>

        <ul className="ea-modal-list">
          <li>Every feature that exists today is unlocked.</li>
          <li>Paid plans are not on sale yet, so there is nothing to buy.</li>
          <li>When billing launches, you choose a plan then — nothing is charged automatically.</li>
        </ul>

        <div className="ea-modal-actions">
          <Button onClick={onClose}>Continue free</Button>
          <Link to="/pricing" className="btn btn-outline btn-md" onClick={onClose}>
            Compare plans
          </Link>
        </div>

        <p className="ea-modal-note">
          Founding members get <strong>50% off their first year</strong> when paid plans launch.
        </p>
      </div>
    </div>,
    document.body,
  )
}

/** Slim, persistent Early Access banner shown below the signed-in app bar. */
export function EarlyAccessBanner() {
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])

  return (
    <>
      <div className="early-access-banner">
        <div className="container early-access-banner-inner">
          <span className="early-access-pill">Early Access</span>
          <p className="early-access-copy">
            <strong>RaveWall is currently 100% Free during Early Access.</strong>
            <span className="early-access-note">
              {' '}
              Unrestricted workspace access, no credit card required.
            </span>
          </p>
          <button type="button" className="early-access-action" onClick={() => setOpen(true)}>
            Pricing details <span aria-hidden="true">→</span>
          </button>
        </div>
      </div>
      <EarlyAccessModal open={open} onClose={close} />
    </>
  )
}

/**
 * A normal-looking upgrade button whose destination is the Early Access
 * explanation rather than a checkout that would dead-end.
 */
export function EarlyAccessTrigger({
  label = 'Upgrade plan',
  variant = 'outline',
  size = 'md',
  className = '',
}: {
  label?: string
  variant?: 'primary' | 'outline' | 'ghost'
  size?: 'sm' | 'md'
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])

  return (
    <>
      <Button variant={variant} size={size} className={className} onClick={() => setOpen(true)}>
        {label}
      </Button>
      <EarlyAccessModal open={open} onClose={close} />
    </>
  )
}
