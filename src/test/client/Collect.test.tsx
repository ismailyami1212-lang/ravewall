import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Collect } from '../../client/pages/Collect'
import { ToastProvider } from '../../client/components/Toast'
import { jsonResponse } from '../setup'

const BUSINESS = {
  id: 'biz_1',
  name: 'Northwind Studio',
  slug: 'northwind',
  tagline: 'Design studio',
  logoUrl: '',
  accentColor: '#0ea5e9',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

function stubFetch(questions: unknown[] = []) {
  const mock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(input)
    if (url.includes('/api/public/business/')) {
      return jsonResponse({ data: { business: BUSINESS, questions } })
    }
    if (url.includes('/api/public/submit/')) {
      return jsonResponse({ data: { accepted: true, status: 'pending' } }, 201)
    }
    throw new Error(`unexpected request: ${url}`)
  })
  vi.stubGlobal('fetch', mock)
  return mock
}

function renderCollect(slug = 'northwind') {
  return render(
    <MemoryRouter initialEntries={[`/t/${slug}`]}>
      <ToastProvider>
        <Routes>
          <Route path="/t/:slug" element={<Collect />} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Collect page', () => {
  it('renders the form branded with the business', async () => {
    stubFetch()
    renderCollect()
    expect(await screen.findByRole('heading', { name: /leave a testimonial/i })).toBeInTheDocument()
    expect(screen.getByText('Northwind Studio')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /submit testimonial/i })).toBeInTheDocument()
  })

  it('shows a friendly message when the link does not exist', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({ error: { code: 'not_found', message: 'That testimonial page does not exist.' } }, 404),
      ),
    )
    renderCollect('missing')
    expect(await screen.findByText(/page unavailable/i)).toBeInTheDocument()
    expect(screen.getByText(/does not exist/i)).toBeInTheDocument()
  })

  it('blocks an empty submission and never calls the API', async () => {
    const fetchMock = stubFetch()
    renderCollect()
    await screen.findByRole('heading', { name: /leave a testimonial/i })

    await userEvent.click(screen.getByRole('button', { name: /submit testimonial/i }))

    expect(await screen.findByText('Choose a rating')).toBeInTheDocument()
    expect(screen.getByText('Name is required')).toBeInTheDocument()
    // The empty textarea is reported as too short, and marked invalid.
    expect(screen.getByText(/at least 10 characters/i)).toBeInTheDocument()
    expect(screen.getByLabelText('Your testimonial')).toHaveAttribute('aria-invalid', 'true')

    // Only the initial business lookup happened.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('rejects a testimonial that is too short', async () => {
    const fetchMock = stubFetch()
    renderCollect()
    await screen.findByRole('heading', { name: /leave a testimonial/i })

    await userEvent.click(screen.getAllByRole('radio')[4])
    await userEvent.type(screen.getByLabelText('Your name'), 'Mara Ellis')
    await userEvent.type(screen.getByLabelText('Your testimonial'), 'too short')
    await userEvent.click(screen.getByRole('button', { name: /submit testimonial/i }))

    expect(await screen.findByText(/at least 10 characters/i)).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('submits a valid testimonial and confirms it is awaiting review', async () => {
    const fetchMock = stubFetch()
    renderCollect()
    await screen.findByRole('heading', { name: /leave a testimonial/i })

    await userEvent.click(screen.getAllByRole('radio')[4])
    await userEvent.type(screen.getByLabelText('Your name'), 'Mara Ellis')
    await userEvent.type(screen.getByLabelText(/company/i), 'Northwind')
    await userEvent.type(
      screen.getByLabelText('Your testimonial'),
      'They shipped our new pricing page a week early.',
    )
    await userEvent.click(screen.getByRole('button', { name: /submit testimonial/i }))

    expect(await screen.findByRole('heading', { name: /thank you/i })).toBeInTheDocument()
    expect(screen.getByText(/once they review it/i)).toBeInTheDocument()

    const submitCall = fetchMock.mock.calls.find((call) => String(call[0]).includes('/submit/'))
    expect(submitCall).toBeDefined()
    const body = JSON.parse(String((submitCall?.[1] as RequestInit).body))
    expect(body).toMatchObject({
      rating: 5,
      name: 'Mara Ellis',
      company: 'Northwind',
      text: 'They shipped our new pricing page a week early.',
    })
  })

  it('renders custom questions and sends their answers with the testimonial', async () => {
    const fetchMock = stubFetch([
      { id: 'q_love', label: 'What did you love most?', type: 'long', required: true },
      { id: 'q_again', label: 'How likely are you to return?', type: 'rating', required: false },
    ])
    renderCollect()
    await screen.findByRole('heading', { name: /leave a testimonial/i })

    await userEvent.click(screen.getAllByRole('radio')[4])
    await userEvent.type(screen.getByLabelText('Your name'), 'Mara Ellis')
    await userEvent.type(
      screen.getByLabelText('Your testimonial'),
      'They shipped our new pricing page a week early.',
    )
    await userEvent.type(screen.getByLabelText('What did you love most?'), 'The calm launch process.')
    await userEvent.selectOptions(screen.getByLabelText(/How likely are you to return\?/), '5')
    await userEvent.click(screen.getByRole('button', { name: /submit testimonial/i }))

    expect(await screen.findByRole('heading', { name: /thank you/i })).toBeInTheDocument()
    const submitCall = fetchMock.mock.calls.find((call) => String(call[0]).includes('/submit/'))
    const body = JSON.parse(String((submitCall?.[1] as RequestInit).body))
    expect(body.answers).toEqual({ q_love: 'The calm launch process.', q_again: '5' })
  })

  it('blocks submission when a required custom question is unanswered', async () => {
    const fetchMock = stubFetch([
      { id: 'q_love', label: 'What did you love most?', type: 'long', required: true },
    ])
    renderCollect()
    await screen.findByRole('heading', { name: /leave a testimonial/i })

    await userEvent.click(screen.getAllByRole('radio')[4])
    await userEvent.type(screen.getByLabelText('Your name'), 'Mara Ellis')
    await userEvent.type(
      screen.getByLabelText('Your testimonial'),
      'They shipped our new pricing page a week early.',
    )
    await userEvent.click(screen.getByRole('button', { name: /submit testimonial/i }))

    expect(await screen.findByText('Please answer this question.')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('surfaces a server rejection without losing the form', async () => {
    const mock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/public/business/')) {
        return jsonResponse({ data: { business: BUSINESS } })
      }
      return jsonResponse(
        { error: { code: 'rate_limited', message: 'Please try again later.' } },
        429,
      )
    })
    vi.stubGlobal('fetch', mock)
    renderCollect()
    await screen.findByRole('heading', { name: /leave a testimonial/i })

    await userEvent.click(screen.getAllByRole('radio')[3])
    await userEvent.type(screen.getByLabelText('Your name'), 'Mara')
    await userEvent.type(
      screen.getByLabelText('Your testimonial'),
      'A perfectly reasonable testimonial body.',
    )
    await userEvent.click(screen.getByRole('button', { name: /submit testimonial/i }))

    await waitFor(() => {
      expect(screen.getByText('Please try again later.')).toBeInTheDocument()
    })
    // The form is still mounted so the visitor can retry.
    expect(screen.getByRole('button', { name: /submit testimonial/i })).toBeInTheDocument()
  })
})
