import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

/**
 * Presentación evocadora de la portada. NO desaparece: se muestra expandida, y tras
 * ~14 s se **colapsa con un desvanecimiento suave** al titular, quedando siempre
 * **re-expandible** (botón "Ver presentación / Ocultar"). El estado se recuerda por
 * sesión. La versión completa también vive en Metodología.
 */
export default function IntroSplash() {
  const [expanded, setExpanded] = useState<boolean>(
    () => sessionStorage.getItem('qhaway-intro-collapsed') !== '1',
  )

  // Auto-colapsa la primera vez tras un rato (más largo, como se pidió). No se va: queda el titular.
  useEffect(() => {
    if (!expanded || sessionStorage.getItem('qhaway-intro-collapsed') === '1') return
    const t = setTimeout(() => {
      setExpanded(false)
      sessionStorage.setItem('qhaway-intro-collapsed', '1')
    }, 14000)
    return () => clearTimeout(t)
  }, [expanded])

  const toggle = () => {
    setExpanded((e) => {
      const next = !e
      sessionStorage.setItem('qhaway-intro-collapsed', next ? '0' : '1')
      return next
    })
  }

  return (
    <div className="mb-5 rounded-2xl border border-brand-500/30 bg-gradient-to-br from-brand-500/10 via-transparent to-gold-400/10 px-5 py-4 relative">
      <div className="flex items-start justify-between gap-3">
        <p className="text-lg sm:text-xl font-semibold text-ink-900 dark:text-ink-50 leading-snug">
          <span className="text-brand-600 dark:text-brand-300">QHAWAY significa mirar.</span>
          {!expanded && (
            <span className="font-normal text-sm text-ink-400"> — una mirada larga al presupuesto del Perú.</span>
          )}
        </p>
        <button
          onClick={toggle}
          aria-expanded={expanded}
          aria-label={expanded ? 'Ocultar presentación' : 'Ver presentación'}
          className="shrink-0 inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-brand-600 dark:text-brand-300 hover:bg-ink-100 dark:hover:bg-ink-800 transition"
        >
          {expanded ? 'Ocultar' : 'Ver presentación'}
          <span className={`transition-transform duration-300 ${expanded ? 'rotate-180' : ''}`}>▾</span>
        </button>
      </div>

      {/* Cuerpo colapsable con desvanecimiento + deslizamiento suave (CSS grid trick) */}
      <div
        className={`grid transition-all duration-700 ease-in-out ${
          expanded ? 'grid-rows-[1fr] opacity-100 mt-2' : 'grid-rows-[0fr] opacity-0'
        }`}
      >
        <div className="overflow-hidden">
          <p className="text-base sm:text-lg text-ink-700 dark:text-ink-200 leading-snug max-w-3xl">
            La mirada larga de los pueblos que observan la montaña, la chacra, los ríos y el mar — y la que
            interroga al poder y pregunta <em>dónde están puestas las manos del Estado</em>.
          </p>
          <p className="text-sm text-ink-500 dark:text-ink-400 mt-2 max-w-3xl">
            El presupuesto no es solo una cifra: es una declaración política sobre aquello que una sociedad decide
            cuidar. QHAWAY sigue el rastro de los recursos del Estado en los territorios para ver cómo se traducen
            —o no— en bienestar, naturaleza, derechos y oportunidades.
          </p>
          <Link
            to="/metodologia"
            className="inline-flex items-center gap-1 text-sm font-medium text-brand-600 dark:text-brand-300 hover:text-gold-600 mt-3"
          >
            Leer la presentación completa →
          </Link>
        </div>
      </div>
    </div>
  )
}
