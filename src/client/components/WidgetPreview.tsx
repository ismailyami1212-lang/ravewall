import { useEffect, useRef, useState } from 'react'
import { mountWidget } from '../../widget/mount'
import type { WidgetOptions } from '../../widget/types'

/**
 * Live widget preview for the dashboard.
 *
 * Deliberately renders through the very same `mountWidget` function the embed
 * script uses, so what the owner sees is exactly what their customers'
 * websites get — one rendering path, no preview drift.
 */
export function WidgetPreview({ slug, options }: { slug: string; options: WidgetOptions }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<'loading' | 'rendered' | 'empty'>('loading')

  const key = `${slug}|${options.layout}|${options.theme}|${options.accent}|${options.showStars}|${options.showCompany}|${options.max}`

  useEffect(() => {
    let cancelled = false
    const host = hostRef.current
    if (!host) return

    setState('loading')
    void mountWidget(host, options).then((result) => {
      if (cancelled) return
      setState(result.rendered ? 'rendered' : 'empty')
    })

    return () => {
      cancelled = true
    }
    // `key` captures every option dependency explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return (
    <div className="widget-preview">
      <div className="widget-preview-frame" ref={hostRef} />
      {state === 'empty' ? (
        <p className="muted widget-preview-empty">
          This widget will stay hidden until you approve a testimonial — visitors never see an empty
          card.
        </p>
      ) : null}
      {state === 'loading' ? <p className="muted widget-preview-empty">Loading preview…</p> : null}
    </div>
  )
}
