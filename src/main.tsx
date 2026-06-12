import { StrictMode, lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { createHashRouter, RouterProvider } from 'react-router-dom'
import './index.css'
import { ThemeProvider } from './lib/theme'
import Layout from './components/Layout'
import { Loading } from './components/ui'

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
