import { useEffect, useMemo, useRef, useState } from 'react'
import { ACCENT_PRESETS, DEFAULT_ACCENT } from '../../shared/constants.js'
import { businessSetupSchema, slugify, validate } from '../../shared/validation.js'
import { api, type Business } from '../api'
import { useSession } from '../session'
import { Button, Field, Input } from './Primitives'
import { useToast } from './Toast'

type Props = {
  mode: 'create' | 'edit'
  initial?: Business | null
  onSaved?: (business: Business) => void
}

type FormState = {
  name: string
  slug: string
  tagline: string
  logoUrl: string
  accentColor: string
}

export function BusinessForm({ mode, initial, onSaved }: Props) {
  const { setBusiness } = useSession()
  const { notify } = useToast()
  const [form, setForm] = useState<FormState>({
    name: initial?.name ?? '',
    slug: initial?.slug ?? '',
    tagline: initial?.tagline ?? '',
    logoUrl: initial?.logoUrl ?? '',
    accentColor: initial?.accentColor ?? DEFAULT_ACCENT,
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [slugState, setSlugState] = useState<'idle' | 'checking' | 'free' | 'taken'>('idle')
  // Once the user types a link name themselves we stop deriving it from the name.
  const slugTouched = useRef(mode === 'edit')

  useEffect(() => {
    if (slugTouched.current) return
    const derived = slugify(form.name)
    setForm((current) => (current.slug === derived ? current : { ...current, slug: derived }))
  }, [form.name])

  // Debounced availability check so the user learns about a clash before saving.
  useEffect(() => {
    if (!form.slug || form.slug === initial?.slug) {
      setSlugState('idle')
      return
    }
    const parsed = validate(
      businessSetupSchema.shape.slug,
      form.slug,
    )
    if (!parsed.ok) {
      setSlugState('idle')
      return
    }
    let cancelled = false
    setSlugState('checking')
    const timer = window.setTimeout(async () => {
      try {
        const result = await api.slugAvailable(form.slug)
        if (!cancelled) setSlugState(result.available ? 'free' : 'taken')
      } catch {
        if (!cancelled) setSlugState('idle')
      }
    }, 350)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [form.slug, initial?.slug])

  const previewUrl = useMemo(() => {
    const origin = typeof window === 'undefined' ? '' : window.location.origin
    return `${origin}/t/${form.slug || 'your-link'}`
  }, [form.slug])

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }))
    setErrors((current) => {
      if (!current[key as string]) return current
      const next = { ...current }
      delete next[key as string]
      return next
    })
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    const parsed = validate(businessSetupSchema, form)
    if (!parsed.ok) {
      setErrors(parsed.errors)
      notify('Please fix the highlighted fields.', 'error')
      return
    }
    if (slugState === 'taken') {
      setErrors({ slug: 'That link name is already taken.' })
      return
    }
    setErrors({})
    setSaving(true)
    try {
      const result =
        mode === 'create'
          ? await api.createBusiness(parsed.data)
          : await api.updateBusiness(parsed.data)
      setBusiness(result.business)
      notify(mode === 'create' ? 'Your workspace is ready.' : 'Settings saved.', 'success')
      onSaved?.(result.business)
    } catch (error) {
      const fields =
        error && typeof error === 'object' && 'fields' in error
          ? ((error as { fields?: Record<string, string> }).fields ?? {})
          : {}
      setErrors(fields)
      notify(error instanceof Error ? error.message : 'Could not save your business.', 'error')
    } finally {
      setSaving(false)
    }
  }

  const slugHint =
    slugState === 'checking'
      ? 'Checking availability…'
      : slugState === 'taken'
        ? 'That link name is taken.'
        : slugState === 'free'
          ? 'Available'
          : 'Lowercase letters, numbers and single hyphens.'

  return (
    <form className="stack-lg" onSubmit={handleSubmit} noValidate>
      <Field label="Business name" htmlFor="biz-name" error={errors.name}>
        <Input
          id="biz-name"
          value={form.name}
          onChange={(event) => update('name', event.target.value)}
          placeholder="Northwind Studio"
          autoComplete="organization"
          maxLength={80}
          required
        />
      </Field>

      <Field
        label="Collection link"
        htmlFor="biz-slug"
        error={errors.slug}
        hint={
          <span className={slugState === 'taken' ? 'text-danger' : undefined}>{slugHint}</span>
        }
      >
        <div className="input-prefix">
          <span className="input-prefix-text">/t/</span>
          <input
            id="biz-slug"
            className="input input-inline"
            value={form.slug}
            onChange={(event) => {
              slugTouched.current = true
              update('slug', slugify(event.target.value))
            }}
            placeholder="northwind"
            maxLength={40}
            aria-describedby="biz-slug-hint"
            required
          />
        </div>
      </Field>

      <p className="preview-line">
        Your link: <code>{previewUrl}</code>
      </p>

      <Field
        label="Tagline"
        htmlFor="biz-tagline"
        optional
        error={errors.tagline}
        hint="Shown above the wall of testimonials."
      >
        <Input
          id="biz-tagline"
          value={form.tagline}
          onChange={(event) => update('tagline', event.target.value)}
          placeholder="Design studio for ambitious teams"
          maxLength={120}
        />
      </Field>

      <Field
        label="Logo URL"
        htmlFor="biz-logo"
        optional
        error={errors.logoUrl}
        hint="A square image works best."
      >
        <Input
          id="biz-logo"
          value={form.logoUrl}
          onChange={(event) => update('logoUrl', event.target.value)}
          placeholder="https://example.com/logo.png"
          inputMode="url"
          maxLength={500}
        />
      </Field>

      <div className="field">
        <span className="label" id="accent-label">
          Accent colour
        </span>
        <div className="swatches" role="radiogroup" aria-labelledby="accent-label">
          {ACCENT_PRESETS.map((color) => (
            <button
              key={color}
              type="button"
              role="radio"
              aria-checked={form.accentColor === color}
              aria-label={`Accent ${color}`}
              className={`swatch ${form.accentColor === color ? 'swatch-on' : ''}`.trim()}
              style={{ background: color }}
              onClick={() => update('accentColor', color)}
            />
          ))}
        </div>
        <div className="accent-custom">
          <Input
            id="biz-accent"
            value={form.accentColor}
            onChange={(event) => update('accentColor', event.target.value.toLowerCase())}
            maxLength={7}
            aria-label="Custom accent colour hex value"
            className="input-color"
          />
          <span className="accent-preview" style={{ background: form.accentColor }}>
            Preview
          </span>
        </div>
        {errors.accentColor ? (
          <p className="field-error" role="alert">
            {errors.accentColor}
          </p>
        ) : null}
      </div>

      <div className="form-actions">
        <Button type="submit" loading={saving} disabled={slugState === 'taken'}>
          {mode === 'create' ? 'Create workspace' : 'Save changes'}
        </Button>
      </div>
    </form>
  )
}
