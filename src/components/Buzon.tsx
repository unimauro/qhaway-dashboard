import { useState } from 'react'
import { API_BASE } from '../lib/data'
import { Card, CardHeader, HelpTip, Pill } from './ui'

type Estado = 'idle' | 'enviando' | 'ok' | 'error'

// Buzón de contacto: el mensaje viaja a /api/contacto (FastAPI en el VPS), que lo
// envía por correo al observatorio vía el exim del servidor. Sin terceros, sin tracking.
export default function Buzon() {
  const [nombre, setNombre] = useState('')
  const [email, setEmail] = useState('')
  const [asunto, setAsunto] = useState('')
  const [mensaje, setMensaje] = useState('')
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
        body: JSON.stringify({ nombre, email, asunto, mensaje }),
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
    <Card id="buzon">
      <CardHeader
        title="Buzón de contacto"
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
      {estado === 'ok' ? (
        <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 p-4 text-sm">
          <p className="font-medium text-emerald-700 dark:text-emerald-300">¡Mensaje enviado! 🪶</p>
          <p className="mt-1 opacity-90">
            Gracias por escribir al observatorio. Te responderemos al correo que dejaste.
          </p>
          <button
            onClick={() => setEstado('idle')}
            className="mt-3 text-xs font-medium text-brand-600 hover:underline"
          >
            Enviar otro mensaje
          </button>
        </div>
      ) : (
        <form onSubmit={enviar} className="space-y-3">
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

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button
              type="submit"
              disabled={estado === 'enviando'}
              className="inline-flex items-center gap-2 rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-60 disabled:cursor-not-allowed transition"
            >
              {estado === 'enviando' ? 'Enviando…' : 'Enviar mensaje'}
            </button>
            <span className="text-xs opacity-60">
              También puedes escribir a{' '}
              <a className="text-brand-600 hover:underline" href="mailto:carlos@cardenas.pe">
                carlos@cardenas.pe
              </a>
            </span>
          </div>
        </form>
      )}
      </div>
    </Card>
  )
}
