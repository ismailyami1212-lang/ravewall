import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The SPA is built to ./dist and served by the Express app in src/server.
// The embeddable widget bundle is built separately (vite.config.widget.ts) to
// dist/widget/ravewall-widget.js — a dependency-free classic script that must
// never share a chunk with the React SPA.
export default defineConfig({
  plugins: [react()],
  server: {
    // The publishing sandbox proxies through a host we do not control.
    host: '0.0.0.0',
    port: 5173,
    strictPort: false,
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2020',
  },
})
