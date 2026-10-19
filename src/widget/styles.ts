/**
 * Widget styles, injected inside each widget's Shadow DOM.
 *
 * Shadow DOM already stops host-page selectors from reaching the widget; the
 * only inherited properties that leak through are inherited ones, so font,
 * colour and background are set explicitly on the root. Everything the widget
 * renders stays prefixed with `rw-`, so nothing can collide with the host.
 */
import type { WidgetOptions, WidgetTheme } from './types'

const FONT_STACK =
  "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"

function themeVars(theme: WidgetTheme, accent: string): string {
  if (theme === 'dark') {
    return `
      --rw-bg: #111827;
      --rw-surface: #1b2231;
      --rw-text: #eef2f8;
      --rw-muted: #9aa7b9;
      --rw-border: #2c3648;
      --rw-accent: ${accent};
      --rw-star: #f59e0b;`
  }
  return `
      --rw-bg: transparent;
      --rw-surface: #ffffff;
      --rw-text: #17201b;
      --rw-muted: #5b6b62;
      --rw-border: #e3e7ef;
      --rw-accent: ${accent};
      --rw-star: #f59e0b;`
}

export function widgetCss(options: WidgetOptions): string {
  return `
:host { display: block; }
.rw-root {
  ${themeVars(options.theme, options.accent)}
  font-family: ${FONT_STACK};
  color: var(--rw-text);
  font-size: 15px;
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
}
.rw-root *, .rw-root *::before, .rw-root *::after { box-sizing: border-box; }

/* ---------------------------------------------------------------- cards */
.rw-card {
  background: var(--rw-surface);
  border: 1px solid var(--rw-border);
  border-radius: 12px;
  padding: 18px;
  margin: 0;
}
.rw-stars { color: var(--rw-star); letter-spacing: 2px; font-size: 0.95em; }
.rw-text { margin: 10px 0 0; }
.rw-meta { display: flex; gap: 10px; align-items: center; margin-top: 14px; }
.rw-avatar {
  width: 34px; height: 34px; border-radius: 999px; flex: none;
  display: grid; place-items: center;
  background: color-mix(in srgb, var(--rw-accent) 12%, #ffffff);
  color: var(--rw-accent); font-weight: 700; font-size: 0.8em;
}
.rw-who { display: grid; }
.rw-who strong { font-size: 0.92em; }
.rw-who span { color: var(--rw-muted); font-size: 0.85em; }

/* ---------------------------------------------------------------- grid */
.rw-grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); }

/* ---------------------------------------------------------------- compact */
.rw-compact { display: grid; gap: 10px; }
.rw-compact-item {
  border-left: 3px solid var(--rw-accent);
  padding: 4px 0 4px 14px;
}
.rw-compact-item .rw-text { margin-top: 4px; font-size: 0.95em; }
.rw-compact-item .rw-meta { margin-top: 6px; }

/* ---------------------------------------------------------------- single */
.rw-single .rw-card { padding: 26px; }
.rw-single .rw-text { font-size: 1.1em; }

/* ---------------------------------------------------------------- carousel */
.rw-carousel { position: relative; }
.rw-carousel-viewport { overflow: hidden; border-radius: 12px; }
.rw-carousel-track { display: flex; transition: transform 0.35s ease; }
.rw-carousel-slide { flex: 0 0 100%; padding: 2px; }
.rw-carousel-controls { display: flex; align-items: center; justify-content: center; gap: 12px; margin-top: 12px; }
.rw-carousel-btn {
  border: 1px solid var(--rw-border);
  background: var(--rw-surface);
  color: var(--rw-text);
  border-radius: 999px;
  width: 36px; height: 36px;
  display: grid; place-items: center;
  cursor: pointer;
  font-size: 1rem;
  padding: 0;
}
.rw-carousel-btn:hover { border-color: var(--rw-accent); color: var(--rw-accent); }
.rw-carousel-btn:focus-visible { outline: 2px solid var(--rw-accent); outline-offset: 2px; }
.rw-carousel-dots { display: flex; gap: 6px; }
.rw-dot {
  width: 8px; height: 8px; border-radius: 999px;
  border: none; padding: 0; cursor: pointer;
  background: var(--rw-border);
}
.rw-dot[aria-current="true"] { background: var(--rw-accent); }

/* ---------------------------------------------------------------- small screens */
@media (max-width: 520px) {
  .rw-grid { grid-template-columns: 1fr; }
}

@media (prefers-reduced-motion: reduce) {
  .rw-carousel-track { transition: none; }
}

/* ---------------------------------------------------------------- attribution */
.rw-powered {
  margin-top: 12px;
  font-size: 0.72em;
  color: var(--rw-muted);
  text-align: right;
}
.rw-powered a { color: var(--rw-muted); text-decoration: none; }
`
}
