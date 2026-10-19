import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { StarRating, Stars } from '../../client/components/Stars'

describe('Stars', () => {
  it('renders five stars and an accessible label', () => {
    render(<Stars value={4} />)
    expect(screen.getByRole('img', { name: '4 out of 5 stars' })).toBeInTheDocument()
    expect(screen.getAllByText('★')).toHaveLength(5)
  })

  it('rounds fractional averages for display', () => {
    render(<Stars value={4.6} />)
    expect(screen.getByRole('img', { name: '4.6 out of 5 stars' })).toBeInTheDocument()
    const on = document.querySelectorAll('.star-on')
    expect(on).toHaveLength(5)
  })
})

describe('StarRating', () => {
  it('exposes a radio group of five options', () => {
    render(<StarRating value={0} onChange={() => {}} />)
    expect(screen.getByRole('radiogroup', { name: /rating out of 5 stars/i })).toBeInTheDocument()
    expect(screen.getAllByRole('radio')).toHaveLength(5)
  })

  it('reports the chosen rating', async () => {
    const onChange = vi.fn()
    render(<StarRating value={0} onChange={onChange} />)
    await userEvent.click(screen.getAllByRole('radio')[3])
    expect(onChange).toHaveBeenCalledWith(4)
  })

  it('prompts the user before a rating is chosen', () => {
    render(<StarRating value={0} onChange={() => {}} />)
    expect(screen.getByText(/tap a star to rate/i)).toBeInTheDocument()
  })

  it('describes the selected rating in words', () => {
    render(<StarRating value={5} onChange={() => {}} />)
    const caption = document.querySelector('.star-picker-caption')
    expect(caption).toHaveTextContent('Excellent')
    expect(caption).toHaveTextContent('5 of 5')
  })

  it('marks the group invalid when an error is passed', () => {
    render(<StarRating value={0} onChange={() => {}} error="Choose a rating" />)
    expect(screen.getByRole('radiogroup')).toHaveAttribute('aria-invalid', 'true')
  })
})
