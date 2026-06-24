import { useState, useEffect, useCallback } from 'react'
import { API_BASE } from '../lib/data'
import { Card, CardHeader, Loading } from '../components/ui'

const LS = 'qhaway:contactos-token'

interface Mensaje {
  id: number
  ts: string
  nombre: string
  email: string
  asunto: string
  mensaje: string
  ip: string
}

function descargarCSV(rows: Mensaje[]) {
  const head = ['id', 'fecha', 'nombre', 'email', 'asunto', 'mensaje', 'ip']
  const esc = (v: string) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const body = rows.map((r) =>
    [r.id, r.ts, r.nombre, r.email, r.asunto, r.mensaje, r.ip].map((c) => esc(String(c))).join(','),
  )
  const csv = '﻿' + [head.join(','), ...body].join('\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = 'qhaway-mensajes.csv'
  a.click()
  URL.revokeObjectURL(url)
}

// Pantalla PRIVADA: el "lugar" donde ver todos los mensajes recibidos por el buzón.
// Gateada por el mismo token de /api/contactos (se guarda en este navegador).
export default function Mensajes() {
  const [token, setToken] = useState(() => localStorage.getItem(LS) || '')
  const [input, setInput] = useState('')
  const [msgs, setMsgs] = useState<Mensaje[] | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const cargar = useCallback(async (t: string) => {
    if (!t) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${API_BASE}/api/contactos?limit=500`, {
        headers: { 'X-Contactos-Token': t },
      })
      if (res.status === 404) throw new Error('Token inválido o sin permiso.')
      if (!res.ok) throw new Error(`No se pudo cargar (HTTP ${res.status}).`)
      const data = (await res.json()) as Mensaje[]
      setMsgs(data)
      localStorage.setItem(LS, t)
      setToken(t)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al cargar')
      setMsgs(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (token) cargar(token)
  }, [token, cargar])

  const salir = () => {
    localStorage.removeItem(LS)
    setToken('')
    setMsgs(null)
    setInput('')
  }

  const inputCls =
    'w-full rounded-lg border border-ink-200 dark:border-ink-700 bg-white dark:bg-ink-900 px-3 py-2 text-sm outline-none focus:border-brand-500'

  // Pantalla de acceso (sin token válido aún)
  if (!token || error) {
    return (
      <div className="max-w-md mx-auto mt-10">
        <Card>
          <CardHeader title="🔒 Mensajes recibidos" subtitle="Acceso privado del equipo del observatorio" />
          <div className="px-4 pb-4 space-y-3">
            <p className="text-sm text-ink-500 dark:text-ink-400">
              Pega tu <strong>token de lectura</strong> para ver todos los mensajes enviados desde el
              buzón. Se guarda solo en este navegador.
            </p>
            <input
              className={inputCls}
              type="password"
              placeholder="Token de lectura"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && cargar(input.trim())}
            />
            {error && <p className="text-sm text-rose-600">{error}</p>}
            <button
              onClick={() => cargar(input.trim())}
              disabled={loading || !input.trim()}
              className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-60"
            >
              {loading ? 'Verificando…' : 'Entrar'}
            </button>
          </div>
        </Card>
      </div>
    )
  }

  if (loading && !msgs) return <Loading />

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="📥 Mensajes recibidos"
          subtitle={msgs ? `${msgs.length} mensaje(s) · del más nuevo al más antiguo` : undefined}
          right={
            <div className="flex items-center gap-2">
              <button
                onClick={() => cargar(token)}
                className="text-xs px-2.5 py-1 rounded-lg border border-ink-200 dark:border-ink-700 hover:border-brand-500"
              >
                ↻ Actualizar
              </button>
              {msgs && msgs.length > 0 && (
                <button
                  onClick={() => descargarCSV(msgs)}
                  className="text-xs px-2.5 py-1 rounded-lg border border-ink-200 dark:border-ink-700 hover:border-brand-500"
                >
                  ⬇ CSV
                </button>
              )}
              <button onClick={salir} className="text-xs px-2.5 py-1 rounded-lg text-ink-400 hover:text-rose-500">
                Salir
              </button>
            </div>
          }
        />
        <div className="px-2 pb-4">
          {msgs && msgs.length === 0 ? (
            <p className="px-2 text-sm text-ink-500">Aún no hay mensajes. Cuando alguien escriba por el buzón, aparecerán aquí.</p>
          ) : (
            <div className="space-y-3">
              {msgs?.map((m) => (
                <div
                  key={m.id}
                  className="rounded-xl border border-ink-200 dark:border-ink-800 p-3 bg-white dark:bg-ink-900/40"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
                    <div className="font-semibold text-sm">
                      {m.nombre}{' '}
                      <a href={`mailto:${m.email}`} className="font-normal text-brand-600 hover:underline">
                        &lt;{m.email}&gt;
                      </a>
                    </div>
                    <time className="text-[11px] text-ink-400">
                      {new Date(m.ts).toLocaleString('es-PE')}
                    </time>
                  </div>
                  {m.asunto && <div className="text-[13px] font-medium text-ink-700 dark:text-ink-200">{m.asunto}</div>}
                  <p className="mt-1 text-sm text-ink-600 dark:text-ink-300 whitespace-pre-line">{m.mensaje}</p>
                  <div className="mt-1 text-[10px] text-ink-400">IP: {m.ip}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>
    </div>
  )
}
