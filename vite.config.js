import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    '__BUILD_ID__': JSON.stringify(Math.random().toString(36).substring(2, 6).toUpperCase()) // 4-char unique build ID
  }
})
