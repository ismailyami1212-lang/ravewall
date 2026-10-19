import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { signupSchema, validate } from '../../shared/validation.js'
import { api } from '../api'
import { AuthShell } from '../components/AuthShell'
import { Button, Field, Input } from '../components/Primitives'
import { useToast } from '../components/Toast'
import { useSession } from '../session'

export function Signup() {
  const navigate = useNavigate()
  const { refresh } = useSession()
  const { notify } = useToast()

  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '' })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    const parsed = validate(signupSchema, form)
    const nextErrors: Record<string, string> = parsed.ok ? {} : { ...parsed.errors }
    if (!nextErrors.password && form.password !== form.confirm) {
      nextErrors.confirm = 'Passwords do not match'
    }
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors)
      return
    }
    if (!parsed.ok) return

    setErrors({})
    setFormError('')
    setSubmitting(true)
    try {
      await api.signup(parsed.data)
      await refresh()
      notify('Account created. Now let us set up your business.', 'success')
      navigate('/setup', { replace: true })
    } catch (error) {
      const fields =
        error && typeof error === 'object' && 'fields' in error
          ? ((error as { fields?: Record<string, string> }).fields ?? {})
          : {}
      setErrors(fields)
      setFormError(
        Object.keys(fields).length > 0
          ? ''
          : error instanceof Error
            ? error.message
            : 'Could not create your account.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthShell
      title="Create your workspace"
      subtitle="One account, one collection link, unlimited testimonials."
      footer={
        <>
          Already have an account? <Link to="/login">Sign in</Link>
        </>
      }
    >
      <form className="stack" onSubmit={handleSubmit} noValidate>
        {formError ? (
          <div className="alert alert-error" role="alert">
            {formError}
          </div>
        ) : null}

        <Field label="Your name" htmlFor="signup-name" error={errors.name}>
          <Input
            id="signup-name"
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            autoComplete="name"
            placeholder="Mara Ellis"
            maxLength={60}
            required
          />
        </Field>

        <Field label="Email" htmlFor="signup-email" error={errors.email}>
          <Input
            id="signup-email"
            type="email"
            value={form.email}
            onChange={(event) => setForm({ ...form, email: event.target.value })}
            autoComplete="email"
            placeholder="you@company.com"
            required
          />
        </Field>

        <Field
          label="Password"
          htmlFor="signup-password"
          error={errors.password}
          hint="At least 8 characters, with a letter and a number."
        >
          <Input
            id="signup-password"
            type="password"
            value={form.password}
            onChange={(event) => setForm({ ...form, password: event.target.value })}
            autoComplete="new-password"
            placeholder="••••••••"
            required
          />
        </Field>

        <Field label="Confirm password" htmlFor="signup-confirm" error={errors.confirm}>
          <Input
            id="signup-confirm"
            type="password"
            value={form.confirm}
            onChange={(event) => setForm({ ...form, confirm: event.target.value })}
            autoComplete="new-password"
            placeholder="••••••••"
            required
          />
        </Field>

        <Button type="submit" loading={submitting} className="btn-block">
          Create account
        </Button>
        <p className="fine-print">Your account is private to your workspace.</p>
      </form>
    </AuthShell>
  )
}
