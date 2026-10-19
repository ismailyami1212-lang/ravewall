/**
 * Values shared by the browser bundle and the Node server.
 * Kept as plain JS (with JSDoc) so both runtimes can import it verbatim.
 */

/** @typedef {'pending' | 'approved' | 'rejected'} TestimonialStatus */

/** @type {ReadonlyArray<TestimonialStatus>} */
export const TESTIMONIAL_STATUSES = ['pending', 'approved', 'rejected']

/** Statuses a visitor is allowed to see on the public wall. */
export const PUBLIC_STATUS = 'approved'

/** Slugs that would collide with application routes or look official. */
export const RESERVED_SLUGS = Object.freeze([
  'admin',
  'api',
  'app',
  'assets',
  'auth',
  'billing',
  'blog',
  'dashboard',
  'docs',
  'embed',
  'favicon',
  'health',
  'help',
  'index',
  'login',
  'logout',
  'manifest',
  'me',
  'new',
  'pricing',
  'public',
  'robots',
  'settings',
  'signup',
  'sitemap',
  'static',
  'status',
  'support',
  't',
  'terms',
  'wall',
  'www',
])

export const SLUG_MIN = 3
export const SLUG_MAX = 40

export const TESTIMONIAL_TEXT_MIN = 10
export const TESTIMONIAL_TEXT_MAX = 1000

export const DEFAULT_ACCENT = '#15803d'

/** Accent presets offered in business setup. */
export const ACCENT_PRESETS = Object.freeze([
  '#15803d',
  '#0ea5e9',
  '#0d9488',
  '#16a34a',
  '#ca8a04',
  '#ea580c',
  '#dc2626',
  '#db2777',
  '#6d28d9',
  '#334155',
])

export const SESSION_COOKIE = 'kudos_session'

/** Session lifetime ceiling, used by both the cookie and the stored session. */
export const MAX_RATING = 5
export const MIN_RATING = 1
