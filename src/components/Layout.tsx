import { NavLink, Outlet } from 'react-router-dom'
import { useState } from 'react'
import { useTheme } from '../lib/theme'
import AskBot from './AskBot'
import CommandSearch from './CommandSearch'

const openSearch = () => window.dispatchEvent(new Event('qhaway:open-search'))

const BASE = import.meta.env.BASE_URL // '/' en qhaway.org, '/qhaway-dashboard/' en Pages

// Logo institucional FIEECS-UNI: versión color (granate) en modo claro, blanca en oscuro.
function FieecsLogo({ className = 'h-9' }: { className?: string }) {
  return (
    <a href="https://fieecs.uni.edu.pe" target="_blank" rel="noreferrer" aria-label="Facultad de Ingeniería Económica, Estadística y Ciencias Sociales — UNI">
      <img src={`${BASE}fieecs-color.png`} alt="FIEECS — UNI" className={`${className} w-auto block dark:hidden`} />
      <img src={`${BASE}fieecs-blanco.png`} alt="FIEECS — UNI" className={`${className} w-auto hidden dark:block`} />
    </a>
  )
}

const NAV = [
  { to: '/', label: 'Inicio', icon: '◉', end: true },
  { to: '/presupuesto', label: 'Presupuesto Público', icon: '▦' },
  { to: '/pisos', label: 'Pisos Altitudinales', icon: '⛰' },
  { to: '/clima', label: 'Cambio Climático', icon: '🌡' },
  { to: '/riesgos', label: 'Riesgos Territoriales', icon: '◬' },
  { to: '/prosperidad', label: 'Prosperidad (IPT)', icon: '★' },
  { to: '/explorador', label: 'Explorador Multidimensional', icon: '🔍' },
  { to: '/cubo', label: 'Cubo Presupuestal (OLAP)', icon: '🧊' },
  { to: '/historico', label: 'Evolución Regional 2004-2026', icon: '⏱' },
  { to: '/cobertura', label: 'Cobertura Territorial', icon: '◷' },
  { to: '/metodologia', label: 'Metodología y FAQ', icon: '?' },
]

function Logo() {
  return (
    <svg viewBox="0 0 512 512" className="w-8 h-8 shrink-0" aria-hidden>
      <path d="M64 256 C140 150 372 150 448 256 C372 362 140 362 64 256 Z" fill="none" stroke="#5eead4" strokeWidth="26" strokeLinejoin="round" />
      <path d="M256 156 L356 256 L256 356 L156 256 Z" fill="#fbbf24" />
      <path d="M256 196 L316 256 L256 316 L196 256 Z" fill="#0f172a" />
      <circle cx="256" cy="256" r="26" fill="#5eead4" />
    </svg>
  )
}

export default function Layout() {
  const { theme, toggle } = useTheme()
  const [open, setOpen] = useState(false)

  return (
    <div className="min-h-screen bg-ink-50 dark:bg-ink-950 text-ink-900 dark:text-ink-50">
      {/* Topbar móvil */}
      <header className="lg:hidden sticky top-0 z-40 flex items-center justify-between px-4 h-14 border-b border-ink-200 dark:border-ink-800 bg-white/80 dark:bg-ink-900/80 backdrop-blur">
        <div className="flex items-center gap-2"><Logo /><span className="font-bold">QHAWAY</span></div>
        <div className="flex items-center gap-2">
          <button onClick={openSearch} aria-label="Buscar" className="w-9 h-9 grid place-items-center rounded-lg border border-ink-200 dark:border-ink-800">⌕</button>
          <ThemeBtn theme={theme} toggle={toggle} />
          <button onClick={() => setOpen((o) => !o)} aria-label="Menú" className="w-9 h-9 grid place-items-center rounded-lg border border-ink-200 dark:border-ink-800">☰</button>
        </div>
      </header>

      <div className="lg:flex">
        {/* Sidebar */}
        <aside className={`${open ? 'block' : 'hidden'} lg:block lg:w-64 lg:shrink-0 lg:h-screen lg:sticky lg:top-0 border-r border-ink-200 dark:border-ink-800 bg-white dark:bg-ink-900 p-4`}>
          <div className="hidden lg:flex items-center gap-2 mb-1">
            <Logo />
            <div>
              <p className="font-extrabold leading-none tracking-tight">QHAWAY <span className="text-brand-500">2.0</span></p>
              <p className="text-[10px] text-ink-400 leading-tight mt-0.5">Observatorio Territorial del Perú</p>
            </div>
          </div>
          <button
            onClick={openSearch}
            className="mt-3 w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-ink-500 dark:text-ink-400 border border-ink-200 dark:border-ink-800 hover:border-brand-500 hover:text-brand-600 transition"
          >
            <span aria-hidden>⌕</span>
            <span className="flex-1 text-left">Buscar distrito, región…</span>
            <kbd className="text-[10px] px-1.5 py-0.5 rounded bg-ink-100 dark:bg-ink-800">Ctrl K</kbd>
          </button>
          <nav className="mt-3 space-y-1">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                onClick={() => setOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium transition ${
                    isActive
                      ? 'bg-brand-500/15 text-brand-700 dark:text-brand-300'
                      : 'text-ink-600 dark:text-ink-400 hover:bg-ink-100 dark:hover:bg-ink-800'
                  }`
                }
              >
                <span className="w-5 text-center opacity-80">{n.icon}</span>
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="hidden lg:flex items-center justify-between mt-6 pt-4 border-t border-ink-200 dark:border-ink-800">
            <ThemeBtn theme={theme} toggle={toggle} />
            <a href="https://github.com/unimauro/qhaway-dashboard" target="_blank" rel="noreferrer" className="text-xs text-ink-400 hover:text-brand-500">GitHub ↗</a>
          </div>
          <div className="hidden lg:block mt-4 pt-4 border-t border-ink-200 dark:border-ink-800">
            <p className="text-[10px] uppercase tracking-wide text-ink-400 mb-2">Una iniciativa de</p>
            <FieecsLogo className="h-10" />
            <p className="text-[10px] text-ink-400 mt-2 leading-relaxed">Datos del SIAF-MEF (Datos Abiertos).</p>
          </div>
        </aside>

        {/* Main */}
        <main className="flex-1 min-w-0 p-4 lg:p-6 max-w-[1400px] mx-auto w-full">
          <Outlet />
          <footer className="mt-10 pt-6 border-t border-ink-200 dark:border-ink-800 text-xs text-ink-400 leading-relaxed">
            <div className="flex items-center gap-4 mb-4 pb-4 border-b border-ink-200/60 dark:border-ink-800/60">
              <FieecsLogo className="h-12" />
              <span className="text-[11px] text-ink-500 dark:text-ink-400 max-w-md">
                Observatorio de la <strong>Facultad de Ingeniería Económica, Estadística y Ciencias Sociales</strong> · Universidad Nacional de Ingeniería (UNI).
              </span>
            </div>
            <p><strong>QHAWAY 2.0</strong> — Observatorio Nacional de Inteligencia Territorial, Presupuesto Público, Cambio Climático, Riesgos y Desarrollo Humano. Iniciativa de la FIEECS-UNI.</p>
            <p className="mt-1">Fuente principal: <a className="text-brand-500" href="https://datosabiertos.mef.gob.pe/dataset/presupuesto-y-ejecucion-de-gasto" target="_blank" rel="noreferrer">MEF — Datos Abiertos (SIAF)</a>. Datos abiertos bajo licencia CC BY 4.0. Las cifras pueden diferir de Consulta Amigable por fecha de corte y nivel de agregación.</p>
            <p className="mt-1"><strong>API pública</strong> (datos abiertos, reutilizables): <a className="text-brand-500" href="https://qhaway.tunky.net/docs" target="_blank" rel="noreferrer">documentación interactiva (Swagger)</a> · <a className="text-brand-500" href="https://qhaway.tunky.net/redoc" target="_blank" rel="noreferrer">ReDoc</a>.</p>
            <p className="mt-3 pt-3 border-t border-ink-200/60 dark:border-ink-800/60">
              Desarrollado por <strong className="text-ink-600 dark:text-ink-300">Carlos Mauro Cárdenas Fernández</strong> — Ingeniero de Sistemas (UNI) · MBA · Ciencia de datos e IA
              {' · '}<a className="text-brand-500 hover:underline" href="https://unimauro.github.io/" target="_blank" rel="noreferrer">Portafolio</a>
              {' · '}<a className="text-brand-500 hover:underline" href="https://github.com/unimauro" target="_blank" rel="noreferrer">GitHub</a>
              {' · '}<a className="text-brand-500 hover:underline" href="https://www.linkedin.com/in/carloscardenasf/" target="_blank" rel="noreferrer">LinkedIn</a>
              {' · '}<a className="text-brand-500 hover:underline" href="mailto:carlos@cardenas.pe">carlos@cardenas.pe</a>
            </p>
          </footer>
        </main>
      </div>

      {/* Buscador global (Ctrl/Cmd+K) y asistente IA flotante */}
      <CommandSearch />
      <AskBot />
    </div>
  )
}

function ThemeBtn({ theme, toggle }: { theme: string; toggle: () => void }) {
  return (
    <button onClick={toggle} aria-label="Cambiar tema" className="w-9 h-9 grid place-items-center rounded-lg border border-ink-200 dark:border-ink-800 hover:bg-ink-100 dark:hover:bg-ink-800 transition">
      {theme === 'dark' ? '☀' : '☾'}
    </button>
  )
}
