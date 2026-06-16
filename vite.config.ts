import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Base path configurable:
//  - GitHub Pages (mirror): '/qhaway-dashboard/' (default)
//  - VPS / dominio propio qhaway.org: '/'  → build con `VITE_BASE=/ npm run build`
export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE || '/qhaway-dashboard/',
  build: {
    chunkSizeWarningLimit: 1600,
  },
})
