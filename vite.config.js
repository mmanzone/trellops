import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

import { resolve } from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    '__BUILD_ID__': JSON.stringify(Math.random().toString(36).substring(2, 6).toUpperCase()) // 4-char unique build ID
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        help: resolve(import.meta.dirname, 'help.html'),
        privacy: resolve(import.meta.dirname, 'privacy.html'),
        pricing: resolve(import.meta.dirname, 'pricing.html'),
        tour: resolve(import.meta.dirname, 'tour.html'),
        releases: resolve(import.meta.dirname, 'releases.html'),
      }
    }
  }
})
