import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { passwordSchema, validate } from '../../shared/validation.js'
import { api } from '../api'
import { AuthShell } from '../components/AuthShell'
import { Button, Field, Input } from '../components/Primitives'
import { useToast } from '../components/Toast'
import { useSession } from '../session'

/**
 * Password reset confirmation. The token arrives in the query string and is
 * validated server-side; every failure gets the same generic message.
 */
export function ResetPassword() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') ?? ''
  const navigate = useNavigate()
  const { refresh } = useSession()
  const { notify } = useToast()

  const [form, setForm] = useState({ password: '', confirm: '' })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (form.password !== form.confirm) {
      setErrors({ confirm: 'Both passwords must match.' })
      return
    }
    const parsed = validate(passwordSchema, form.password)
    if (!parsed.ok) {
      setErrors({ password: parsed.errors.password ?? 'Choose a stronger password.' })
      return
    }
    setErrors({})
    setFormError('')
    setSubmitting(true)
    try {
      await api.resetPassword({ token, password: parsed.data })
      await refresh()
      notify('Password updated. Please sign in with your new password.', 'success')
      navigate('/login', { replace: true })
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Could not reset your password.')
    } finally {
      setSubmitting(false)
    }
  }

  if (!token) {
    return (
      <AuthShell
        title="Reset your password"
        subtitle="This link is missing its token."
        footer={
          <>
            Need a new link? <Link to="/forgot-password">Request one</Link>
          </>
        }
      >
        <div className="alert alert-error" role="alert">
          This reset link is invalid. Request a fresh one and try again.
        </div>
        <p>
          <Link to="/forgot-password" className="btn btn-outline btn-block">
            Request a reset link
          </Link>
        </p>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      title="Choose a new password"
      subtitle="For your RaveWall account."
      footer={
        <>
          Remembered it? <Link to="/login">Back to sign in</Link>
        </>
      }
    >
      <form className="stack" onSubmit={handleSubmit} noValidate>
        {formError ? (
          <div className="alert alert-error" role="alert">
            {formError}
          </div>
        ) : null}

        <Field
          label="New password"
          htmlFor="reset-password"
          error={errors.password}
          hint="At least 8 characters, with a letter and a number."
        >
          <Input
            id="reset-password"
            type="password"
            value={form.password}
            onChange={(event) => setForm({ ...form, password: event.target.value })}
            autoComplete="new-password"
            placeholder="••••••••"
            required
          />
        </Field>

        <Field label="Confirm new password" htmlFor="reset-confirm" error={errors.confirm}>
          <Input
            id="reset-confirm"
            type="password"
            value={form.confirm}
            onChange={(event) => setForm({ ...form, confirm: event.target.value })}
            autoComplete="new-password"
            placeholder="••••••••"
            required
          />
        </Field>

        <Button type="submit" loading={submitting} className="btn-block">
          Update password
        </Button>
        <p className="fine-print">
          Updating your password signs you out of your other sessions.
        </p>
      </form>
    </AuthShell>
  )
}
