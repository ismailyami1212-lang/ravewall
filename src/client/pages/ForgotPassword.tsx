import { useState } from 'react'
import { Link } from 'react-router-dom'
import { emailSchema, validate } from '../../shared/validation.js'
import { AuthShell } from '../components/AuthShell'
import { Button, Field, Input } from '../components/Primitives'

/**
 * Password reset request. The server responds identically whether or not an
 * account exists, so this page always shows the same confirmation.
 */
export function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    const parsed = validate(emailSchema, email)
    if (!parsed.ok) {
      setError(parsed.errors.email ?? 'Enter a valid email address.')
      return
    }
    setError('')
    setSubmitting(true)
    try {
      await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: parsed.data }),
      })
    } catch {
      // The confirmation is shown either way — the flow must not reveal
      // whether an account exists.
    } finally {
      setSubmitting(false)
      setSubmitted(true)
    }
  }

  return (
    <AuthShell
      title="Reset your password"
      subtitle="We'll email you a link to choose a new password."
      footer={
        <>
          Remembered it? <Link to="/login">Back to sign in</Link>
        </>
      }
    >
      {submitted ? (
        <div className="stack">
          <div className="alert alert-success" role="status">
            If an account exists for that email, we&apos;ve sent password reset instructions. The
            link expires in one hour.
          </div>
          <p className="muted">
            Check your spam folder too. <Link to="/login">Back to sign in</Link>
          </p>
        </div>
      ) : (
        <form className="stack" onSubmit={handleSubmit} noValidate>
          <Field label="Email" htmlFor="forgot-email" error={error}>
            <Input
              id="forgot-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              placeholder="you@company.com"
              required
            />
          </Field>
          <Button type="submit" loading={submitting} className="btn-block">
            Send reset link
          </Button>
        </form>
      )}
    </AuthShell>
  )
}
