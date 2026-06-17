import { useState, useEffect, useRef, useCallback } from 'react'
import { Link } from 'react-router-dom'
import {
  getPorDepartamento,
  getPorFuncion,
  getPorSector,
  getGeoJSON,
  loadJSON,
  API_BASE,
} from '../lib/data'
import type {
  PorDepartamento,
  PorFuncion,
  PorSector,
  IndicadorDistrito,
} from '../lib/types'
import { clasificarPiso } from '../lib/pisos'
import { soles, solesCompact, pct, ejecucion } from '../lib/format'

// ────────────────────────────────────────────────────────────────────────────
// <AskBot/> — "Ninacha" 🔥, la asistente IA del observatorio QHAWAY.
// (nina = fuego en quechua: el fueguito que ilumina los números públicos)
// Motor HÍBRIDO y barato:
//   1) Reglas en el cliente para consultas estructuradas (depto/sector/función/
//      distrito/glosario) → responde consultando datos ya cargados. COSTO $0.
//   2) Solo si las reglas no entienden, deriva a la IA. Por defecto vía el VPS
//      (/api/ninacha → OpenRouter modelo gratuito, con la key OCULTA en el server);
//      o, si el usuario pega su propia key de Gemini, usa esa. Fallback siempre al
//      modo guiado. Nunca rompe si faltan datos.
// ────────────────────────────────────────────────────────────────────────────

const NINACHA_API = `${API_BASE}/api/ninacha`
const LS_KEY = 'qhaway-gemini-key'
const MAX_HISTORIAL = 40

type Rol = 'user' | 'bot'
interface Mensaje {
  id: number
  rol: Rol
  texto: string
  links?: { to: string; label: string }[]
  nota?: string // ej. "IA conectada" / "modo guiado"
}

// Quita tildes y normaliza a minúsculas para hacer match flexible.
function norm(s: string): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// Glosario de términos presupuestarios y del observatorio.
const GLOSARIO: Record<string, string> = {
  pia: 'PIA = Presupuesto Institucional de Apertura: el presupuesto aprobado al inicio del año fiscal.',
  pim: 'PIM = Presupuesto Institucional Modificado: el PIA más las modificaciones del año (créditos suplementarios, transferencias). Es el monto vigente disponible para gastar.',
  certificado:
    'Certificado: monto reservado formalmente para un gasto futuro; garantiza que existe crédito presupuestario.',
  devengado:
    'Devengado: obligación de pago ya reconocida tras recibir el bien o servicio. Es la medida más usada de ejecución real del gasto.',
  girado:
    'Girado: el pago efectivamente ordenado/emitido al proveedor o beneficiario. Va después del devengado.',
  ejecucion:
    'Ejecución = devengado ÷ PIM (en %). Indica qué parte del presupuesto vigente ya se gastó. Coloreamos: <50% rojo, 50–80% ámbar, >80% verde.',
  'ejecución':
    'Ejecución = devengado ÷ PIM (en %). Indica qué parte del presupuesto vigente ya se gastó.',
  ubigeo:
    'Ubigeo: código geográfico del INEI. 2 dígitos = departamento, 4 = provincia, 6 = distrito. Es la clave para unir mapa y presupuesto.',
  piso: 'Piso altitudinal: franja de altitud según Javier Pulgar Vidal (Chala, Yunga, Quechua, Suni, Puna, Janca + Selva Alta/Baja). Clasificamos por la altitud de la capital del distrito (aproximación).',
  'piso altitudinal':
    'Piso altitudinal: franja de altitud según Javier Pulgar Vidal (Chala, Yunga, Quechua, Suni, Puna, Janca + Selva Alta/Baja).',
  ipt: 'IPT = Índice de Prosperidad Territorial: indicador compuesto del observatorio (parcial/aproximado) que combina indicadores socioeconómicos distritales. Revisa su construcción en Metodología.',
  idh: 'IDH = Índice de Desarrollo Humano (PNUD): combina salud, educación e ingresos. Escala 0–100 en nuestros datos.',
}

const LINKS = {
  presupuesto: { to: '/presupuesto', label: 'Ver Presupuesto' },
  pisos: { to: '/pisos', label: 'Ver Pisos altitudinales' },
  riesgos: { to: '/riesgos', label: 'Ver Riesgos' },
  prosperidad: { to: '/prosperidad', label: 'Ver Prosperidad' },
  metodologia: { to: '/metodologia', label: 'Ver Metodología' },
}

const CHIPS = [
  '¿Cómo leo el mapa?',
  '¿Qué es PIM y devengado?',
  '¿Cuánto recibió mi región?',
  '¿Cuánto presupuesto va a la puna?',
  '¿Cómo se calcula el IPT?',
]

interface Datos {
  deptos: PorDepartamento[]
  funciones: PorFuncion[]
  sectores: PorSector[]
  indicadores: IndicadorDistrito[]
  // ubigeo6 -> { nombre, depto, deptoUbigeo2 }
  distritos: Map<string, { nombre: string; depto: string; dep2: string }>
  deptoNombres: Map<string, string> // dep2 -> nombre
}

let mensajeIdSeq = 1
function nextId() {
  return mensajeIdSeq++
}

export default function AskBot() {
  const [abierto, setAbierto] = useState(false)
  const [ajustes, setAjustes] = useState(false)
  const [input, setInput] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [keyDraft, setKeyDraft] = useState('')
  const [pensando, setPensando] = useState(false)
  const [datos, setDatos] = useState<Datos | null>(null)
  const [mensajes, setMensajes] = useState<Mensaje[]>([
    {
      id: nextId(),
      rol: 'bot',
      texto:
        '¡Hola! Soy Ninacha 🔥, tu asistente en QHAWAY. Te explico cómo leer el dashboard y busco cifras por departamento, sector, función o distrito. Escribe un nombre (ej. "Cusco") o usa los atajos de abajo.',
      nota: 'Ninacha',
    },
  ])

  const scrollRef = useRef<HTMLDivElement>(null)

  // Cargar API key persistida.
  useEffect(() => {
    try {
      const k = localStorage.getItem(LS_KEY) || ''
      setApiKey(k)
      setKeyDraft(k)
    } catch {
      /* localStorage no disponible — modo guiado */
    }
  }, [])

  // Cargar datos perezosamente al abrir por primera vez. Robusto ante ausencias.
  useEffect(() => {
    if (!abierto || datos) return
    let vivo = true
    ;(async () => {
      const [deptosR, funcR, sectR, indR, geoR] = await Promise.allSettled([
        getPorDepartamento(),
        getPorFuncion(2025),
        getPorSector(2025),
        loadJSON<IndicadorDistrito[]>('indicadores-distrito.json'),
        getGeoJSON(),
      ])
      if (!vivo) return

      const deptos = deptosR.status === 'fulfilled' ? deptosR.value || [] : []
      const funciones = funcR.status === 'fulfilled' ? funcR.value || [] : []
      const sectores = sectR.status === 'fulfilled' ? sectR.value || [] : []
      const indicadores = indR.status === 'fulfilled' ? indR.value || [] : []

      const distritos = new Map<string, { nombre: string; depto: string; dep2: string }>()
      const deptoNombres = new Map<string, string>()
      for (const d of deptos) {
        if (d.ubigeo && d.departamento) deptoNombres.set(d.ubigeo, d.departamento)
      }
      if (geoR.status === 'fulfilled' && geoR.value?.features) {
        for (const f of geoR.value.features) {
          const p = f?.properties
          if (!p?.IDDIST) continue
          const dep2 = String(p.IDDIST).slice(0, 2)
          distritos.set(String(p.IDDIST), {
            nombre: p.NOMBDIST || '',
            depto: p.NOMBDEP || deptoNombres.get(dep2) || '',
            dep2,
          })
          if (p.NOMBDEP && !deptoNombres.has(dep2)) deptoNombres.set(dep2, p.NOMBDEP)
        }
      }

      setDatos({ deptos, funciones, sectores, indicadores, distritos, deptoNombres })
    })()
    return () => {
      vivo = false
    }
  }, [abierto, datos])

  // Auto-scroll al fondo cuando hay nuevos mensajes.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [mensajes, pensando])

  const pushBot = useCallback((m: Omit<Mensaje, 'id' | 'rol'>) => {
    setMensajes((prev) =>
      [...prev, { id: nextId(), rol: 'bot' as Rol, ...m }].slice(-MAX_HISTORIAL),
    )
  }, [])

  // ── Lógica de respuesta en modo guiado ────────────────────────────────────
  const responderGuiado = useCallback(
    (consulta: string): Omit<Mensaje, 'id' | 'rol'> & { confident?: boolean } => {
      const q = norm(consulta)

      // 1) Chips / preguntas frecuentes (match por palabras clave).
      if (q.includes('mapa') || q.includes('como leo') || q.includes('leer el mapa')) {
        return {
          texto:
            'El mapa colorea cada distrito según el indicador elegido (PIM, ejecución, IDH…). Más intenso = valor más alto; pasa el cursor para ver el detalle y haz clic para fijar un distrito. El color NO compara entre indicadores distintos, solo dentro del mismo mapa.',
          links: [LINKS.presupuesto, LINKS.prosperidad],
        }
      }
      if (
        (q.includes('pim') && q.includes('devengado')) ||
        q.includes('que es pim') ||
        q.includes('pim y devengado')
      ) {
        return {
          texto: `${GLOSARIO.pim}\n\n${GLOSARIO.devengado}\n\n${GLOSARIO.ejecucion}`,
          links: [LINKS.presupuesto, LINKS.metodologia],
        }
      }
      if (q.includes('puna')) {
        return responderPiso('puna')
      }
      if (q.includes('ipt') || (q.includes('como se calcula') && q.includes('prosperidad'))) {
        return {
          texto: GLOSARIO.ipt,
          links: [LINKS.prosperidad, LINKS.metodologia],
        }
      }
      if (q.includes('mi region') || q.includes('mi región') || q.includes('cuanto recibio')) {
        return {
          texto:
            'Escríbeme el nombre de tu región o departamento (por ejemplo: "Cusco", "Loreto" o "Lima") y te diré su PIM, devengado y % de ejecución 2025.',
          links: [LINKS.presupuesto],
        }
      }

      // 2) Glosario directo.
      for (const term of Object.keys(GLOSARIO)) {
        // Coincidencia por palabra completa para evitar falsos positivos.
        const re = new RegExp(`(^|[^a-z])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`)
        if (re.test(q)) {
          const links: { to: string; label: string }[] = []
          if (term === 'piso' || term === 'piso altitudinal') links.push(LINKS.pisos)
          if (term === 'ipt' || term === 'idh') links.push(LINKS.prosperidad)
          links.push(LINKS.metodologia)
          return { texto: GLOSARIO[term], links }
        }
      }

      // 3) Lookup sobre datos: departamento, sector, función, distrito.
      if (datos) {
        const depto = buscarDepartamento(q, datos)
        if (depto) return depto
        const sec = buscarSector(q, datos)
        if (sec) return sec
        const fun = buscarFuncion(q, datos)
        if (fun) return fun
        const dist = buscarDistrito(q, datos)
        if (dist) return dist
      }

      // 4) No entendí con reglas → marca no-confiado para derivar a la IA.
      return {
        texto:
          'No estoy segura de haber entendido. Puedo explicar cómo leer el mapa, definir términos (PIM, devengado, ubigeo, IPT) o buscar cifras escribiendo un departamento, sector o distrito.',
        links: [LINKS.presupuesto, LINKS.prosperidad, LINKS.pisos, LINKS.metodologia],
        nota: 'Ninacha · modo guiado',
        confident: false,
      }
    },
    [datos],
  )

  // Respuesta para "puna" (o piso por nombre) usando indicadores + clasificarPiso.
  const responderPiso = useCallback(
    (pisoId: string): Omit<Mensaje, 'id' | 'rol'> => {
      if (!datos || !datos.indicadores.length) {
        return {
          texto:
            'La Puna es el piso altitudinal entre 4000 y 4800 msnm (altiplano frío). En el módulo de Pisos puedes ver cuánto presupuesto y población corresponde a cada franja altitudinal.',
          links: [LINKS.pisos, LINKS.presupuesto],
        }
      }
      let n = 0
      let pob = 0
      for (const ind of datos.indicadores) {
        const meta = datos.distritos.get(ind.ubigeo)
        const piso = clasificarPiso(ind.altitud, meta?.depto || '')
        if (piso && piso.id === pisoId) {
          n++
          pob += ind.pob || 0
        }
      }
      const nombre = pisoId === 'puna' ? 'la Puna (4000–4800 msnm)' : `el piso ${pisoId}`
      return {
        texto:
          `En ${nombre} clasificamos aproximadamente ${n} distritos (por la altitud de su capital), con una población cercana a ${pob.toLocaleString('es-PE')} habitantes. ` +
          'El detalle de presupuesto por piso (PIM y ejecución por franja altitudinal) está en el módulo de Pisos.',
        links: [LINKS.pisos, LINKS.presupuesto],
        nota: 'modo guiado',
      }
    },
    [datos],
  )

  // ── Envío ──────────────────────────────────────────────────────────────────
  const enviar = useCallback(
    async (textoRaw: string) => {
      const texto = textoRaw.trim()
      if (!texto || pensando) return
      setInput('')
      setMensajes((prev) =>
        [...prev, { id: nextId(), rol: 'user' as Rol, texto }].slice(-MAX_HISTORIAL),
      )

      // 1) Reglas primero (COSTO $0). Si responde con confianza, listo.
      const { confident, ...guiadoMsg } = responderGuiado(texto)
      if (confident !== false) {
        pushBot(guiadoMsg)
        return
      }

      // 2) Las reglas no entendieron → IA. Si el usuario puso su key de Gemini, la usa;
      //    si no, deriva a Ninacha en el VPS (OpenRouter gratis, key oculta). Fallback al modo guiado.
      setPensando(true)
      try {
        const respuesta = apiKey
          ? await preguntarGemini(texto, apiKey, datos)
          : await preguntarNinacha(texto, datos)
        pushBot({ texto: respuesta, nota: apiKey ? 'Ninacha · Gemini' : 'Ninacha · IA', links: linksSugeridos(texto) })
      } catch (e) {
        pushBot({
          ...guiadoMsg,
          nota: 'Ninacha · modo guiado',
          texto:
            (apiKey
              ? 'No pude conectar con la IA (' + (e instanceof Error ? e.message : 'error') + '). '
              : '') + guiadoMsg.texto,
        })
      } finally {
        setPensando(false)
      }
    },
    [apiKey, datos, pensando, pushBot, responderGuiado],
  )

  const guardarKey = useCallback(() => {
    const k = keyDraft.trim()
    try {
      if (k) localStorage.setItem(LS_KEY, k)
      else localStorage.removeItem(LS_KEY)
    } catch {
      /* ignore */
    }
    setApiKey(k)
    setAjustes(false)
    pushBot({
      texto: k
        ? 'IA conectada con Gemini. Tus preguntas libres ahora se responderán con IA (cita cifras y sugiere secciones). La clave se guarda solo en tu navegador.'
        : 'Clave eliminada. Vuelvo al modo guiado (capacidades limitadas, sin enviar nada a internet).',
      nota: k ? 'IA conectada' : 'modo guiado',
    })
  }, [keyDraft, pushBot])

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <>
      {/* Botón flotante */}
      {!abierto && (
        <button
          onClick={() => setAbierto(true)}
          aria-label="Abrir a Ninacha, asistente de QHAWAY"
          className="fixed bottom-4 right-4 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-brand-600 text-white shadow-lg shadow-brand-900/30 transition hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-300"
        >
          <ChatIcon className="h-6 w-6" />
        </button>
      )}

      {/* Panel */}
      {abierto && (
        <div className="fixed bottom-0 right-0 z-50 flex h-[85vh] max-h-[640px] w-full flex-col overflow-hidden border border-ink-200 bg-white shadow-2xl dark:border-ink-800 dark:bg-ink-900 sm:bottom-4 sm:right-4 sm:h-[70vh] sm:w-[360px] sm:rounded-2xl">
          {/* Header */}
          <div className="flex items-center gap-2 border-b border-ink-200 bg-brand-600 px-3 py-2.5 text-white dark:border-ink-800">
            <ChatIcon className="h-5 w-5 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold leading-tight">Ninacha 🔥</div>
              <div className="text-[11px] leading-tight text-brand-100">
                {apiKey ? 'IA · Gemini (tu key)' : 'Asistente IA de QHAWAY'}
              </div>
            </div>
            <button
              onClick={() => setAjustes((v) => !v)}
              aria-label="Ajustes"
              className="rounded p-1 text-brand-100 transition hover:bg-white/15 hover:text-white"
            >
              <GearIcon className="h-5 w-5" />
            </button>
            <button
              onClick={() => setAbierto(false)}
              aria-label="Cerrar asistente"
              className="rounded p-1 text-brand-100 transition hover:bg-white/15 hover:text-white"
            >
              <XIcon className="h-5 w-5" />
            </button>
          </div>

          {/* Panel de ajustes (API key) */}
          {ajustes && (
            <div className="border-b border-ink-200 bg-ink-50 px-3 py-3 text-xs dark:border-ink-800 dark:bg-ink-950">
              <label className="mb-1 block font-medium text-ink-800 dark:text-ink-200">
                API key de Google Gemini (opcional)
              </label>
              <input
                type="password"
                value={keyDraft}
                onChange={(e) => setKeyDraft(e.target.value)}
                placeholder="Pega tu clave para activar IA…"
                className="w-full rounded-md border border-ink-200 bg-white px-2 py-1.5 text-xs text-ink-900 outline-none focus:border-brand-500 dark:border-ink-800 dark:bg-ink-900 dark:text-ink-50"
              />
              <p className="mt-1 text-[11px] text-ink-600 dark:text-ink-400">
                Se guarda solo en tu navegador (localStorage). Sin clave funciona en modo guiado.
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  onClick={guardarKey}
                  className="rounded-md bg-brand-600 px-3 py-1 text-xs font-medium text-white transition hover:bg-brand-700"
                >
                  Guardar
                </button>
                <button
                  onClick={() => {
                    setKeyDraft('')
                    try {
                      localStorage.removeItem(LS_KEY)
                    } catch {
                      /* ignore */
                    }
                    setApiKey('')
                  }}
                  className="rounded-md border border-ink-200 px-3 py-1 text-xs text-ink-700 transition hover:bg-ink-100 dark:border-ink-800 dark:text-ink-300 dark:hover:bg-ink-800"
                >
                  Borrar
                </button>
              </div>
            </div>
          )}

          {/* Historial */}
          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
            {mensajes.map((m) => (
              <Burbuja key={m.id} m={m} />
            ))}
            {pensando && (
              <div className="flex items-center gap-1.5 text-xs text-ink-400">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-500" />
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-500 [animation-delay:150ms]" />
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-500 [animation-delay:300ms]" />
                <span className="ml-1">Pensando…</span>
              </div>
            )}
          </div>

          {/* Chips de preguntas rápidas */}
          <div className="flex flex-wrap gap-1.5 border-t border-ink-200 px-3 py-2 dark:border-ink-800">
            {CHIPS.map((c) => (
              <button
                key={c}
                onClick={() => enviar(c)}
                disabled={pensando}
                className="rounded-full border border-brand-300 bg-brand-50 px-2.5 py-1 text-[11px] text-brand-700 transition hover:bg-brand-100 disabled:opacity-50 dark:border-brand-700 dark:bg-ink-800 dark:text-brand-300 dark:hover:bg-ink-700"
              >
                {c}
              </button>
            ))}
          </div>

          {/* Input */}
          <form
            onSubmit={(e) => {
              e.preventDefault()
              enviar(input)
            }}
            className="flex items-center gap-2 border-t border-ink-200 px-3 py-2.5 dark:border-ink-800"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={apiKey ? 'Pregunta lo que quieras…' : 'Departamento, sector o término…'}
              className="flex-1 rounded-full border border-ink-200 bg-ink-50 px-3 py-2 text-sm text-ink-900 outline-none focus:border-brand-500 dark:border-ink-800 dark:bg-ink-950 dark:text-ink-50"
            />
            <button
              type="submit"
              disabled={pensando || !input.trim()}
              aria-label="Enviar"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-600 text-white transition hover:bg-brand-700 disabled:opacity-40"
            >
              <SendIcon className="h-4 w-4" />
            </button>
          </form>
        </div>
      )}
    </>
  )
}

// ── Burbuja de mensaje ────────────────────────────────────────────────────────
function Burbuja({ m }: { m: Mensaje }) {
  const esUser = m.rol === 'user'
  return (
    <div className={`flex ${esUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
          esUser
            ? 'rounded-br-sm bg-brand-600 text-white'
            : 'rounded-bl-sm bg-ink-100 text-ink-900 dark:bg-ink-800 dark:text-ink-50'
        }`}
      >
        <p className="whitespace-pre-line leading-snug">{m.texto}</p>
        {m.links && m.links.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {m.links.map((l) => (
              <Link
                key={l.to + l.label}
                to={l.to}
                className="rounded-full bg-white/20 px-2 py-0.5 text-[11px] font-medium underline-offset-2 hover:underline dark:bg-black/20"
              >
                {l.label} →
              </Link>
            ))}
          </div>
        )}
        {m.nota && (
          <div
            className={`mt-1.5 text-[10px] ${
              esUser ? 'text-brand-100' : 'text-ink-400 dark:text-ink-400'
            }`}
          >
            {m.nota}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Lookups de datos ──────────────────────────────────────────────────────────
function buscarDepartamento(q: string, d: Datos): Omit<Mensaje, 'id' | 'rol'> | null {
  // Agrega por nombre de departamento normalizado.
  const acc = new Map<string, { nombre: string; pim: number; dev: number }>()
  for (const row of d.deptos) {
    const key = norm(row.departamento)
    if (!key) continue
    const cur = acc.get(key) || { nombre: row.departamento, pim: 0, dev: 0 }
    cur.pim += row.pim || 0
    cur.dev += row.devengado || 0
    acc.set(key, cur)
  }
  for (const [key, v] of acc) {
    if (q.includes(key) || key.includes(q)) {
      const ej = ejecucion(v.dev, v.pim)
      return {
        texto:
          `${v.nombre} (2025): PIM ${soles(v.pim)} (${solesCompact(v.pim)}). ` +
          `Devengado ${soles(v.dev)}. Ejecución ${pct(ej)}.`,
        links: [LINKS.presupuesto, LINKS.prosperidad],
        nota: 'modo guiado',
      }
    }
  }
  return null
}

function buscarSector(q: string, d: Datos): Omit<Mensaje, 'id' | 'rol'> | null {
  for (const s of d.sectores) {
    const key = norm(s.sector)
    if (!key) continue
    if (q.includes(key) || (key.length > 4 && key.includes(q) && q.length > 4)) {
      const ej = ejecucion(s.devengado, s.pim)
      return {
        texto: `Sector ${s.sector} (2025): PIM ${soles(s.pim)} (${solesCompact(s.pim)}). Devengado ${soles(
          s.devengado,
        )}. Ejecución ${pct(ej)}.`,
        links: [LINKS.presupuesto],
        nota: 'modo guiado',
      }
    }
  }
  return null
}

function buscarFuncion(q: string, d: Datos): Omit<Mensaje, 'id' | 'rol'> | null {
  for (const f of d.funciones) {
    const key = norm(f.funcion)
    if (!key) continue
    if (q.includes(key) || (key.length > 4 && key.includes(q) && q.length > 4)) {
      const ej = ejecucion(f.devengado, f.pim)
      return {
        texto: `Función ${f.funcion} (2025): PIM ${soles(f.pim)} (${solesCompact(
          f.pim,
        )}). Devengado ${soles(f.devengado)}. Ejecución ${pct(ej)}.`,
        links: [LINKS.presupuesto],
        nota: 'modo guiado',
      }
    }
  }
  return null
}

function buscarDistrito(q: string, d: Datos): Omit<Mensaje, 'id' | 'rol'> | null {
  if (q.length < 3) return null
  // Indexa indicadores por ubigeo para acceso rápido.
  for (const [ubigeo, meta] of d.distritos) {
    const key = norm(meta.nombre)
    if (!key || key.length < 3) continue
    if (q === key || q.includes(key)) {
      const ind = d.indicadores.find((i) => i.ubigeo === ubigeo)
      if (!ind) continue
      const piso = clasificarPiso(ind.altitud, meta.depto)
      const partes: string[] = [`${meta.nombre} (${meta.depto || 'Perú'}).`]
      if (ind.idh) partes.push(`IDH ${ind.idh.toFixed(1)}.`)
      if (ind.pobreza != null) partes.push(`Pobreza ${ind.pobreza.toFixed(1)}%.`)
      if (ind.altitud != null) partes.push(`Altitud ${Math.round(ind.altitud)} msnm.`)
      if (piso) partes.push(`Piso: ${piso.nombre}.`)
      return {
        texto: partes.join(' '),
        links: [LINKS.prosperidad, LINKS.pisos],
        nota: 'modo guiado · indicadores aprox.',
      }
    }
  }
  return null
}

// Sugerencias de enlaces según palabras de la pregunta (para respuestas de IA).
function linksSugeridos(texto: string): { to: string; label: string }[] {
  const q = norm(texto)
  const out: { to: string; label: string }[] = []
  if (/(presupuest|pim|pia|devengad|girad|ejecuci|gasto)/.test(q)) out.push(LINKS.presupuesto)
  if (/(piso|altitud|puna|quechua|yunga|chala|suni|janca|selva)/.test(q)) out.push(LINKS.pisos)
  if (/(riesg|sismo|huaico|inundaci|desastre|nino|niño)/.test(q)) out.push(LINKS.riesgos)
  if (/(prosperidad|idh|pobreza|ipt|desarrollo)/.test(q)) out.push(LINKS.prosperidad)
  if (out.length === 0) out.push(LINKS.metodologia)
  return out.slice(0, 4)
}

// ── Integración Gemini (opcional) ─────────────────────────────────────────────
function resumenContexto(d: Datos | null): string {
  if (!d) return 'No hay datos cargados todavía.'
  const lineas: string[] = []
  if (d.deptos.length) {
    const acc = new Map<string, { nombre: string; pim: number; dev: number }>()
    for (const r of d.deptos) {
      const cur = acc.get(r.departamento) || { nombre: r.departamento, pim: 0, dev: 0 }
      cur.pim += r.pim || 0
      cur.dev += r.devengado || 0
      acc.set(r.departamento, cur)
    }
    const top = [...acc.values()].sort((a, b) => b.pim - a.pim).slice(0, 8)
    lineas.push(
      'PIM 2025 por departamento (top 8): ' +
        top.map((t) => `${t.nombre}=${solesCompact(t.pim)}`).join(', ') +
        '.',
    )
  }
  if (d.sectores.length) {
    const top = [...d.sectores].sort((a, b) => (b.pim || 0) - (a.pim || 0)).slice(0, 6)
    lineas.push('Sectores principales (PIM): ' + top.map((s) => `${s.sector}=${solesCompact(s.pim)}`).join(', ') + '.')
  }
  if (d.funciones.length) {
    const top = [...d.funciones].sort((a, b) => (b.pim || 0) - (a.pim || 0)).slice(0, 6)
    lineas.push('Funciones principales (PIM): ' + top.map((f) => `${f.funcion}=${solesCompact(f.pim)}`).join(', ') + '.')
  }
  lineas.push(`Indicadores distritales cargados: ${d.indicadores.length} distritos (IDH, pobreza, altitud).`)
  return lineas.join('\n')
}

// Ninacha vía VPS: el servidor llama a OpenRouter (modelo gratuito) con la key OCULTA.
// El cliente solo envía la pregunta + un resumen del contexto de datos. Costo $0.
async function preguntarNinacha(pregunta: string, d: Datos | null): Promise<string> {
  // Timeout cliente: si el server tarda (modelo gratis saturado), no dejamos "Pensando…" colgado.
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 25000)
  const res = await fetch(NINACHA_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pregunta, contexto: resumenContexto(d) }),
    signal: ctrl.signal,
  }).finally(() => clearTimeout(t))
  if (!res.ok) {
    let detalle = `HTTP ${res.status}`
    try {
      const j = await res.json()
      if (j?.detail) detalle = j.detail
    } catch {
      /* ignore */
    }
    throw new Error(detalle)
  }
  const data = await res.json()
  const texto: string = (data?.texto || '').trim()
  if (!texto) throw new Error('respuesta vacía')
  return texto
}

async function preguntarGemini(pregunta: string, key: string, d: Datos | null): Promise<string> {
  const system =
    'Eres el asistente del observatorio QHAWAY, un dashboard ciudadano del presupuesto público del Perú (datos SIAF-MEF 2025) y de indicadores territoriales distritales. ' +
    'Responde SOLO sobre este observatorio y datos de presupuesto/territorio del Perú; si te preguntan otra cosa, redirige amablemente. ' +
    'Sé conciso (máx. ~5 frases), en español (Perú), cita cifras cuando las tengas y sugiere qué sección revisar (Presupuesto, Pisos, Riesgos, Prosperidad o Metodología). ' +
    'No inventes cifras que no estén en el contexto.\n\nCONTEXTO DE DATOS:\n' +
    resumenContexto(d)

  const url =
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' +
    encodeURIComponent(key)

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: pregunta }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 512 },
    }),
  })

  if (!res.ok) {
    let detalle = `HTTP ${res.status}`
    try {
      const j = await res.json()
      if (j?.error?.message) detalle = j.error.message
    } catch {
      /* ignore */
    }
    throw new Error(detalle)
  }

  const data = await res.json()
  const texto: string | undefined = data?.candidates?.[0]?.content?.parts
    ?.map((p: { text?: string }) => p?.text || '')
    .join('')
    .trim()
  if (!texto) throw new Error('respuesta vacía')
  return texto
}

// ── Iconos (SVG inline, sin dependencias) ─────────────────────────────────────
function ChatIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  )
}
function XIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  )
}
function GearIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}
function SendIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m22 2-7 20-4-9-9-4 20-7z" />
    </svg>
  )
}