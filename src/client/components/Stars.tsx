import { useId } from 'react'
import { MAX_RATING } from '../../shared/constants.js'

/** Read-only star display. */
export function Stars({ value, size = 'md' }: { value: number; size?: 'sm' | 'md' | 'lg' }) {
  const rounded = Math.round(value)
  return (
    <span className={`stars stars-${size}`} role="img" aria-label={`${value} out of 5 stars`}>
      {Array.from({ length: MAX_RATING }, (_, index) => (
        <span key={index} className={index < rounded ? 'star star-on' : 'star star-off'}>
          ★
        </span>
      ))}
    </span>
  )
}

type StarRatingProps = {
  value: number
  onChange: (value: number) => void
  name?: string
  error?: string
}

/**
 * Interactive 1–5 star picker.
 *
 * Built on native radio inputs so keyboard interaction, screen reader semantics
 * and form behaviour all come for free.
 */
export function StarRating({ value, onChange, name, error }: StarRatingProps) {
  const groupName = useId()
  const inputName = name ?? groupName
  const labels = ['Poor', 'Fair', 'Good', 'Great', 'Excellent']

  return (
    <div className="star-picker">
      <div
        className="star-picker-row"
        role="radiogroup"
        aria-label="Rating out of 5 stars"
        aria-invalid={error ? true : undefined}
      >
        {Array.from({ length: MAX_RATING }, (_, index) => {
          const rating = index + 1
          const id = `${inputName}-${rating}`
          return (
            <span key={rating} className="star-option">
              <input
                type="radio"
                id={id}
                name={inputName}
                value={rating}
                checked={value === rating}
                onChange={() => onChange(rating)}
                className="star-radio"
              />
              <label htmlFor={id} className="star-label" title={`${rating} – ${labels[index]}`}>
                <span aria-hidden="true">★</span>
                <span className="sr-only">{`${rating} star${rating === 1 ? '' : 's'} – ${labels[index]}`}</span>
              </label>
            </span>
          )
        })}
      </div>
      <p className="star-picker-caption">
        {value > 0 ? (
          <>
            <strong>{labels[value - 1]}</strong> — {value} of 5
          </>
        ) : (
          'Tap a star to rate'
        )}
      </p>
    </div>
  )
}
