import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { loginSchema, validate } from '../../shared/validation.js'
import { api } from '../api'
import { AuthShell } from '../components/AuthShell'
import { Button, Field, Input } from '../components/Primitives'
import { useToast } from '../components/Toast'
import { useSession } from '../session'

export function Login() {
  const navigate = useNavigate()
  const location = useLocation()
  const { refresh } = useSession()
  const { notify } = useToast()

  const [form, setForm] = useState({ email: '', password: '' })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    const parsed = validate(loginSchema, form)
    if (!parsed.ok) {
      setErrors(parsed.errors)
      return
    }
    setErrors({})
    setFormError('')
    setSubmitting(true)
    try {
      const result = await api.login(parsed.data)
      await refresh()
      notify(`Welcome back, ${result.user.name}.`, 'success')
      const from = (location.state as { from?: string } | null)?.from
      navigate(from && from !== '/login' ? from : result.business ? '/dashboard' : '/setup', {
        replace: true,
      })
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Could not sign you in.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to review your pending testimonials."
      footer={
        <>
          New here? <Link to="/signup">Create an account</Link>
        </>
      }
    >
      <form className="stack" onSubmit={handleSubmit} noValidate>
        {formError ? (
          <div className="alert alert-error" role="alert">
            {formError}
          </div>
        ) : null}

        <Field label="Email" htmlFor="login-email" error={errors.email}>
          <Input
            id="login-email"
            type="email"
            value={form.email}
            onChange={(event) => setForm({ ...form, email: event.target.value })}
            autoComplete="email"
            placeholder="you@company.com"
            required
          />
        </Field>

        <Field label="Password" htmlFor="login-password" error={errors.password}>
          <Input
            id="login-password"
            type="password"
            value={form.password}
            onChange={(event) => setForm({ ...form, password: event.target.value })}
            autoComplete="current-password"
            placeholder="••••••••"
            required
          />
        </Field>

        <Button type="submit" loading={submitting} className="btn-block">
          Sign in
        </Button>

        <p className="auth-alt-action">
          <Link to="/forgot-password">Forgot your password?</Link>
        </p>
      </form>
    </AuthShell>
  )
}
