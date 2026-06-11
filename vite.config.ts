import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Base path para GitHub Pages (https://unimauro.github.io/qhaway-dashboard/)
export default defineConfig({
  plugins: [react()],
  base: '/qhaway-dashboard/',
  build: {
    chunkSizeWarningLimit: 1600,
  },
})
