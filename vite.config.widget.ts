import { defineConfig } from 'vite'

/**
 * Standalone build for the embeddable widget.
 *
 * Library mode with `iife` output keeps the widget a SINGLE self-contained
 * classic script (`dist/widget/ravewall-widget.js`) — no imports, no module
 * syntax, no shared chunks with the SPA. Host sites load it with one script
 * tag and it must never depend on the React bundle.
 */
export default defineConfig({
  // Public assets are copied by the SPA build; the widget output dir needs
  // only the script itself.
  publicDir: false,
  build: {
    outDir: 'dist/widget',
    emptyOutDir: false,
    sourcemap: false,
    target: 'es2020',
    minify: 'esbuild',
    lib: {
      entry: 'src/widget/index.ts',
      name: 'RaveWallWidgetBundle',
      formats: ['iife'],
      fileName: () => 'ravewall-widget.js',
    },
  },
})
