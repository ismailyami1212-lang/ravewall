import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { MAX_RATING, TESTIMONIAL_TEXT_MAX, TESTIMONIAL_TEXT_MIN } from '../../shared/constants.js'
import { testimonialSubmissionSchema, validate } from '../../shared/validation.js'
import { api, type Business, type PublicQuestion } from '../api'
import { Button, Field, Input, Spinner, Textarea } from '../components/Primitives'
import { StarRating } from '../components/Stars'
import { useToast } from '../components/Toast'

/** Public collection form reached through /t/:slug. */
export function Collect() {
  const { slug = '' } = useParams()
  const { notify } = useToast()

  const [business, setBusiness] = useState<Business | null>(null)
  const [questions, setQuestions] = useState<PublicQuestion[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  const [rating, setRating] = useState(0)
  const [form, setForm] = useState({ name: '', company: '', text: '', website: '' })
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api
      .publicBusiness(slug)
      .then((result) => {
        if (!cancelled) {
          setBusiness(result.business)
          setQuestions(result.questions ?? [])
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : 'Could not load this page.')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [slug])

  function setAnswer(questionId: string, value: string) {
    setAnswers((current) => ({ ...current, [questionId]: value }))
    setErrors((current) => {
      if (!current[questionId]) return current
      const next = { ...current }
      delete next[questionId]
      return next
    })
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()

    // Empty optional answers are not meaningful; leave them out so the server
    // only receives the answers a respondent actually chose to give.
    const answered = Object.fromEntries(
      Object.entries(answers).filter(([, value]) => value.trim() !== ''),
    )
    const parsed = validate(testimonialSubmissionSchema, { ...form, rating, answers: answered })

    const missing: Record<string, string> = {}
    for (const question of questions) {
      if (question.required && !answered[question.id]?.trim()) {
        missing[question.id] = 'Please answer this question.'
      }
    }

    if (!parsed.ok || Object.keys(missing).length > 0) {
      setErrors({ ...(parsed.ok ? {} : parsed.errors), ...missing })
      notify('Please check the highlighted fields.', 'error')
      return
    }

    setErrors({})
    setSubmitting(true)
    try {
      await api.submitTestimonial(slug, parsed.data)
      setSubmitted(true)
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not send your testimonial.', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const accent = business?.accentColor ?? '#15803d'
  const remaining = TESTIMONIAL_TEXT_MAX - form.text.length

  if (loading) {
    return (
      <div className="center-screen">
        <Spinner label="Loading" />
      </div>
    )
  }

  if (loadError || !business) {
    return (
      <div className="center-screen">
        <div className="public-card public-error">
          <h1>Page unavailable</h1>
          <p className="muted">{loadError || 'That testimonial page does not exist.'}</p>
          <Link to="/" className="btn btn-outline">
            Go home
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="public-shell" style={{ '--accent': accent } as React.CSSProperties}>
      <header className="public-header">
        <Brand business={business} />
      </header>

      <main className="public-main">
        {submitted ? (
          <div className="public-card center-text">
            <div className="success-mark" aria-hidden="true">
              ✓
            </div>
            <h1>Thank you</h1>
            <p className="muted">
              Your testimonial has been sent to {business.name}. It will appear on their wall once
              they review it.
            </p>
            <Link to={`/wall/${business.slug}`} className="btn btn-outline">
              See other testimonials
            </Link>
          </div>
        ) : (
          <div className="public-card">
            <h1 className="public-title">Leave a testimonial</h1>
            <p className="muted">
              Tell {business.name} what working with them was like. It takes about twenty seconds.
            </p>

            <form className="stack" onSubmit={handleSubmit} noValidate>
              <div className="field">
                <span className="label">Your rating</span>
                <StarRating value={rating} onChange={setRating} />
                {errors.rating ? (
                  <p className="field-error" role="alert">
                    {errors.rating}
                  </p>
                ) : null}
              </div>

              <Field label="Your name" htmlFor="t-name" error={errors.name}>
                <Input
                  id="t-name"
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                  placeholder="Mara Ellis"
                  autoComplete="name"
                  maxLength={60}
                  required
                />
              </Field>

              <Field label="Company" htmlFor="t-company" optional error={errors.company}>
                <Input
                  id="t-company"
                  value={form.company}
                  onChange={(event) => setForm({ ...form, company: event.target.value })}
                  placeholder="Northwind Studio"
                  autoComplete="organization"
                  maxLength={80}
                />
              </Field>

              <Field
                label="Your testimonial"
                htmlFor="t-text"
                error={errors.text}
                hint={`${form.text.length} / ${TESTIMONIAL_TEXT_MAX} characters · at least ${TESTIMONIAL_TEXT_MIN}`}
              >
                <Textarea
                  id="t-text"
                  value={form.text}
                  onChange={(event) => setForm({ ...form, text: event.target.value })}
                  rows={5}
                  maxLength={TESTIMONIAL_TEXT_MAX}
                  placeholder="What did they help you achieve?"
                  aria-invalid={errors.text ? true : undefined}
                  required
                />
              </Field>
              {remaining < 80 ? (
                <p className="fine-print" aria-live="polite">
                  {remaining} characters left
                </p>
              ) : null}

              {questions.map((question) => {
                const inputId = `q-${question.id}`
                const value = answers[question.id] ?? ''
                const error = errors[question.id]
                const common = {
                  id: inputId,
                  value,
                  required: question.required,
                  'aria-invalid': error ? true : undefined,
                  onChange: (
                    event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
                  ) => setAnswer(question.id, event.target.value),
                }

                return (
                  <Field
                    key={question.id}
                    label={question.label}
                    htmlFor={inputId}
                    error={error}
                    optional={!question.required}
                  >
                    {question.type === 'long' ? (
                      <Textarea {...common} rows={3} maxLength={500} />
                    ) : question.type === 'rating' ? (
                      <select {...common} className="input input-select">
                        <option value="">Select a rating</option>
                        {Array.from({ length: MAX_RATING }, (_, index) => (
                          <option key={index + 1} value={String(index + 1)}>
                            {index + 1} / {MAX_RATING}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <Input
                        {...common}
                        type="text"
                        maxLength={500}
                        autoComplete={question.type === 'company' ? 'organization' : undefined}
                      />
                    )}
                  </Field>
                )
              })}

              {/* Honeypot — hidden from people, tempting for bots. */}
              <div className="honeypot" aria-hidden="true">
                <label htmlFor="t-website">Website</label>
                <input
                  id="t-website"
                  name="website"
                  tabIndex={-1}
                  autoComplete="off"
                  value={form.website}
                  onChange={(event) => setForm({ ...form, website: event.target.value })}
                />
              </div>

              <Button type="submit" loading={submitting} className="btn-block btn-lg">
                Submit testimonial
              </Button>
              <p className="fine-print center-text">
                By submitting, you allow {business.name} to review and publish this testimonial on
                their public wall.
              </p>
            </form>
          </div>
        )}
      </main>

      <footer className="public-footer">
        <span className="muted">Collected with RaveWall</span>
        <nav className="public-footer-links" aria-label="Legal">
          <Link to="/privacy">Privacy</Link>
          <Link to="/terms">Terms</Link>
        </nav>
      </footer>
    </div>
  )
}

export function Brand({ business, large = false }: { business: Business; large?: boolean }) {
  return (
    <div className={`brand ${large ? 'brand-lg' : ''}`.trim()}>
      {business.logoUrl ? (
        <img
          src={business.logoUrl}
          alt=""
          className="brand-logo"
          width={large ? 56 : 40}
          height={large ? 56 : 40}
          onError={(event) => {
            // A broken logo URL must not break the page.
            event.currentTarget.style.display = 'none'
          }}
        />
      ) : (
        <span className="brand-mark" aria-hidden="true">
          {business.name.charAt(0).toUpperCase()}
        </span>
      )}
      <span className="brand-name">{business.name}</span>
    </div>
  )
}
