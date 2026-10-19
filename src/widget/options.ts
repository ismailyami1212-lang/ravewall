/**
 * Option parsing and validation for the widget.
 *
 * Options arrive as `data-rw-*` attributes on the embed element. Every value is
 * validated here with a safe fallback, so a malformed attribute can never
 * produce broken markup or arbitrary styling. The server does not know about
 * layout options — they are purely presentational and rendered client-side.
 */
import type { WidgetLayout, WidgetOptions, WidgetTheme } from './types'

export const LAYOUTS: readonly WidgetLayout[] = ['grid', 'carousel', 'single', 'compact']
export const THEMES: readonly WidgetTheme[] = ['light', 'dark']

export const DEFAULT_ACCENT = '#15803d'
export const MIN_COUNT = 1
export const MAX_COUNT = 50
export const DEFAULT_COUNT = 9

const HEX = /^#[0-9a-f]{6}$/i

export function parseLayout(value: string | null | undefined): WidgetLayout {
  return LAYOUTS.includes(value as WidgetLayout) ? (value as WidgetLayout) : 'grid'
}

export function parseTheme(value: string | null | undefined): WidgetTheme {
  return THEMES.includes(value as WidgetTheme) ? (value as WidgetTheme) : 'light'
}

export function parseAccent(value: string | null | undefined): string {
  if (!value || !HEX.test(value)) return DEFAULT_ACCENT
  return value.toLowerCase()
}

export function parseBoolean(value: string | null | undefined, fallback = true): boolean {
  if (value === null || value === undefined || value.trim() === '') return fallback
  const normalised = value.trim().toLowerCase()
  if (['true', '1', 'yes', 'on'].includes(normalised)) return true
  if (['false', '0', 'no', 'off'].includes(normalised)) return false
  return fallback
}

export function parseCount(value: string | null | undefined): number {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(parsed)) return DEFAULT_COUNT
  return Math.min(MAX_COUNT, Math.max(MIN_COUNT, parsed))
}

/** Reads `data-rw-*` attributes from an element into validated options. */
export function optionsFromElement(element: Element): WidgetOptions {
  const read = (name: string) => element.getAttribute(`data-rw-${name}`)
  const accentAttr = read('accent')
  const widgetId = (read('widget') ?? '').trim()
  return {
    slug: (read('slug') ?? '').trim(),
    widgetId: widgetId || undefined,
    layout: parseLayout(read('layout')),
    theme: parseTheme(read('theme')),
    accent: parseAccent(accentAttr),
    // An explicit attribute wins over the business accent; the mount step
    // applies the business accent only when this is false.
    accentExplicit: accentAttr !== null && accentAttr.trim() !== '',
    showStars: parseBoolean(read('stars'), true),
    showCompany: parseBoolean(read('company'), true),
    max: parseCount(read('max')),
  }
}

/** Serialises options back into embed attributes (used by the dashboard copy box). */
export function embedAttributes(options: WidgetOptions): Record<string, string> {
  return {
    'data-rw-slug': options.slug,
    'data-rw-layout': options.layout,
    'data-rw-theme': options.theme,
    'data-rw-accent': options.accent,
    'data-rw-stars': String(options.showStars),
    'data-rw-company': String(options.showCompany),
    'data-rw-max': String(options.max),
  }
}
