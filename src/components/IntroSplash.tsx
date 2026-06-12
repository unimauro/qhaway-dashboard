import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

/**
 * Presentación breve y evocadora en la portada. Se desvanece automáticamente a
 * los ~6 s (o al hacer clic en cerrar) y enlaza a la presentación completa en
 * Metodología. Solo se muestra una vez por sesión.
 */
export default function IntroSplash() {
  const [visible, setVisible] = useState(false)
  const [fading, setFading] = useState(false)

  useEffect(() => {
    if (sessionStorage.getItem('qhaway-intro-seen') === '1') return
    setVisible(true)
    const fade = setTimeout(() => setFading(true), 5600)
    const hide = setTimeout(() => {
      setVisible(false)
      sessionStorage.setItem('qhaway-intro-seen', '1')
    }, 6400)
    return () => {
      clearTimeout(fade)
      clearTimeout(hide)
    }
  }, [])

  if (!visible) return null

  const close = () => {
    setFading(true)
    sessionStorage.setItem('qhaway-intro-seen', '1')
    setTimeout(() => setVisible(false), 700)
  }

  return (
    <div
      className={`mb-5 rounded-2xl border border-brand-500/30 bg-gradient-to-br from-brand-500/10 via-transparent to-gold-400/10 px-5 py-5 relative transition-opacity duration-700 ${
        fading ? 'opacity-0' : 'opacity-100 animate-fade'
      }`}
      role="note"
    >
      <button
        onClick={close}
        aria-label="Cerrar presentación"
        className="absolute top-3 right-3 w-7 h-7 grid place-items-center rounded-lg text-ink-400 hover:bg-ink-100 dark:hover:bg-ink-800 transition"
      >
        ✕
      </button>
      <p className="text-lg sm:text-xl font-semibold text-ink-900 dark:text-ink-50 leading-snug max-w-3xl">
        <span className="text-brand-600 dark:text-brand-300">QHAWAY significa mirar.</span> La mirada larga
        de los pueblos que observan la montaña, el río y la chacra — y la que interroga al poder y pregunta{' '}
        <em>dónde están puestas las manos del Estado</em>.
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
  )
}
