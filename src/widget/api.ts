/**
 * Widget data fetching.
 *
 * The API origin is resolved from the widget script's own URL by default, so
 * an embed on a customer's site always talks back to the RaveWall origin it
 * was loaded from — never to the host page's origin. The in-app preview
 * passes its own origin explicitly.
 */

import type { WidgetData } from './types'

const API_PATH = '/api/public/widget/'
const SAVED_API_PATH = '/api/public/widgets/'

function defaultOrigin(): string {
  if (typeof window === 'undefined') return 'https://ravewall.vercel.app'
  return window.location.origin
}

export async function fetchWidgetData(
  slug: string,
  fetchImpl: typeof fetch = fetch,
  apiOrigin: string = defaultOrigin(),
): Promise<WidgetData> {
  const base = apiOrigin.replace(/\/$/, '')
  const response = await fetchImpl(`${base}${API_PATH}${encodeURIComponent(slug)}`, {
    headers: { Accept: 'application/json' },
  })
  if (!response.ok) {
    throw new Error(`widget data request failed with ${response.status}`)
  }
  const payload = (await response.json()) as { data?: WidgetData }
  const data = payload?.data
  if (!data || !Array.isArray(data.testimonials) || !data.business) {
    throw new Error('widget data response was malformed')
  }
  return data
}

/**
 * Fetches a saved widget by its stable public id. The response carries the
 * widget's stored presentation config, so editing the widget in the dashboard
 * updates every embed that points at it.
 */
export async function fetchWidgetDataById(
  publicId: string,
  fetchImpl: typeof fetch = fetch,
  apiOrigin: string = defaultOrigin(),
): Promise<WidgetData> {
  const base = apiOrigin.replace(/\/$/, '')
  const response = await fetchImpl(`${base}${SAVED_API_PATH}${encodeURIComponent(publicId)}`, {
    headers: { Accept: 'application/json' },
  })
  if (!response.ok) {
    throw new Error(`saved widget request failed with ${response.status}`)
  }
  const payload = (await response.json()) as { data?: WidgetData }
  const data = payload?.data
  if (!data || !Array.isArray(data.testimonials) || !data.business) {
    throw new Error('saved widget response was malformed')
  }
  return data
}
