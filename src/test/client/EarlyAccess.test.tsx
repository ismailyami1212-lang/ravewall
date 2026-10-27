import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import {
  EARLY_ACCESS_BODY,
  EARLY_ACCESS_TITLE,
  EarlyAccessBanner,
  EarlyAccessTrigger,
} from '../../client/components/EarlyAccess'

function renderWithRouter(ui: ReactNode) {
  return render(<MemoryRouter>{ui}</MemoryRouter>)
}

describe('Early Access notice', () => {
  it('shows a persistent banner with the Early Access promise', () => {
    renderWithRouter(<EarlyAccessBanner />)

    expect(screen.getByText(EARLY_ACCESS_TITLE)).toBeInTheDocument()
    expect(screen.getByText(/no credit card required/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /pricing details/i })).toBeInTheDocument()
  })

  it('opens an accessible modal instead of a checkout', async () => {
    const user = userEvent.setup()
    renderWithRouter(<EarlyAccessBanner />)

    await user.click(screen.getByRole('button', { name: /pricing details/i }))

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByRole('heading', { name: EARLY_ACCESS_TITLE })).toBeInTheDocument()
    expect(screen.getByText(EARLY_ACCESS_BODY)).toBeInTheDocument()
    expect(screen.getByText(/paid plans are not on sale yet/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /compare plans/i })).toHaveAttribute('href', '/pricing')

    await user.click(screen.getByRole('button', { name: 'Continue free' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('closes on Escape and restores document scrolling', async () => {
    const user = userEvent.setup()
    renderWithRouter(<EarlyAccessBanner />)

    await user.click(screen.getByRole('button', { name: /pricing details/i }))
    expect(document.body.style.overflow).toBe('hidden')

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(document.body.style.overflow).toBe('')
  })

  it('makes an upgrade control open the explanation', async () => {
    const user = userEvent.setup()
    renderWithRouter(<EarlyAccessTrigger label="Upgrade plan" />)

    await user.click(screen.getByRole('button', { name: 'Upgrade plan' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText(EARLY_ACCESS_TITLE)).toBeInTheDocument()
  })
})
