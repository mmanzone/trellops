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
        main: resolve(__dirname, 'index.html'),
        help: resolve(__dirname, 'help.html'),
        privacy: resolve(__dirname, 'privacy.html'),
      }
    }
  }
})
