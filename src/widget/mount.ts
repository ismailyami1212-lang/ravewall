/**
 * The single mounting path shared by the embed script and the in-app preview.
 *
 * Both call `mountWidget`, so a widget can never look different in the
 * dashboard than on a customer's website. The widget:
 *   - creates its own Shadow DOM (host CSS cannot reach in, ours cannot leak out),
 *   - fetches only the approved-only public endpoint,
 *   - renders nothing at all on error or when there is nothing approved,
 *   - never throws: an embed on a host page must never break that page.
 */
import { fetchWidgetData, fetchWidgetDataById } from './api'
import { el } from './card'
import { renderLayout } from './layouts'
import { widgetCss } from './styles'
import type { WidgetData, WidgetOptions } from './types'

export interface MountResult {
  rendered: boolean
  count: number
}

/**
 * Renders a widget into `host` from data that is already in memory.
 *
 * Used by `mountWidget` after its fetch, and by the marketing showcase — the
 * same renderer powers both, so a demonstration can never drift from the real
 * embed.
 */
export function mountWidgetWithData(
  host: HTMLElement,
  data: WidgetData,
  options: WidgetOptions,
): MountResult {
  if (!options.slug && !options.widgetId) return { rendered: false, count: 0 }

  // A host can only carry one shadow root; re-mounting reuses and clears it.
  const root = host.shadowRoot ?? host.attachShadow({ mode: 'open' })
  root.replaceChildren()

  const effectiveOptions: WidgetOptions = options.accentExplicit
    ? options
    : { ...options, accent: data.business.accentColor || options.accent }

  const style = document.createElement('style')
  style.textContent = widgetCss(effectiveOptions)
  root.appendChild(style)

  const container = el('div', 'rw-root')
  container.setAttribute('data-theme', effectiveOptions.theme)
  root.appendChild(container)

  const visible = data.testimonials.slice(0, effectiveOptions.max)
  if (visible.length === 0) {
    return { rendered: false, count: 0 }
  }

  renderLayout(container, { ...data, testimonials: visible }, effectiveOptions)

  // Subtle attribution. Never dominant; never a styling burden on small cards.
  const powered = el('p', 'rw-powered')
  const link = document.createElement('a')
  link.href = 'https://ravewall.vercel.app'
  link.textContent = 'Powered by RaveWall'
  link.rel = 'noopener'
  link.target = '_blank'
  powered.appendChild(link)
  container.appendChild(powered)

  return { rendered: true, count: visible.length }
}

/**
 * Mounts a widget into `host`.
 *
 * @param host element that will carry the shadow root (the embed div, or the
 *             preview container inside the dashboard)
 * @param options validated widget options (including the slug)
 * @param apiOrigin origin of the RaveWall API; defaults to the current page.
 *             The embed bootstrap passes the widget script's own origin.
 */
export async function mountWidget(
  host: HTMLElement,
  options: WidgetOptions,
  apiOrigin?: string,
): Promise<MountResult> {
  if (!options.slug && !options.widgetId) return { rendered: false, count: 0 }

  let data: WidgetData
  try {
    data = options.widgetId
      ? await fetchWidgetDataById(options.widgetId, fetch, apiOrigin)
      : await fetchWidgetData(options.slug, fetch, apiOrigin)
  } catch {
    // Leave the (empty) shadow tree: no network noise, no broken markup.
    return { rendered: false, count: 0 }
  }

  // A saved widget's stored configuration is authoritative for presentation,
  // so editing it in the dashboard updates every embed. Explicit `data-rw-*`
  // attributes still work for hand-written slug embeds.
  const effectiveOptions: WidgetOptions = data.widget
    ? {
        ...options,
        layout: data.widget.layout,
        theme: data.widget.theme,
        accent: data.widget.accent,
        accentExplicit: true,
        showStars: data.widget.showStars,
        showCompany: data.widget.showCompany,
        max: data.widget.max,
      }
    : options

  return mountWidgetWithData(host, data, effectiveOptions)
}
