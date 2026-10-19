import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  TextareaHTMLAttributes,
} from 'react'
import {
  ICON_PATH,
  ICON_VIEWBOX,
  LOGO_GREEN,
  WORDMARK_PATH,
  WORDMARK_VIEWBOX,
} from '../logo-paths'

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="spinner-wrap">
      <span className="spinner" aria-hidden="true" />
      {label ? <span className="spinner-label">{label}</span> : null}
      <span className="sr-only">{label ?? 'Loading'}</span>
    </span>
  )
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'outline' | 'ghost' | 'danger' | 'subtle'
  size?: 'sm' | 'md'
  loading?: boolean
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  className = '',
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`btn btn-${variant} btn-${size} ${className}`.trim()}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <span className="btn-spinner" aria-hidden="true" /> : null}
      {children}
    </button>
  )
}

type FieldProps = {
  label: string
  htmlFor: string
  error?: string
  hint?: ReactNode
  optional?: boolean
  className?: string
  children: ReactNode
}

export function Field({ label, htmlFor, error, hint, optional, className, children }: FieldProps) {
  return (
    <div className={`field ${error ? 'field-invalid' : ''} ${className ?? ''}`.trim()}>
      <label className="label" htmlFor={htmlFor}>
        {label}
        {optional ? <span className="label-optional">optional</span> : null}
      </label>
      {children}
      {error ? (
        <p className="field-error" id={`${htmlFor}-error`} role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="field-hint" id={`${htmlFor}-hint`}>
          {hint}
        </p>
      ) : null}
    </div>
  )
}

export function Input({ className = '', ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`input ${className}`.trim()} {...rest} />
}

export function Textarea({ className = '', ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`input textarea ${className}`.trim()} {...rest} />
}

export function Card({ className = '', children, style }: { className?: string; children: ReactNode; style?: React.CSSProperties }) {
  return (
    <div className={`card ${className}`.trim()} style={style}>
      {children}
    </div>
  )
}

const STATUS_LABEL: Record<string, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
}

export function StatusBadge({ status }: { status: string }) {
  return <span className={`badge badge-${status}`}>{STATUS_LABEL[status] ?? status}</span>
}

export function StatCard({
  label,
  value,
  hint,
  accent = false,
}: {
  label: string
  value: ReactNode
  hint?: string
  accent?: boolean
}) {
  return (
    <div className={`stat-card ${accent ? 'stat-card-accent' : ''}`.trim()}>
      <p className="stat-label">{label}</p>
      <p className="stat-value">{value}</p>
      {hint ? <p className="stat-hint">{hint}</p> : null}
    </div>
  )
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon" aria-hidden="true">
        ✦
      </div>
      <h3>{title}</h3>
      {description ? <p>{description}</p> : null}
      {action ? <div className="empty-action">{action}</div> : null}
    </div>
  )
}

/**
 * RaveWall brand lockup: the green sprout mark followed by the "RaveWall"
 * wordmark. Both are traced from the official reference artwork, so they stay
 * crisp at every size and the wordmark follows the surrounding text colour
 * (charcoal on light, near-white on dark) through `currentColor`.
 */
export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="logo" role="img" aria-label="RaveWall">
      <svg className="logo-icon" viewBox={ICON_VIEWBOX} aria-hidden="true" focusable="false">
        <path fill={LOGO_GREEN} fillRule="evenodd" d={ICON_PATH} />
      </svg>
      {compact ? null : (
        <svg className="logo-word" viewBox={WORDMARK_VIEWBOX} aria-hidden="true" focusable="false">
          <path fill="currentColor" fillRule="evenodd" d={WORDMARK_PATH} />
        </svg>
      )}
    </span>
  )
}
