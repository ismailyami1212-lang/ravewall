/**
 * Widget layouts.
 *
 * Each layout renders into a container already inside the widget's Shadow DOM.
 * All four are plain DOM construction — no framework, no innerHTML.
 */
import type { WidgetData, WidgetOptions } from './types'
import { createCard, el } from './card'

function applyCommon(container: HTMLElement, options: WidgetOptions): void {
  container.classList.add(`rw-layout-${options.layout}`)
  if (options.layout === 'compact') container.classList.add('rw-compact')
  if (options.layout === 'single') container.classList.add('rw-single')
}

function renderGrid(container: HTMLElement, data: WidgetData, options: WidgetOptions): void {
  const grid = el('div', 'rw-grid')
  for (const testimonial of data.testimonials) {
    grid.appendChild(createCard(testimonial, options))
  }
  container.appendChild(grid)
}

function renderCompact(container: HTMLElement, data: WidgetData, options: WidgetOptions): void {
  for (const testimonial of data.testimonials) {
    const item = el('div', 'rw-compact-item')
    if (options.showStars) {
      const stars = el('div', 'rw-stars', '★'.repeat(Math.max(0, Math.min(5, Math.round(testimonial.rating)))))
      stars.setAttribute('role', 'img')
      stars.setAttribute('aria-label', `${testimonial.rating} out of 5 stars`)
      item.appendChild(stars)
    }
    item.appendChild(el('p', 'rw-text', testimonial.text))
    const meta = el('div', 'rw-meta')
    const label = options.showCompany && testimonial.company
      ? `${testimonial.name}, ${testimonial.company}`
      : testimonial.name
    meta.appendChild(el('strong', undefined, label))
    item.appendChild(meta)
    container.appendChild(item)
  }
}

function renderSingle(container: HTMLElement, data: WidgetData, options: WidgetOptions): void {
  const first = data.testimonials[0]
  if (!first) return
  container.appendChild(createCard(first, options))
}

function renderCarousel(container: HTMLElement, data: WidgetData, options: WidgetOptions): void {
  const slider = el('div', 'rw-carousel')
  const viewport = el('div', 'rw-carousel-viewport')
  viewport.setAttribute('role', 'region')
  viewport.setAttribute('aria-label', 'Customer testimonials')
  viewport.tabIndex = 0

  const track = el('div', 'rw-carousel-track')
  for (const testimonial of data.testimonials) {
    const slide = el('div', 'rw-carousel-slide')
    slide.appendChild(createCard(testimonial, options))
    track.appendChild(slide)
  }
  viewport.appendChild(track)
  slider.appendChild(viewport)

  let index = 0
  const count = data.testimonials.length

  const dots = el('div', 'rw-carousel-dots')
  const dotButtons: HTMLButtonElement[] = []
  for (let i = 0; i < count; i += 1) {
    const dot = el('button', 'rw-dot')
    dot.type = 'button'
    dot.setAttribute('aria-label', `Show testimonial ${i + 1} of ${count}`)
    dot.setAttribute('aria-current', String(i === 0))
    dot.addEventListener('click', () => goTo(i))
    dots.appendChild(dot)
    dotButtons.push(dot)
  }

  const prev = el('button', 'rw-carousel-btn', '‹')
  prev.type = 'button'
  prev.setAttribute('aria-label', 'Previous testimonial')
  const next = el('button', 'rw-carousel-btn', '›')
  next.type = 'button'
  next.setAttribute('aria-label', 'Next testimonial')

  function goTo(nextIndex: number): void {
    if (count === 0) return
    index = (nextIndex + count) % count
    track.style.transform = `translateX(-${index * 100}%)`
    dotButtons.forEach((dot, i) => dot.setAttribute('aria-current', String(i === index)))
  }

  prev.addEventListener('click', () => goTo(index - 1))
  next.addEventListener('click', () => goTo(index + 1))
  viewport.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      goTo(index - 1)
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      goTo(index + 1)
    }
  })

  const controls = el('div', 'rw-carousel-controls')
  controls.append(prev, dots, next)
  slider.appendChild(controls)
  container.appendChild(slider)
}

const LAYOUTS: Record<WidgetOptions['layout'], (c: HTMLElement, d: WidgetData, o: WidgetOptions) => void> = {
  grid: renderGrid,
  carousel: renderCarousel,
  single: renderSingle,
  compact: renderCompact,
}

/** Renders the chosen layout into a container inside the shadow root. */
export function renderLayout(container: HTMLElement, data: WidgetData, options: WidgetOptions): void {
  applyCommon(container, options)
  LAYOUTS[options.layout](container, data, options)
}
