import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{js,jsx,ts,tsx}'],
    exclude: ['node_modules/**', 'dist/**'],
    restoreMocks: true,
    // Tests run against a real in-process PostgreSQL, which is slower than a
    // mocked data layer; the ceilings leave room without hiding a genuine hang.
    testTimeout: 30000,
    hookTimeout: 30000,
  },
})
