import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Base path configurable:
//  - GitHub Pages (mirror): '/qhaway-dashboard/' (default)
//  - VPS / dominio propio qhaway.org: '/'  → build con `VITE_BASE=/ npm run build`
export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE || '/qhaway-dashboard/',
  build: {
    // El chunk más pesado es el de ECharts modular (~740 kB min / ~250 kB gzip, ver
    // src/components/Chart.tsx). Antes el límite era 1600 para silenciar el ECharts
    // completo (1,15 MB); 800 avisa si alguien vuelve a importar `echarts` entero.
    chunkSizeWarningLimit: 800,
  },
})
