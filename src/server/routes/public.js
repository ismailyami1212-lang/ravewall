import { Router } from 'express'
import { testimonialSubmissionSchema, slugSchema } from '../../shared/validation.js'
import { fingerprint } from '../auth.js'
import { renderNewTestimonialEmail, sendEmail } from '../email.js'
import { badRequest, notFound, tooManyRequests } from '../errors.js'
import { asyncHandler, parse, send } from '../http.js'
import { rateLimit } from '../rateLimit.js'
import {
  countSubmissionsSince,
  createTestimonial,
  getBusinessBySlug,
  listProjectQuestions,
  listWallByProject,
  publicBusiness,
  wallTestimonial,
} from '../repositories.js'
import {
  getClientById,
  getDefaultProject,
  getProjectBySlug,
  listNotificationRecipients,
} from '../workspaces.js'
import { getPublicWidget } from '../widgets.js'

/** Upper bound on testimonials returned for an embedded widget. */
const WIDGET_LIMIT = 50

function wallStats(testimonials) {
  const rated = testimonials.filter((row) => Number.isFinite(row.rating))
  const average =
    rated.length > 0 ? rated.reduce((sum, row) => sum + row.rating, 0) / rated.length : 0
  return {
    count: testimonials.length,
    averageRating: Math.round(average * 10) / 10,
  }
}

/**
 * Unauthenticated endpoints: the collection form, the public wall and the
 * widget data feed.
 *
 * A slug resolves to a project first (new model) and falls back to a business
 * slug (legacy). Every client's default project reuses the client slug, so
 * /t/reda-studio and any new project slug resolve through the same path —
 * existing links and embeds keep working.
 *
 * @param {{ db: any, config: any, limiters: any }} deps
 */
export function createPublicRouter({ db, config, limiters, logger = console }) {
  const router = Router()

  /** Absolute in-app link. Never derived from the request Host header. */
  function appLink(path) {
    if (!config.appUrl) return null
    return `${String(config.appUrl).replace(/\/$/, '')}${path}`
  }

  /**
   * Alerts the workspace team after a testimonial is stored. Delivery failures
   * are deliberately swallowed: a visitor's submission must succeed even when
   * Resend is unavailable or no API key is configured.
   */
  async function notifyNewSubmission({ business, project, testimonial, answers, questions }) {
    try {
      const recipients = await listNotificationRecipients(db, project.workspaceId, business.id)
      if (recipients.length === 0) return

      const dashboardUrl = appLink(
        `/dashboard?clientId=${encodeURIComponent(business.id)}&projectId=${encodeURIComponent(project.id)}`,
      )
      const answerList = questions
        .filter((question) => answers[question.id])
        .map((question) => ({ label: question.label, value: answers[question.id] }))

      await Promise.allSettled(
        recipients.map(async (recipient) => {
          const message = renderNewTestimonialEmail({
            recipientName: recipient.name,
            workspaceName: recipient.workspaceName ?? '',
            clientName: business.name,
            projectName: project.name,
            testimonial,
            answers: answerList,
            dashboardUrl,
          })
          await sendEmail(
            { to: recipient.email, subject: message.subject, html: message.html, text: message.text },
            {
              resendApiKey: config.resendApiKey ?? null,
              emailFrom: config.emailFrom ?? 'RaveWall <onboarding@resend.dev>',
              emailTestRecipient: config.emailTestRecipient ?? null,
              logger,
            },
          )
        }),
      )
    } catch (error) {
      logger.error?.('[kudos] new testimonial notification failed', {
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  async function resolveTarget(req) {
    const slug = parse(slugSchema, req.params.slug)
    const project = await getProjectBySlug(db, slug)
    if (project) {
      const business = await getClientById(db, project.clientId)
      if (!business) throw notFound('That testimonial page does not exist.')
      return { business, project }
    }
    const business = await getBusinessBySlug(db, slug)
    if (!business) throw notFound('That testimonial page does not exist.')
    const fallback = await getDefaultProject(db, business.id)
    if (!fallback) throw notFound('That testimonial page does not exist.')
    return { business, project: fallback }
  }

  router.get(
    '/business/:slug',
    asyncHandler(async (req, res) => {
      const { business, project } = await resolveTarget(req)
      send(res, {
        business: publicBusiness(business),
        project: { id: project.id, name: project.name, slug: project.slug },
        questions: await listProjectQuestions(db, project.id),
      })
    }),
  )

  router.get(
    '/wall/:slug',
    asyncHandler(async (req, res) => {
      const { business, project } = await resolveTarget(req)
      const rows = await listWallByProject(db, project.id)
      send(res, {
        business: publicBusiness(business),
        project: { id: project.id, name: project.name, slug: project.slug },
        testimonials: rows.map(wallTestimonial),
        stats: wallStats(rows),
      })
    }),
  )

  /**
   * Widget data feed. Same approved-only projection as the wall, with optional
   * rating/tag narrowing for saved widget configurations. Safe to cache at the
   * edge: an approval on the dashboard is the only thing that changes it.
   *
   * `Access-Control-Allow-Origin: *` is required because the widget script
   * runs on a third-party host page: CORS applies to the document's origin,
   * not the script's. This is a public, credential-free GET.
   */
  router.get(
    '/widget/:slug',
    asyncHandler(async (req, res) => {
      const { business, project } = await resolveTarget(req)
      const minRating = Number.parseInt(String(req.query.minRating ?? ''), 10)
      const tagId = typeof req.query.tag === 'string' ? req.query.tag : null
      const rows = await listWallByProject(db, project.id, {
        limit: WIDGET_LIMIT,
        minRating: Number.isFinite(minRating) ? Math.min(5, Math.max(1, minRating)) : null,
        tagId,
      })
      res.set('Access-Control-Allow-Origin', '*')
      res.set('Cache-Control', 'public, max-age=60, s-maxage=600, stale-while-revalidate=86400')
      send(res, {
        business: publicBusiness(business),
        testimonials: rows.map(wallTestimonial),
        stats: wallStats(rows),
      })
    }),
  )

  /**
   * Saved-widget feed. An embed with `data-rw-widget="<publicId>"` resolves
   * here. The saved configuration drives layout, theme, accent, flags, limit,
   * rating floor and tag filter — so editing a widget updates every embed.
   *
   * Only `live` widgets are served. Draft and archived widgets 404, so an
   * unpublished widget can never leak onto a customer's site. The response
   * exposes only public testimonial fields, same as the wall.
   */
  router.get(
    '/widgets/:publicId',
    asyncHandler(async (req, res) => {
      const publicId = String(req.params.publicId ?? '').trim()
      if (!/^[a-f0-9]{8,40}$/i.test(publicId)) throw notFound('That widget does not exist.')
      const found = await getPublicWidget(db, publicId)
      if (!found || found.widget.status !== 'live') throw notFound('That widget does not exist.')
      const business = await getClientById(db, found.clientId)
      if (!business) throw notFound('That widget does not exist.')

      const { widget, project } = found
      const rows = await listWallByProject(db, project.id, {
        limit: Math.min(WIDGET_LIMIT, widget.max),
        minRating: widget.minRating,
        tagId: widget.tagId,
      })
      res.set('Access-Control-Allow-Origin', '*')
      res.set('Cache-Control', 'public, max-age=60, s-maxage=600, stale-while-revalidate=86400')
      send(res, {
        business: publicBusiness(business),
        widget: {
          layout: widget.layout,
          theme: widget.theme,
          accent: widget.accent,
          showStars: widget.showStars,
          showCompany: widget.showCompany,
          max: widget.max,
        },
        testimonials: rows.map(wallTestimonial),
        stats: wallStats(rows),
      })
    }),
  )

  router.post(
    '/submit/:slug',
    rateLimit({
      limiter: limiters.submit,
      bucket: 'submit',
      message: 'You have sent several testimonials already. Please try again later.',
    }),
    asyncHandler(async (req, res) => {
      const { business, project } = await resolveTarget(req)
      const input = parse(testimonialSubmissionSchema, req.body)

      // Honeypot: a field hidden from humans. Bots fill it in; answer with a
      // normal-looking success so they do not learn to skip it, but store nothing.
      if (input.website) {
        send(res, { accepted: true, status: 'pending' }, 201)
        return
      }

      // Per-business ceiling so a single link cannot be flooded even from many IPs.
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
      if ((await countSubmissionsSince(db, business.id, since)) >= config.submissionDailyQuota) {
        throw tooManyRequests(
          'This testimonial page is receiving a lot of submissions right now. Please try again later.',
        )
      }

      // Custom answers: keep only known question ids, enforce required ones.
      const questions = await listProjectQuestions(db, project.id)
      const submitted = input.answers && typeof input.answers === 'object' ? input.answers : {}
      const answers = {}
      for (const question of questions) {
        const raw = submitted[question.id]
        const value = raw === undefined || raw === null ? '' : String(raw).trim().slice(0, 500)
        if (question.required && value === '') {
          throw badRequest('Please answer every required question.', {
            answers: 'Please answer every required question.',
          })
        }
        if (value !== '') answers[question.id] = value
      }

      const testimonial = await createTestimonial(
        db,
        business,
        {
          rating: input.rating,
          name: input.name,
          company: input.company,
          text: input.text,
        },
        {
          ipHash: fingerprint(req.ip, config.sessionSecret),
          userAgent: req.get('user-agent'),
          projectId: project.id,
          answers,
        },
      )

      await notifyNewSubmission({ business, project, testimonial, answers, questions })

      send(res, { accepted: true, status: testimonial.status }, 201)
    }),
  )

  return router
}
