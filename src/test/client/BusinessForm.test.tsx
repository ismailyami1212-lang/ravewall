import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BusinessForm } from '../../client/components/BusinessForm'
import { ToastProvider } from '../../client/components/Toast'
import { SessionProvider } from '../../client/session'
import { jsonResponse } from '../setup'

function stubFetch(available = true) {
  const mock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/api/auth/me')) {
      return jsonResponse({ data: { user: null, business: null } })
    }
    if (url.includes('/api/business/slug-available')) {
      return jsonResponse({ data: { slug: 'northwind-studio', available } })
    }
    throw new Error(`unexpected request: ${url}`)
  })
  vi.stubGlobal('fetch', mock)
  return mock
}

function renderForm() {
  return render(
    <ToastProvider>
      <SessionProvider>
        <BusinessForm mode="create" />
      </SessionProvider>
    </ToastProvider>,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('BusinessForm', () => {
  it('derives the collection link from the business name', async () => {
    stubFetch()
    renderForm()
    await userEvent.type(screen.getByLabelText('Business name'), 'Northwind Studio')
    await waitFor(() =>
      expect(screen.getByLabelText('Collection link')).toHaveValue('northwind-studio'),
    )
  })

  it('stops deriving once the link name is edited by hand', async () => {
    stubFetch()
    renderForm()
    const slugInput = screen.getByLabelText('Collection link')
    await userEvent.type(slugInput, 'custom')
    await userEvent.type(screen.getByLabelText('Business name'), 'Northwind Studio')
    await waitFor(() => expect(slugInput).toHaveValue('custom'))
  })

  it('reports when a link name is taken', async () => {
    stubFetch(false)
    renderForm()
    await userEvent.type(screen.getByLabelText('Business name'), 'Northwind Studio')
    expect(await screen.findByText(/that link name is taken/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /create workspace/i })).toBeDisabled()
  })

  it('confirms availability', async () => {
    stubFetch(true)
    renderForm()
    await userEvent.type(screen.getByLabelText('Business name'), 'Northwind Studio')
    expect(await screen.findByText('Available')).toBeInTheDocument()
  })

  it('validates before calling the API', async () => {
    const fetchMock = stubFetch()
    renderForm()
    await userEvent.click(screen.getByRole('button', { name: /create workspace/i }))
    expect(await screen.findByText('Business name is required')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1) // only the session lookup
  })

  it('offers accent presets and reflects the selection', async () => {
    stubFetch()
    renderForm()
    const swatches = screen.getAllByRole('radio')
    expect(swatches.length).toBeGreaterThan(3)
    await userEvent.click(swatches[2])
    expect(swatches[2]).toHaveAttribute('aria-checked', 'true')
  })
})
