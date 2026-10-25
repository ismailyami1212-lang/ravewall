/**
 * Public wall lookup shared by the server-rendered HTML route.
 *
 * The API router has its own request-level resolver that throws AppErrors for
 * malformed or missing slugs. This module is deliberately quieter: an HTML route
 * should answer a bad slug with a 404 page, not a JSON validation error.
 */
import { slugSchema } from '../shared/validation.js'
import { getBusinessBySlug, listWallByProject } from './repositories.js'
import { getClientById, getDefaultProject, getProjectBySlug } from './workspaces.js'

export function wallStats(testimonials) {
  const rated = testimonials.filter((row) => Number.isFinite(row.rating))
  const average =
    rated.length > 0 ? rated.reduce((sum, row) => sum + row.rating, 0) / rated.length : 0
  return {
    count: testimonials.length,
    averageRating: Math.round(average * 10) / 10,
  }
}

/**
 * Resolve the same target as `/api/public/wall/:slug`: a project slug first,
 * then a legacy business slug backed by its default project.
 *
 * @returns {Promise<null | { slug: string, business: any, project: any, testimonials: any[], stats: { count: number, averageRating: number } }>}
 */
export async function findPublicWall(db, rawSlug) {
  const parsed = slugSchema.safeParse(rawSlug)
  if (!parsed.success) return null

  const slug = parsed.data
  let business = null
  let project = null

  const projectBySlug = await getProjectBySlug(db, slug)
  if (projectBySlug) {
    business = await getClientById(db, projectBySlug.clientId)
    project = projectBySlug
  } else {
    business = await getBusinessBySlug(db, slug)
    if (business) project = await getDefaultProject(db, business.id)
  }

  if (!business || !project) return null

  const testimonials = await listWallByProject(db, project.id)
  return { slug, business, project, testimonials, stats: wallStats(testimonials) }
}
