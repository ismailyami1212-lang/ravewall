/**
 * Transactional email for RaveWall.
 *
 * Three states, decided entirely by environment variables:
 *
 * 1. **development** — no `RESEND_API_KEY`. Messages are logged and optionally
 *    appended to `DEV_EMAIL_LOG`; nothing leaves the machine.
 * 2. **test sender** — a key plus `EMAIL_FROM` on Resend's shared test domain
 *    (`onboarding@resend.dev`). Resend only delivers such mail to the Resend
 *    account owner's own address, so this is for technical verification only.
 *    Setting `EMAIL_TEST_RECIPIENT` adds a local guard that skips every other
 *    recipient, so a test key can never email a real customer.
 * 3. **verified domain** — a key plus `EMAIL_FROM` on a domain verified in
 *    Resend. This is the only state suitable for real users.
 *
 * A transport failure never breaks the password-reset route: the caller treats
 * a failed send the same as an unknown account (the response is identical
 * either way, so the API cannot be used to enumerate accounts).
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const RESEND_ENDPOINT = 'https://api.resend.com/emails'

/** Resend's shared test domain — deliverable only to the account owner. */
const TEST_SENDER_DOMAIN = '@resend.dev'

/** True when the configured sender is Resend's test sender. */
export function isTestSender(emailFrom) {
  return String(emailFrom ?? '').toLowerCase().includes(TEST_SENDER_DOMAIN)
}

/**
 * Describes the active email configuration for boot logs and tests.
 * Never includes the API key.
 * @param {{ resendApiKey?: string | null, emailFrom?: string, emailTestRecipient?: string | null }} config
 */
export function describeEmailMode({ resendApiKey, emailFrom, emailTestRecipient }) {
  if (!resendApiKey) return { mode: 'development', testSender: false, testRecipient: null }
  return {
    mode: isTestSender(emailFrom) ? 'test-sender' : 'verified-domain',
    testSender: isTestSender(emailFrom),
    testRecipient: emailTestRecipient ?? null,
  }
}

/**
 * @param {{ to: string, subject: string, html: string, text: string }} message
 * @param {{
 *   resendApiKey: string | null,
 *   emailFrom: string,
 *   emailTestRecipient?: string | null,
 *   logger?: Console,
 * }} deps
 * @returns {Promise<{
 *   delivered: boolean,
 *   transport: 'resend' | 'development',
 *   skipped?: boolean,
 *   detail?: string,
 * }>}
 */
export async function sendEmail(
  message,
  { resendApiKey, emailFrom, emailTestRecipient = null, logger = console },
) {
  if (resendApiKey) {
    // Test-recipient guard: with a shared test sender, only the configured
    // address may receive mail. Other recipients are skipped locally instead
    // of being attempted (and rejected) at the provider — and a reset link is
    // never redirected into someone else's inbox.
    if (emailTestRecipient && message.to.trim().toLowerCase() !== emailTestRecipient) {
      logger.warn('[kudos] email skipped: test recipient configured', {
        recipientDomain: message.to.split('@')[1] ?? 'unknown',
      })
      return {
        delivered: false,
        transport: 'resend',
        skipped: true,
        detail: 'test-recipient guard',
      }
    }

    try {
      const response = await fetch(RESEND_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: emailFrom,
          to: [message.to],
          subject: message.subject,
          html: message.html,
          text: message.text,
        }),
      })
      if (!response.ok) {
        // The API key must never appear in a log line.
        logger.error('[kudos] email delivery failed', { status: response.status })
        return { delivered: false, transport: 'resend', detail: `status ${response.status}` }
      }
      return { delivered: true, transport: 'resend' }
    } catch (error) {
      logger.error('[kudos] email delivery failed', { message: error.message })
      return { delivered: false, transport: 'resend', detail: error.message }
    }
  }

  // Development transport: log it, and optionally append to a JSONL file so
  // tests and local QA can read the reset URL without an email inbox.
  logger.log(`[email:dev] to=${message.to} subject="${message.subject}"`)
  const logPath = process.env.DEV_EMAIL_LOG
  if (logPath) {
    try {
      const record = JSON.stringify({
        at: new Date().toISOString(),
        to: message.to,
        subject: message.subject,
        text: message.text,
      })
      await fs.promises.appendFile(path.resolve(logPath), `${record}\n`, 'utf8')
    } catch (error) {
      logger.warn('[kudos] could not append to DEV_EMAIL_LOG', { message: error.message })
    }
  }
  return { delivered: true, transport: 'development' }
}

/** Renders the password-reset email: HTML + plain-text fallback, no marketing. */
export function renderResetEmail(resetUrl, ttlMinutes) {
  const text = [
    'Reset your RaveWall password',
    '',
    'We received a request to reset your RaveWall password.',
    `Open this link to choose a new password: ${resetUrl}`,
    '',
    `The link expires in ${ttlMinutes} minutes and can be used once.`,
    'If you did not request a password reset, you can safely ignore this email — your password stays the same.',
    '',
    '— RaveWall',
  ].join('\n')

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f7f8fc;font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#17201b;">
    <div style="max-width:480px;margin:0 auto;background:#ffffff;border:1px solid #e3e7ef;border-radius:12px;padding:28px;">
      <p style="margin:0 0 18px;font-weight:700;font-size:18px;">RaveWall</p>
      <h1 style="margin:0 0 12px;font-size:20px;">Reset your password</h1>
      <p style="margin:0 0 18px;color:#5b6b62;font-size:14px;line-height:1.55;">
        We received a request to reset your RaveWall password. Choose a new one with the button below.
      </p>
      <p style="margin:0 0 18px;">
        <a href="${resetUrl}" style="display:inline-block;background:#15803d;color:#ffffff;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:600;font-size:14px;">Choose a new password</a>
      </p>
      <p style="margin:0 0 8px;color:#5b6b62;font-size:13px;line-height:1.55;">
        Or paste this link into your browser:<br />
        <a href="${resetUrl}" style="color:#15803d;word-break:break-all;">${resetUrl}</a>
      </p>
      <p style="margin:16px 0 0;color:#98a2b3;font-size:12px;line-height:1.5;">
        This link expires in ${ttlMinutes} minutes and can be used once. If you did not request this,
        you can safely ignore this email.
      </p>
    </div>
  </body>
</html>`

  return { html, text }
}

/** Escapes user-provided values before they enter an HTML email template. */
function escapeHtml(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character],
  )
}

/** Header values cannot contain CR/LF, whatever a user typed into a name. */
function singleLine(value) {
  return String(value ?? '')
    .replace(/[\r\n]+/g, ' ')
    .trim()
}

/**
 * New-testimonial alert for workspace owners/admins/managers.
 *
 * @param {{
 *   recipientName?: string,
 *   workspaceName?: string,
 *   clientName: string,
 *   projectName?: string,
 *   testimonial: { name: string, company?: string, rating: number, text: string },
 *   answers?: Array<{ label: string, value: string }>,
 *   dashboardUrl?: string | null,
 * }} input
 */
export function renderNewTestimonialEmail({
  recipientName = '',
  workspaceName = '',
  clientName,
  projectName = '',
  testimonial,
  answers = [],
  dashboardUrl = null,
}) {
  const author = String(testimonial.name ?? 'A customer')
  const company = String(testimonial.company ?? '')
  const rating = Number(testimonial.rating) || 0
  const body = String(testimonial.text ?? '')
  const project = projectName && projectName !== clientName ? ` (${projectName})` : ''
  const subject = singleLine(`${clientName}: new ${rating}-star testimonial from ${author}`)

  const text = [
    `Hi ${recipientName || 'there'},`,
    '',
    `${author}${company ? ` (${company})` : ''} left a ${rating}-star testimonial for ${clientName}${project}.`,
    '',
    `"${body}"`,
  ]

  if (answers.length > 0) {
    text.push('', 'Their answers:')
    for (const answer of answers) text.push(`- ${answer.label}: ${answer.value}`)
  }

  text.push(
    '',
    dashboardUrl
      ? `Review it in your RaveWall workspace: ${dashboardUrl}`
      : 'Sign in to RaveWall to review it.',
    '',
    `Sent by RaveWall for ${workspaceName || clientName}.`,
  )

  const answersHtml =
    answers.length > 0
      ? `<div style="margin:18px 0;padding:14px 16px;background:#f7f8fc;border-radius:8px;">
          <p style="margin:0 0 8px;font-weight:600;font-size:13px;">Their answers</p>
          <ul style="margin:0;padding-left:18px;color:#5b6b62;font-size:13px;line-height:1.6;">
            ${answers
              .map(
                (answer) =>
                  `<li><strong>${escapeHtml(answer.label)}:</strong> ${escapeHtml(answer.value)}</li>`,
              )
              .join('')}
          </ul>
        </div>`
      : ''

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f7f8fc;font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#17201b;">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e3e7ef;border-radius:12px;padding:28px;">
      <p style="margin:0 0 18px;font-weight:700;font-size:18px;">RaveWall</p>
      <h1 style="margin:0 0 12px;font-size:20px;">New ${rating}-star testimonial</h1>
      <p style="margin:0 0 14px;color:#5b6b62;font-size:14px;line-height:1.55;">
        <strong>${escapeHtml(author)}</strong>${company ? ` (${escapeHtml(company)})` : ''}
        left a testimonial for <strong>${escapeHtml(clientName)}</strong>${escapeHtml(project)}.
      </p>
      <blockquote style="margin:0 0 16px;padding:14px 16px;border-left:3px solid #15803d;background:#f7f8fc;color:#33413a;font-size:14px;line-height:1.6;white-space:pre-wrap;">${escapeHtml(body)}</blockquote>
      ${answersHtml}
      ${
        dashboardUrl
          ? `<p style="margin:0 0 8px;">
              <a href="${escapeHtml(dashboardUrl)}" style="display:inline-block;background:#15803d;color:#ffffff;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:600;font-size:14px;">Review it in RaveWall</a>
            </p>`
          : ''
      }
      <p style="margin:16px 0 0;color:#98a2b3;font-size:12px;line-height:1.5;">
        Sent by RaveWall for ${escapeHtml(workspaceName || clientName)}.
      </p>
    </div>
  </body>
</html>`

  return { subject, html, text: text.join('\n') }
}

const ROLE_LABELS = {
  owner: 'Owner',
  admin: 'Admin',
  manager: 'Manager',
  viewer: 'Viewer',
}

/**
 * Invitation for a teammate who already has a RaveWall account and has just
 * been given access to a workspace.
 *
 * @param {{
 *   recipientName?: string,
 *   workspaceName: string,
 *   inviterName?: string,
 *   role: string,
 *   dashboardUrl?: string | null,
 * }} input
 */
export function renderTeamInviteEmail({
  recipientName = '',
  workspaceName,
  inviterName = '',
  role,
  dashboardUrl = null,
}) {
  const roleLabel = ROLE_LABELS[role] ?? role
  const inviter = singleLine(inviterName) || 'A workspace owner'
  const subject = singleLine(`${inviter} invited you to ${workspaceName} on RaveWall`)

  const text = [
    `Hi ${recipientName || 'there'},`,
    '',
    `${inviter} invited you to join ${workspaceName} on RaveWall as ${roleLabel}.`,
    'Your account already has access — sign in to start collecting and reviewing testimonials.',
    '',
    dashboardUrl ? `Open your workspace: ${dashboardUrl}` : 'Sign in to RaveWall to get started.',
    '',
    '— RaveWall',
  ]

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f7f8fc;font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#17201b;">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e3e7ef;border-radius:12px;padding:28px;">
      <p style="margin:0 0 18px;font-weight:700;font-size:18px;">RaveWall</p>
      <h1 style="margin:0 0 12px;font-size:20px;">You're invited to ${escapeHtml(workspaceName)}</h1>
      <p style="margin:0 0 14px;color:#5b6b62;font-size:14px;line-height:1.55;">
        ${escapeHtml(inviter)} invited you to join <strong>${escapeHtml(workspaceName)}</strong>
        on RaveWall as <strong>${escapeHtml(roleLabel)}</strong>.
      </p>
      <p style="margin:0 0 18px;color:#5b6b62;font-size:14px;line-height:1.55;">
        Your account already has access — sign in to start collecting and reviewing testimonials.
      </p>
      ${
        dashboardUrl
          ? `<p style="margin:0 0 8px;">
              <a href="${escapeHtml(dashboardUrl)}" style="display:inline-block;background:#15803d;color:#ffffff;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:600;font-size:14px;">Open your workspace</a>
            </p>`
          : ''
      }
      <p style="margin:16px 0 0;color:#98a2b3;font-size:12px;line-height:1.5;">
        If you were not expecting this invitation, you can ignore this email.
      </p>
    </div>
  </body>
</html>`

  return { subject, html, text: text.join('\n') }
}

/** Fallback location used only when DEV_EMAIL_LOG is not set. */
export const DEV_EMAIL_LOG_HINT = path.join(os.tmpdir(), 'ravewall-dev-emails.log')
