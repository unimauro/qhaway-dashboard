import { useState } from 'react'
import { API_BASE } from '../lib/data'
import { Card, CardHeader, HelpTip, Pill } from './ui'

const BASE = import.meta.env.BASE_URL

type Estado = 'idle' | 'enviando' | 'ok' | 'error'

// Buzón de contacto: el mensaje viaja a /api/contacto (FastAPI en el VPS), que lo
// envía por correo al observatorio vía el exim del servidor (qhaway@qhaway.org, con
// DKIM). Sin terceros, sin tracking.
export default function Buzon() {
  const [nombre, setNombre] = useState('')
  const [email, setEmail] = useState('')
  const [asunto, setAsunto] = useState('')
  const [mensaje, setMensaje] = useState('')
  const [website, setWebsite] = useState('') // honeypot: debe quedar vacío (humanos)
  const [estado, setEstado] = useState<Estado>('idle')
  const [detalle, setDetalle] = useState('')

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!nombre.trim() || !mensaje.trim() || !email.includes('@')) {
      setEstado('error')
      setDetalle('Completa tu nombre, un correo válido y el mensaje.')
      return
    }
    setEstado('enviando')
    setDetalle('')
    try {
      const res = await fetch(`${API_BASE}/api/contacto`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre, email, asunto, mensaje, website }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.detail || `No se pudo enviar (HTTP ${res.status}).`)
      }
      setEstado('ok')
      setNombre('')
      setEmail('')
      setAsunto('')
      setMensaje('')
    } catch (err) {
      setEstado('error')
      setDetalle(err instanceof Error ? err.message : 'No se pudo enviar el mensaje.')
    }
  }

  const inputCls =
    'w-full rounded-lg border border-ink-200 dark:border-ink-700 bg-white dark:bg-ink-900 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 transition'

  return (
    <Card id="buzon" className="overflow-hidden">
      <CardHeader
        title="✉️  Buzón de contacto"
        subtitle="¿Una consulta, una sugerencia, un dato o una colaboración? Escríbenos."
        help={
          <HelpTip>
            Tu mensaje llega directo al equipo del observatorio (FIEECS-UNI) por correo.
            No usamos servicios de terceros ni rastreamos tu información: el envío viaja por
            el propio servidor de QHAWAY. Responderemos al correo que indiques.
          </HelpTip>
        }
        right={<Pill tone="brand">directo al equipo</Pill>}
      />

      <div className="px-4 pb-4">
        <div className="grid lg:grid-cols-5 gap-5 items-stretch">
          {/* Panel invitación + contacto alterno */}
          <aside className="lg:col-span-2 rounded-2xl bg-gradient-to-br from-brand-500/10 via-brand-500/5 to-gold-400/10 border border-brand-500/15 p-5 flex flex-col">
            <img
              src={`${BASE}buzon.png`}
              alt=""
              aria-hidden
              className="w-44 sm:w-52 mx-auto drop-shadow-sm"
            />
            <p className="mt-3 text-sm font-semibold text-ink-800 dark:text-ink-100">
              Tu mirada también construye el observatorio.
            </p>
            <p className="mt-1 text-[13px] leading-relaxed text-ink-500 dark:text-ink-300">
              Cuéntanos qué encontraste, qué te gustaría ver, un dato para sumar o una idea de
              colaboración. Leemos cada mensaje.
            </p>
            <div className="mt-4 pt-4 border-t border-brand-500/15 space-y-2 text-[13px]">
              <a
                href="mailto:waitasumaq@gmail.com"
                className="flex items-center gap-2 text-ink-600 dark:text-ink-300 hover:text-brand-600 transition"
              >
                <span aria-hidden>✉️</span> waitasumaq@gmail.com
              </a>
              <a
                href="https://github.com/unimauro/qhaway-dashboard/issues"
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 text-ink-600 dark:text-ink-300 hover:text-brand-600 transition"
              >
                <span aria-hidden>🐙</span> Reportar un error en GitHub
              </a>
              <p className="flex items-center gap-2 text-ink-400 pt-1">
                <span aria-hidden>🔒</span> Sin login · sin rastreo · respuesta directa
              </p>
            </div>
          </aside>

          {/* Formulario */}
          <div className="lg:col-span-3">
            {estado === 'ok' ? (
              <div className="h-full grid place-items-center rounded-2xl bg-emerald-500/10 border border-emerald-500/30 p-6 text-center">
                <div>
                  <div className="text-4xl">🪶</div>
                  <p className="mt-2 font-semibold text-emerald-700 dark:text-emerald-300">
                    ¡Mensaje enviado!
                  </p>
                  <p className="mt-1 text-sm opacity-90 max-w-xs mx-auto">
                    Gracias por escribir al observatorio. Te responderemos al correo que dejaste.
                  </p>
                  <button
                    onClick={() => setEstado('idle')}
                    className="mt-4 text-sm font-medium text-brand-600 hover:underline"
                  >
                    Enviar otro mensaje
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={enviar} className="space-y-3">
                {/* Honeypot anti-bot: invisible para humanos, fuera del tab. Si se llena, el server descarta. */}
                <div aria-hidden className="absolute -left-[9999px] top-0 h-0 w-0 overflow-hidden">
                  <label htmlFor="bz-website">No llenar</label>
                  <input
                    id="bz-website"
                    type="text"
                    tabIndex={-1}
                    autoComplete="off"
                    value={website}
                    onChange={(e) => setWebsite(e.target.value)}
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium opacity-70 mb-1" htmlFor="bz-nombre">
                      Nombre *
                    </label>
                    <input
                      id="bz-nombre"
                      className={inputCls}
                      value={nombre}
                      onChange={(e) => setNombre(e.target.value)}
                      placeholder="Tu nombre"
                      maxLength={120}
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium opacity-70 mb-1" htmlFor="bz-email">
                      Correo *
                    </label>
                    <input
                      id="bz-email"
                      type="email"
                      className={inputCls}
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="tucorreo@ejemplo.com"
                      maxLength={160}
                      required
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium opacity-70 mb-1" htmlFor="bz-asunto">
                    Asunto
                  </label>
                  <input
                    id="bz-asunto"
                    className={inputCls}
                    value={asunto}
                    onChange={(e) => setAsunto(e.target.value)}
                    placeholder="¿Sobre qué nos escribes?"
                    maxLength={160}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium opacity-70 mb-1" htmlFor="bz-mensaje">
                    Mensaje *
                  </label>
                  <textarea
                    id="bz-mensaje"
                    className={`${inputCls} min-h-[120px] resize-y`}
                    value={mensaje}
                    onChange={(e) => setMensaje(e.target.value)}
                    placeholder="Cuéntanos tu consulta, sugerencia, hallazgo o propuesta de colaboración…"
                    maxLength={5000}
                    required
                  />
                </div>

                {estado === 'error' && (
                  <div className="rounded-lg bg-rose-500/10 border border-rose-500/30 p-3 text-sm text-rose-700 dark:text-rose-300">
                    {detalle || 'No se pudo enviar el mensaje. Intenta de nuevo en un momento.'}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={estado === 'enviando'}
                  className="inline-flex items-center gap-2 rounded-lg bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-60 disabled:cursor-not-allowed transition shadow-sm"
                >
                  {estado === 'enviando' ? (
                    <>
                      <span className="inline-block w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                      Enviando…
                    </>
                  ) : (
                    <>Enviar mensaje →</>
                  )}
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </Card>
  )
}
