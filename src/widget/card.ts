/**
 * DOM helpers and the shared testimonial card.
 *
 * Every piece of user content is placed with `textContent` — never innerHTML —
 * so a testimonial containing markup renders as literal text and can never
 * execute in the widget or touch the host page.
 */
import type { WidgetOptions, WidgetTestimonial } from './types'

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

export function starsMarkup(rating: number): string {
  const rounded = Math.max(0, Math.min(5, Math.round(rating)))
  return '★'.repeat(rounded) + '☆'.repeat(5 - rounded)
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2)
  return parts.map((part) => part.charAt(0).toUpperCase()).join('') || '·'
}

/** One testimonial card: rating, quote, author, optional company. */
export function createCard(
  testimonial: WidgetTestimonial,
  options: WidgetOptions,
): HTMLElement {
  const card = el('article', 'rw-card')

  if (options.showStars) {
    const stars = el('div', 'rw-stars', starsMarkup(testimonial.rating))
    stars.setAttribute('aria-label', `${testimonial.rating} out of 5 stars`)
    stars.setAttribute('role', 'img')
    card.appendChild(stars)
  }

  card.appendChild(el('p', 'rw-text', testimonial.text))

  const meta = el('div', 'rw-meta')
  meta.appendChild(el('span', 'rw-avatar', initials(testimonial.name)))
  const who = el('div', 'rw-who')
  who.appendChild(el('strong', undefined, testimonial.name))
  if (options.showCompany && testimonial.company) {
    who.appendChild(el('span', undefined, testimonial.company))
  }
  meta.appendChild(who)
  card.appendChild(meta)

  return card
}
