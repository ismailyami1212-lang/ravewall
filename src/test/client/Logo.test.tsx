import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { Logo } from '../../client/components/Primitives'

function renderLogo(compact = false) {
  return render(
    <MemoryRouter>
      <Logo compact={compact} />
    </MemoryRouter>,
  )
}

describe('Logo', () => {
  it('renders the sprout mark and the RaveWall wordmark', () => {
    const { container } = renderLogo()
    // The lockup carries the accessible name; the artwork itself is hidden.
    expect(screen.getByRole('img', { name: 'RaveWall' })).toBeInTheDocument()

    const icon = container.querySelector('svg.logo-icon')
    const word = container.querySelector('svg.logo-word')
    expect(icon).not.toBeNull()
    expect(word).not.toBeNull()

    // The mark is one green path (three leaves traced together), never a bubble.
    const iconPaths = icon!.querySelectorAll('path')
    expect(iconPaths).toHaveLength(1)
    expect(iconPaths[0].getAttribute('fill')).toBe('#097441')
    expect(iconPaths[0].getAttribute('fill-rule')).toBe('evenodd')
    expect(icon!.querySelector('rect')).toBeNull()
    expect(iconPaths[0].getAttribute('d')).not.toContain('M16 6.6')

    // The wordmark follows the surrounding colour.
    expect(word!.querySelector('path')?.getAttribute('fill')).toBe('currentColor')
  })

  it('keeps the reference proportions', () => {
    const { container } = renderLogo()
    const icon = container.querySelector('svg.logo-icon')!
    const word = container.querySelector('svg.logo-word')!
    expect(icon.getAttribute('viewBox')).toBe('0 0 482 361')
    expect(word.getAttribute('viewBox')).toBe('0 0 1368 264')
  })

  it('hides the wordmark in compact mode', () => {
    const { container } = renderLogo(true)
    expect(container.querySelector('svg.logo-word')).toBeNull()
    expect(container.querySelector('svg.logo-icon')).not.toBeNull()
  })
})
