/**
 * Shared types for the RaveWall widget.
 *
 * The same `WidgetData` shape is produced by the server API
 * (`GET /api/public/widget/:slug`) and consumed by every layout, so the
 * in-app preview and the embedded widget can never drift apart.
 */

export type WidgetLayout = 'grid' | 'carousel' | 'single' | 'compact'
export type WidgetTheme = 'light' | 'dark'

export interface WidgetOptions {
  /** Public business slug the widget shows testimonials for (legacy embeds). */
  slug: string
  /** Saved-widget public id (`data-rw-widget`). Takes precedence over slug. */
  widgetId?: string
  layout: WidgetLayout
  theme: WidgetTheme
  /** Card accent colour, hex lowercase. */
  accent: string
  /**
   * True when the accent came from the embed attributes. When false the
   * business's own stored accent is used instead, so a hand-written embed
   * still picks up the customer's brand.
   */
  accentExplicit: boolean
  showStars: boolean
  showCompany: boolean
  /** Maximum testimonials rendered (1–50). */
  max: number
}

/** Saved-widget presentation config returned by the by-id feed. */
export interface WidgetPublicConfig {
  layout: WidgetLayout
  theme: WidgetTheme
  accent: string
  showStars: boolean
  showCompany: boolean
  max: number
}

export interface WidgetBusiness {
  name: string
  slug: string
  tagline: string
  logoUrl: string
  accentColor: string
}

export interface WidgetTestimonial {
  id: string
  rating: number
  name: string
  company: string
  text: string
  createdAt: string
}

export interface WidgetStats {
  count: number
  averageRating: number
}

export interface WidgetData {
  business: WidgetBusiness
  testimonials: WidgetTestimonial[]
  stats: WidgetStats
  /** Present when fetched by saved-widget public id. */
  widget?: WidgetPublicConfig
}
