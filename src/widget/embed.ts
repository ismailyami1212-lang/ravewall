/**
 * Embed bootstrap.
 *
 * Scans the host page for `[data-ravewall-widget]` elements and mounts a widget
 * into each. Safe to call repeatedly; elements that already have a shadow root
 * are skipped. Exposed as `window.RaveWallWidget.refresh()` so hosts that
 * inject content dynamically (SPAs, tabs, modals) can re-scan.
 */
import { mountWidget } from './mount'
import { optionsFromElement } from './options'

const EMBED_ATTRIBUTE = 'data-ravewall-widget'

/**
 * The origin the widget data must come from: the RaveWall origin the script
 * itself was served from. Captured while the script runs — never the host
 * page's origin — so an embed on a customer's website fetches from RaveWall,
 * not from the customer's domain.
 */
function scriptOrigin(): string {
  try {
    const current = document.currentScript as HTMLScriptElement | null
    if (current?.src) return new URL(current.src).origin
  } catch {
    /* fall through to the page origin */
  }
  return window.location.origin
}

const API_ORIGIN = typeof document !== 'undefined' ? scriptOrigin() : 'https://ravewall.vercel.app'

function boot(): void {
  if (typeof document === 'undefined') return
  const hosts = document.querySelectorAll(`[${EMBED_ATTRIBUTE}]`)
  hosts.forEach((element) => {
    if (element.shadowRoot) return
    const options = optionsFromElement(element)
    void mountWidget(element as HTMLElement, options, API_ORIGIN)
  })
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true })
  } else {
    boot()
  }
}

declare global {
  interface Window {
    RaveWallWidget?: { refresh: () => void }
  }
}

if (typeof window !== 'undefined') {
  window.RaveWallWidget = { refresh: boot }
}
