import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { DashboardEmptyState, OnboardingChecklist } from '../../client/pages/Dashboard'
import type { Client } from '../../client/api'

const CLIENT: Client = {
  id: 'client_1',
  workspaceId: 'ws_1',
  ownerId: 'user_1',
  name: 'Acme Design Studio',
  slug: 'acme',
  tagline: '',
  logoUrl: '',
  accentColor: '#15803d',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const OVERVIEW = {
  clients: 1,
  projects: 1,
  testimonials: 0,
  thisMonth: 0,
  pending: 0,
  approved: 0,
  widgets: { total: 0, live: 0, draft: 0, archived: 0 },
  topClients: [],
  trend: [],
}

function renderChecklist(clients: Client[] = [CLIENT], overview = OVERVIEW) {
  return render(
    <MemoryRouter>
      <OnboardingChecklist overview={overview} clients={clients} />
    </MemoryRouter>,
  )
}

describe('dashboard onboarding checklist', () => {
  it('shows the three requested steps and real progress', () => {
    renderChecklist()

    expect(screen.getByRole('heading', { name: 'Get started' })).toBeInTheDocument()
    expect(screen.getByText('Add your first client workspace')).toBeInTheDocument()
    expect(screen.getByText('Configure collection questions / branding')).toBeInTheDocument()
    expect(screen.getByText('Generate & share your collection link')).toBeInTheDocument()
    expect(screen.getByText('1 of 3 complete')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /dismiss/i })).not.toBeInTheDocument()

    const progress = screen.getByRole('progressbar', { name: /onboarding progress/i })
    expect(progress).toHaveAttribute('aria-valuenow', '1')
    expect(progress).toHaveAttribute('aria-valuemax', '3')
  })

  it('links the incomplete steps to the first client', () => {
    renderChecklist()

    expect(
      screen.getByRole('link', { name: /Configure collection questions \/ branding/ }),
    ).toHaveAttribute('href', '/clients/client_1')
    expect(
      screen.getByRole('link', { name: /Generate & share your collection link/ }),
    ).toHaveAttribute('href', '/clients/client_1')
  })

  it('marks branding configuration as done when a client is customised', () => {
    renderChecklist([{ ...CLIENT, tagline: 'Brand and product design' }])

    expect(screen.getByText('2 of 3 complete')).toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: /Configure collection questions \/ branding/ }),
    ).not.toBeInTheDocument()
  })

  it('disappears once all three steps are complete', () => {
    const { container } = renderChecklist([{ ...CLIENT, logoUrl: 'https://example.com/logo.svg' }], {
      ...OVERVIEW,
      testimonials: 1,
      approved: 1,
    })

    expect(container).toBeEmptyDOMElement()
  })
})

describe('dashboard first-run empty state', () => {
  it('shows the sample wall and the first-client action', async () => {
    const user = userEvent.setup()
    const copy = vi.fn()
    render(
      <MemoryRouter>
        <DashboardEmptyState
          hasClients
          canManageClients
          shareSlug="acme"
          onCopyLink={copy}
        />
      </MemoryRouter>,
    )

    expect(screen.getByText('Acme Design Studio — 3 Testimonials collected')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '+ Add Your First Client' })).toHaveAttribute(
      'href',
      '/clients?new=1',
    )
    expect(screen.getByRole('link', { name: /preview form/i })).toHaveAttribute(
      'href',
      `${window.location.origin}/t/acme`,
    )

    await user.click(screen.getByRole('button', { name: /copy collection link/i }))
    expect(copy).toHaveBeenCalledTimes(1)
  })

  it('does not offer client creation to read-only teammates', () => {
    render(
      <MemoryRouter>
        <DashboardEmptyState
          hasClients
          canManageClients={false}
          shareSlug="acme"
          onCopyLink={() => undefined}
        />
      </MemoryRouter>,
    )

    expect(screen.queryByRole('link', { name: '+ Add Your First Client' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /open clients/i })).toHaveAttribute('href', '/clients')
  })
})
