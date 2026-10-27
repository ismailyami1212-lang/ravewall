/**
 * Single source of truth for input validation.
 *
 * The exact same schemas run in the browser (instant feedback) and on the
 * server (the actual trust boundary). Never rely on the browser copy alone:
 * every mutating route re-parses its body with these schemas.
 *
 * Implementation notes:
 * - Trimming uses zod's native `.trim()` rather than `z.preprocess()`. A
 *   preprocess wrapper types its input as `unknown`, which makes every field
 *   optional in the inferred output type and silently passes non-strings
 *   through — `.trim()` keeps the field required and rejects wrong types.
 * - Email is lowercased at the schema boundary, so the same address always maps
 *   to the same account regardless of how it was typed.
 */
import { z } from 'zod'
import {
  ACCENT_PRESETS,
  DEFAULT_ACCENT,
  RESERVED_SLUGS,
  SLUG_MAX,
  SLUG_MIN,
  TESTIMONIAL_TEXT_MAX,
  TESTIMONIAL_TEXT_MIN,
} from './constants.js'

/** `z.string()` with trimming applied before any length or format check. */
const text = (params) => (params ? z.string(params).trim() : z.string().trim())

export const emailSchema = text({ required_error: 'Email is required' })
  .min(3, 'Email is required')
  .max(254, 'Email is too long')
  .email('Enter a valid email address')
  .toLowerCase()

export const passwordSchema = z
  .string({ required_error: 'Password is required' })
  .min(8, 'Use at least 8 characters')
  .max(72, 'Use at most 72 characters')
  .regex(/[A-Za-z]/, 'Include at least one letter')
  .regex(/[0-9]/, 'Include at least one number')

export const displayNameSchema = text({ required_error: 'Name is required' })
  .min(1, 'Name is required')
  .max(60, 'Use at most 60 characters')

/** Normalises arbitrary user input into a candidate slug (does not validate). */
export function slugify(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX)
}

export const slugSchema = text({ required_error: 'Link name is required' })
  .min(SLUG_MIN, `Use at least ${SLUG_MIN} characters`)
  .max(SLUG_MAX, `Use at most ${SLUG_MAX} characters`)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and single hyphens')
  .refine((value) => !RESERVED_SLUGS.includes(value), 'That link name is reserved')

export const businessNameSchema = text({ required_error: 'Business name is required' })
  .min(1, 'Business name is required')
  .max(80, 'Use at most 80 characters')

export const taglineSchema = text()
  .max(120, 'Use at most 120 characters')
  .optional()
  .default('')

export const hexColorSchema = text()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour such as #15803d')
  .toLowerCase()

export const accentColorSchema = hexColorSchema
  .refine(
    (value) => ACCENT_PRESETS.includes(value) || /^#[0-9a-f]{6}$/.test(value),
    'Unsupported accent colour',
  )
  .default(DEFAULT_ACCENT)

export const logoUrlSchema = z
  .union([
    z.literal(''),
    text()
      .max(500, 'Logo URL is too long')
      .refine((value) => /^https?:\/\//i.test(value), 'Logo must be an http(s) URL'),
  ])
  .default('')

export const ratingSchema = z.coerce
  .number({ invalid_type_error: 'Choose a rating' })
  .int('Choose a rating')
  .min(1, 'Choose a rating')
  .max(5, 'Choose a rating')

export const signupSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: displayNameSchema,
})

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required').max(72, 'Password is too long'),
})

/**
 * Branding fields shared by client creation/updates. `accent` is accepted as a
 * compatibility alias for `accentColor`: some older client detail views send
 * the short name, while the database and API have always used `accentColor`.
 */
const brandingFields = {
  tagline: taglineSchema.optional(),
  logoUrl: logoUrlSchema.optional(),
  accentColor: accentColorSchema.optional(),
  accent: hexColorSchema.optional(),
}

/** Drops the alias and maps it onto the canonical `accentColor` field. */
function normalizeBranding(value) {
  const { accent, ...rest } = value
  if (rest.accentColor === undefined && accent !== undefined) rest.accentColor = accent
  return rest
}

export const businessSetupSchema = z.object({
  name: businessNameSchema,
  slug: slugSchema,
  tagline: taglineSchema,
  logoUrl: logoUrlSchema,
  accentColor: accentColorSchema,
})

export const businessUpdateSchema = businessSetupSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Nothing to update')

export const testimonialSubmissionSchema = z.object({
  rating: ratingSchema,
  name: displayNameSchema,
  company: text().max(80, 'Use at most 80 characters').optional().default(''),
  text: text({ required_error: 'Please write a testimonial' })
    .min(TESTIMONIAL_TEXT_MIN, `Please write at least ${TESTIMONIAL_TEXT_MIN} characters`)
    .max(TESTIMONIAL_TEXT_MAX, `Please keep it under ${TESTIMONIAL_TEXT_MAX} characters`),
  /**
   * Answers to the project's custom questions, keyed by question id. The public
   * route whitelists known ids and enforces required questions; the schema's
   * job is simply to let the object survive parsing.
   */
  answers: z
    .record(
      z
        .union([z.string(), z.number(), z.boolean()])
        .transform((value) => String(value).trim())
        .refine((value) => value.length <= 500, 'Use at most 500 characters'),
    )
    .refine((value) => Object.keys(value).length <= 50, 'Too many answers')
    .optional()
    .default({}),
  // Hidden field: real people never fill it in. Bots usually do.
  website: z.string().max(200).optional().default(''),
})

export const moderationSchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected']),
})

export const listQuerySchema = z.object({
  status: z.enum(['all', 'pending', 'approved', 'rejected']).default('all'),
  q: text().max(80).optional().default(''),
  sort: z.enum(['newest', 'oldest', 'rating']).default('newest'),
})

/**
 * Flattens a ZodError into `{ field: message }` so the UI can attach messages
 * to the right input.
 * @param {import('zod').ZodError} error
 * @returns {Record<string, string>}
 */
export function fieldErrors(error) {
  /** @type {Record<string, string>} */
  const out = {}
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_'
    if (!out[key]) out[key] = issue.message
  }
  return out
}

/**
 * Parses input with a schema and returns either the parsed data or per-field
 * messages. The generic is the *schema* type, so `data` is typed as the schema's
 * output (after trimming, coercion and defaults) rather than its raw input shape.
 *
 * @template {import('zod').ZodTypeAny} S
 * @param {S} schema
 * @param {unknown} input
 * @returns {{ ok: true, data: import('zod').output<S> } | { ok: false, errors: Record<string, string> }}
 */
export function validate(schema, input) {
  const result = schema.safeParse(input)
  if (result.success) return { ok: true, data: result.data }
  return { ok: false, errors: fieldErrors(result.error) }
}

/* -------------------------------------------------------------------------- */
/* Workspace, clients, projects, team                                         */
/* -------------------------------------------------------------------------- */

export const projectSchema = z.object({
  name: businessNameSchema,
  slug: slugSchema.optional(),
})

/** Client creation accepts the same branding fields as the client editor. */
export const clientCreateSchema = z
  .object({
    name: businessNameSchema,
    slug: slugSchema.optional(),
    ...brandingFields,
  })
  .transform(normalizeBranding)

/**
 * A client edit (and project edit) may include branding. Some client detail
 * views send `accent`, while the database column is `accent_color`; both names
 * are accepted and normalised to `accentColor` before the route persists it.
 */
export const projectUpdateSchema = z
  .object({
    name: businessNameSchema.optional(),
    slug: slugSchema.optional(),
    ...brandingFields,
  })
  .transform(normalizeBranding)
  .refine((value) => Object.keys(value).length > 0, 'Nothing to update')

export const memberSchema = z.object({
  email: emailSchema,
  role: z.enum(['admin', 'manager', 'viewer']).default('manager'),
})

export const memberUpdateSchema = z.object({
  role: z.enum(['owner', 'admin', 'manager', 'viewer']),
})

export const memberClientsSchema = z.object({
  clientIds: z.array(z.string().uuid('Invalid client id')).max(200),
})

export const workspaceUpdateSchema = z.object({
  name: businessNameSchema,
})

/**
 * Checkout input.
 *
 * A plan name is preferred. A price id is accepted for compatibility with
 * existing clients, but the route only accepts ids that match the server's
 * configured prices — it is never passed through to Stripe unchecked.
 */
export const billingCheckoutSchema = z
  .object({
    plan: z.enum(['starter', 'pro', 'agency']).optional(),
    priceId: text().max(200).optional(),
  })
  .refine((value) => Boolean(value.plan || value.priceId), 'Choose a plan.')

/* -------------------------------------------------------------------------- */
/* Tags, custom questions, saved widgets                                      */
/* -------------------------------------------------------------------------- */

export const tagSchema = z.object({
  name: text({ required_error: 'Tag name is required' })
    .min(1, 'Tag name is required')
    .max(40, 'Use at most 40 characters'),
})

export const questionSchema = z.object({
  label: text({ required_error: 'Question is required' })
    .min(1, 'Question is required')
    .max(120, 'Use at most 120 characters'),
  type: z.enum(['short', 'long', 'rating', 'company']).default('short'),
  required: z.boolean().optional().default(false),
  position: z.number().int().min(0).max(50).optional(),
})

export const WIDGET_STATUS_VALUES = ['draft', 'live', 'archived']

export const widgetConfigSchema = z.object({
  name: text({ required_error: 'Name is required' })
    .min(1, 'Name is required')
    .max(60, 'Use at most 60 characters'),
  layout: z.enum(['grid', 'carousel', 'single', 'compact']).default('grid'),
  theme: z.enum(['light', 'dark']).default('light'),
  accent: hexColorSchema.default(DEFAULT_ACCENT),
  showStars: z.boolean().default(true),
  showCompany: z.boolean().default(true),
  max: z.coerce.number().int().min(1).max(50).default(9),
  minRating: z.union([z.null(), z.coerce.number().int().min(1).max(5)]).optional().default(null),
  tagId: z.union([z.null(), z.string().uuid('Invalid tag id')]).optional().default(null),
  // New saved widgets start as drafts; publishing is an explicit action.
  status: z.enum(WIDGET_STATUS_VALUES).default('draft'),
})

/**
 * Partial update for a saved widget. Unlike `widgetConfigSchema`, omitted fields
 * stay untouched — so "Publish" can send `{ status: 'live' }` alone without
 * resetting the layout or accent.
 */
export const widgetPatchSchema = z
  .object({
    name: text().min(1, 'Name is required').max(60, 'Use at most 60 characters').optional(),
    layout: z.enum(['grid', 'carousel', 'single', 'compact']).optional(),
    theme: z.enum(['light', 'dark']).optional(),
    accent: hexColorSchema.optional(),
    showStars: z.boolean().optional(),
    showCompany: z.boolean().optional(),
    max: z.coerce.number().int().min(1).max(50).optional(),
    minRating: z.union([z.null(), z.coerce.number().int().min(1).max(5)]).optional(),
    tagId: z.union([z.null(), z.string().uuid('Invalid tag id')]).optional(),
    status: z.enum(WIDGET_STATUS_VALUES).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Nothing to update')

/* -------------------------------------------------------------------------- */
/* Account management                                                         */
/* -------------------------------------------------------------------------- */

export const accountSchema = z
  .object({
    name: displayNameSchema.optional(),
    email: emailSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Nothing to update')

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password').max(72),
  newPassword: passwordSchema,
})

export const testimonialTagsSchema = z.object({
  tagIds: z.array(z.string().uuid('Invalid tag id')).max(10),
})

export const importSchema = z.object({
  rows: z.array(z.record(z.string())).min(1, 'Nothing to import').max(500, 'Import at most 500 rows at once'),
  commit: z.boolean().optional().default(false),
})
