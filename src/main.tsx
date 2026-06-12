import { StrictMode, lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { createHashRouter, RouterProvider, useRouteError } from 'react-router-dom'
import './index.css'
import { ThemeProvider } from './lib/theme'
import Layout from './components/Layout'
import { Loading } from './components/ui'

// Tras un redeploy, una pestaña abierta con el build anterior pide chunks con hash
// que ya no existen → "Failed to fetch dynamically imported module". Recargamos una
// sola vez (guard en sessionStorage) para tomar el index.html nuevo.
function reloadOnceForStaleChunk() {
  if (sessionStorage.getItem('qhaway:reloaded') === '1') return
  sessionStorage.setItem('qhaway:reloaded', '1')
  window.location.reload()
}
window.addEventListener('vite:preloadError', (e) => {
  e.preventDefault()
  reloadOnceForStaleChunk()
})

function RouteError() {
  const err = useRouteError() as Error | undefined
  const msg = String(err?.message ?? err ?? '')
  // Si es un chunk obsoleto, intenta recargar a la versión nueva.
  if (/dynamically imported module|Importing a module script failed|Failed to fetch/i.test(msg)) {
    reloadOnceForStaleChunk()
  }
  return (
    <div className="min-h-screen grid place-items-center p-8 text-center">
      <div className="max-w-md">
        <p className="text-4xl mb-3">🔄</p>
        <h1 className="text-lg font-bold mb-2">Actualizando QHAWAY…</h1>
        <p className="text-sm text-ink-500 dark:text-ink-400 mb-4">
          Hay una versión nueva del panel. Si no se recarga sola, refresca la página.
        </p>
        <button
          onClick={() => { sessionStorage.removeItem('qhaway:reloaded'); window.location.reload() }}
          className="px-4 py-2 rounded-lg bg-brand-500 text-white text-sm font-semibold"
        >
          Recargar ahora
        </button>
      </div>
    </div>
  )
}

// Code-splitting por ruta: cada módulo (con sus charts/mapa) es un chunk aparte.
const Home = lazy(() => import('./pages/Home'))
const Presupuesto = lazy(() => import('./pages/Presupuesto'))
const Pisos = lazy(() => import('./pages/Pisos'))
const Riesgos = lazy(() => import('./pages/Riesgos'))
const Prosperidad = lazy(() => import('./pages/Prosperidad'))
const Explorador = lazy(() => import('./pages/Explorador'))
const Clima = lazy(() => import('./pages/Clima'))
const Cubo = lazy(() => import('./pages/Cubo'))
const Cobertura = lazy(() => import('./pages/Cobertura'))
const Historico = lazy(() => import('./pages/Historico'))
const Metodologia = lazy(() => import('./pages/Metodologia'))

const page = (el: React.ReactNode) => <Suspense fallback={<Loading />}>{el}</Suspense>

// HashRouter: compatible con GitHub Pages (sin configuración de servidor) y URLs compartibles.
const router = createHashRouter([
  {
    path: '/',
    element: <Layout />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: page(<Home />) },
      { path: 'presupuesto', element: page(<Presupuesto />) },
      { path: 'pisos', element: page(<Pisos />) },
      { path: 'riesgos', element: page(<Riesgos />) },
      { path: 'prosperidad', element: page(<Prosperidad />) },
      { path: 'explorador', element: page(<Explorador />) },
      { path: 'clima', element: page(<Clima />) },
      { path: 'cubo', element: page(<Cubo />) },
      { path: 'cobertura', element: page(<Cobertura />) },
      { path: 'historico', element: page(<Historico />) },
      { path: 'metodologia', element: page(<Metodologia />) },
    ],
  },
])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <RouterProvider router={router} />
    </ThemeProvider>
  </StrictMode>,
)
