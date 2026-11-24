import { useEffect, useMemo, useState } from 'react'
import type { EChartsOption } from 'echarts'
import {
  getMeta, getSerieNacionalConCorte, getPorNivelYear, aniosDistritales, rangoAnios, anioEnCurso,
  getPorDistrito, getPorFuncion, getPorSector, getGeoJSON, loadJSON, type SerieConCorte,
} from '../lib/data'
import type {
  Meta, SerieNacional, PorNivel, PorDepartamento, PorDistrito,
  PorFuncion, PorSector, FlujoFases,
} from '../lib/types'
import { useAsync } from '../lib/useAsync'
import { solesCompact, soles, pct, ejecucion, fecha } from '../lib/format'
import { DEVENGADO_DESDE, devengadoONull, ejecucionValida } from '../lib/reglas'
import {
  Card, CardHeader, HelpTip, KPI, Pill, Select, Loading, ErrorBox, SectionIntro,
} from '../components/ui'
import { Chart } from '../components/Chart'
import MapaDistrital, { type MapValue } from '../components/MapaDistrital'
import SerieChartShared from '../components/SerieChart'
import YearStrip from '../components/YearStrip'
import DondeSeGasta from '../components/DondeSeGasta'
import DrillPresupuesto from '../components/DrillPresupuesto'
import ProgramaPresupuestal from '../components/ProgramaPresupuestal'
import CortesPresupuesto from '../components/CortesPresupuesto'

type FaseMapa = 'pim' | 'devengado' | 'girado'
type Nivel = 'Todos' | 'GOBIERNO NACIONAL' | 'GOBIERNOS REGIONALES' | 'GOBIERNOS LOCALES'

const FASE_LABEL: Record<FaseMapa, string> = {
  pim: 'PIM', devengado: 'Devengado', girado: 'Girado',
}

const NIVEL_OPTS: { value: Nivel; label: string }[] = [
  { value: 'Todos', label: 'Todos los niveles' },
  { value: 'GOBIERNO NACIONAL', label: 'Gobierno Nacional' },
  { value: 'GOBIERNOS REGIONALES', label: 'Gobiernos Regionales' },
  { value: 'GOBIERNOS LOCALES', label: 'Gobiernos Locales' },
]

/** Color por % ejecución (fracción 0..1): <0.5 rojo, 0.5–0.8 ámbar, >0.8 verde */
function colorEjec(frac: number): string {
  if (frac < 0.5) return '#f87171'
  if (frac < 0.8) return '#fbbf24'
  return '#34d399'
}
function toneEjec(frac: number): 'good' | 'warn' | 'neutral' {
  if (frac >= 0.8) return 'good'
  if (frac >= 0.5) return 'warn'
  return 'neutral'
}

/** Lee el año inicial del hash (#/presupuesto?y=2025) si está presente. */
function yearFromHash(): number | undefined {
  const m = /[?&]y=(\d{4})/.exec(window.location.hash)
  if (m) {
    const y = Number(m[1])
    if (y >= 2000 && y <= 2100) return y
  }
  return undefined
}

export default function Presupuesto() {
  const meta = useAsync<Meta>(getMeta, [])

  if (meta.loading) return <Loading label="Cargando metadatos del presupuesto…" />
  if (meta.error) return <ErrorBox error={meta.error} />
  if (!meta.data) return <Loading />

  return <PresupuestoBody meta={meta.data} />
}

function PresupuestoBody({ meta }: { meta: Meta }) {
  const years = useMemo(
    () => [...meta.years].sort((a, b) => b - a),
    [meta.years],
  )

  const [year, setYear] = useState<number>(
    yearFromHash() ?? meta.latestYear ?? years[0],
  )
  const [faseMapa, setFaseMapa] = useState<FaseMapa>('pim')
  const [nivel, setNivel] = useState<Nivel>('Todos')
  const [selDist, setSelDist] = useState<string | undefined>(undefined)
  // Cambiar de año limpia la selección del mapa (en el handler, no en un efecto).
  const cambiarAnio = (y: number) => { setYear(y); setSelDist(undefined) }
  const distYears = useMemo(() => aniosDistritales(meta), [meta])
  const rangoDetalle = rangoAnios(distYears)
  const enCurso = anioEnCurso(meta)

  // Refleja el año en el hash (opcional, no rompe el HashRouter)
  useEffect(() => {
    const base = window.location.hash.replace(/[?&]y=\d{4}/, '')
    const sep = base.includes('?') ? '&' : '?'
    const next = `${base}${sep}y=${year}`
    if (next !== window.location.hash) {
      window.history.replaceState(null, '', next)
    }
  }, [year])

  // Fuentes que NO dependen del año.
  // UNA sola fuente para todos los totales nacionales de la vista (KPIs, serie y flujo de
  // fases): /api/serie-nacional (respaldo estático: serie-historica-oficial.json).
  const serie = useAsync<SerieConCorte>(getSerieNacionalConCorte, [])
  const geo = useAsync<unknown>(getGeoJSON, [])

  // Departamento histórico (todos los años 2004-2026, por destino territorial).
  const deptoHist = useAsync<PorDepartamento[]>(() => loadJSON<PorDepartamento[]>('por-departamento-historico.json'), [])

  // Fuentes que dependen del año
  const distrito = useAsync<PorDistrito[]>(() => getPorDistrito(year), [year])
  const funcion = useAsync<PorFuncion[]>(() => getPorFuncion(year), [year])
  const sector = useAsync<PorSector[]>(() => getPorSector(year), [year])
  // Desglose por nivel para el año (API por-nivel/{año}). Para "Todos" se usa la serie.
  const nivelYear = useAsync<PorNivel[]>(() => getPorNivelYear(year), [year])

  // Años del selector: los de la serie nacional (la fuente de los KPIs). Así no aparecen
  // años sin total nacional (p. ej. 2005, que solo existe en el histórico departamental).
  const yearOpts = useMemo(() => {
    const ys = serie.data ? serie.data.serie.map((r) => r.year) : years
    return [...new Set(ys)].sort((a, b) => b - a).map((y) => ({ value: y, label: String(y) }))
  }, [years, serie.data])

  // Fila nacional del año elegido (KPIs + Sankey salen de aquí → mismas cifras).
  const filaAnio = serie.data?.serie.find((r) => r.year === year)
  const corteAnio = serie.data?.corte(year)
  const faseOpts: { value: FaseMapa; label: string }[] = [
    { value: 'pim', label: 'PIM (asignado vigente)' },
    { value: 'devengado', label: 'Devengado (gastado)' },
    { value: 'girado', label: 'Girado (pagado)' },
  ]

  return (
    <div className="space-y-5">
      <SectionIntro title="Presupuesto público">
        Ejecución del presupuesto del Estado peruano (SIAF-MEF), por fases, niveles de
        gobierno, función y territorio. Cifras en soles corrientes. Fuente: Consulta Amigable / MEF.
      </SectionIntro>

      {/* Controles sticky */}
      <div className="sticky top-0 z-30 -mx-2 px-2 py-2 backdrop-blur bg-white/80 dark:bg-ink-950/80 border-b border-ink-200 dark:border-ink-800 rounded-b-xl">
        <div className="flex flex-wrap items-center gap-3">
          <YearStrip years={yearOpts.map((o) => o.value)} value={year} onChange={cambiarAnio} />
        </div>
        <div className="flex flex-wrap items-center gap-3 mt-2">
          <Select<FaseMapa> value={faseMapa} onChange={setFaseMapa} options={faseOpts} label="Fase a mapear" />
          <Select<Nivel> value={nivel} onChange={setNivel} options={NIVEL_OPTS} label="Nivel de gobierno" />
          <span className="ml-auto text-[11px] text-ink-400">
            {serie.data
              ? corteAnio
                ? <>Corte {year}: {fecha(corteAnio)}{year === enCurso ? ' (ejercicio en curso)' : ''}</>
                : <>{year}: cierre anual</>
              : <>Actualizado: {fecha(meta.lastUpdate)}</>}
            {serie.data?.origen === 'estatico' && ' · respaldo estático (API no disponible)'}
          </span>
        </div>
      </div>

      {/* 0. Cortes rápidos (pedido #1 de Kely) — primero en la página */}
      <CortesPresupuesto />

      {/* 1. KPIs */}
      {serie.loading && !serie.data ? <Loading label="Cargando serie nacional…" />
        : serie.error ? <ErrorBox error={serie.error} />
        : <KpisAnio fila={filaAnio} nivelYear={nivelYear} year={year} nivel={nivel} rangoDetalle={rangoDetalle} />}

      {/* 2. Mapa + panel de detalle */}
      <Card>
        <CardHeader
          title={`Mapa distrital — ${FASE_LABEL[faseMapa]} ${year}`}
          subtitle={nivel === 'Todos' ? 'Todos los niveles de gobierno' : NIVEL_OPTS.find((n) => n.value === nivel)?.label}
          help={
            <HelpTipMapa />
          }
          right={
            <Pill tone="warn">aprox. por ejecutora</Pill>
          }
        />
        <div className="px-4 pb-4">
          <p className="text-xs text-ink-400 mb-3">
            <Pill tone="warn">ojo</Pill>{' '}
            El monto se atribuye al distrito de la <strong>unidad ejecutora</strong>, no
            necesariamente al lugar donde se ejecuta la obra (ver notas de metadatos). Para una
            lectura territorial más fiel, filtra a <strong>Gobierno Local</strong>.
          </p>
          <MapaPanel
            geo={geo}
            distrito={distrito}
            depto={deptoHist}
            year={year}
            faseMapa={faseMapa}
            nivel={nivel}
            selDist={selDist}
            onSelect={setSelDist}
            rangoDetalle={rangoDetalle}
          />
        </div>
      </Card>

      {/* 2.5 ¿Dónde se gasta? — drill depto→provincia→distrito */}
      {distrito.data && distrito.data.length > 0 && (
        <DondeSeGasta data={distrito.data} year={year} nivel={nivel} />
      )}

      {/* 2.6 Explorador jerárquico — drill nacional→nivel→categoría→función→territorio */}
      <DrillPresupuesto fallbackYear={meta.latestYear} />

      {/* 3 y 4 en grid */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <SerieTemporal serie={serie} />
        <SankeyFases fila={filaAnio} cargando={serie.loading && !serie.data} year={year} rangoDetalle={rangoDetalle} />
      </div>

      {/* 5 y 6 */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <TreemapFuncion funcion={funcion} year={year} rangoDetalle={rangoDetalle} />
        <RankingSector sector={sector} year={year} rangoDetalle={rangoDetalle} />
      </div>

      {/* 7. Categoría / Programa Presupuestal (con resaltado climático) */}
      <ProgramaPresupuestal />

      <p className="text-[11px] text-ink-400">
        Fuentes:{' '}
        {meta.sources.map((s, i) => (
          <span key={s.name}>
            {i > 0 && ' · '}
            <a href={s.url} target="_blank" rel="noreferrer" className="underline hover:text-brand-500">{s.name}</a>
          </span>
        ))}
        . {meta.notas}
      </p>
    </div>
  )
}

/* ───────────────────────── 1. KPIs ───────────────────────── */

type Totales = { pia: number; pim: number; devengado: number; girado: number }
const ZERO: Totales = { pia: 0, pim: 0, devengado: 0, girado: 0 }

function sumarNivel(rows: PorNivel[], nivel: Nivel): Totales {
  const f = rows.filter((r) => nivel === 'Todos' || r.nivel === nivel)
  return f.reduce<Totales>(
    (a, r) => ({
      pia: a.pia + (r.pia || 0),
      pim: a.pim + (r.pim || 0),
      devengado: a.devengado + (r.devengado || 0),
      girado: a.girado + (r.girado || 0),
    }),
    { ...ZERO },
  )
}

function KpisAnio({
  fila, nivelYear, year, nivel, rangoDetalle,
}: {
  fila: SerieNacional | undefined
  nivelYear: ReturnType<typeof useAsync<PorNivel[]>>
  year: number
  nivel: Nivel
  rangoDetalle: string
}) {
  // "Todos los niveles" → fila de la serie nacional (misma fuente que el Sankey).
  // Un nivel específico → desglose de la API por año (por-nivel/{año}).
  let t: Totales | null = null
  let aviso: string | null = null

  if (nivel === 'Todos') {
    if (fila) {
      t = { pia: fila.pia || 0, pim: fila.pim || 0, devengado: fila.devengado || 0, girado: fila.girado || 0 }
    } else {
      aviso = `No hay serie nacional para ${year}.`
    }
  } else {
    if (nivelYear.loading && !nivelYear.data) return <Loading label="Cargando desglose por nivel…" />
    const rows = (nivelYear.data ?? []).filter((r) => r.year === year || r.year === undefined)
    const suma = rows.length > 0 && !nivelYear.error ? sumarNivel(rows, nivel) : null
    if (suma && suma.pim > 0) {
      t = suma
    } else {
      aviso = `El desglose por nivel de gobierno está disponible para los años con detalle${rangoDetalle ? ` (${rangoDetalle})` : ''}. Para ${year}, usa “Todos los niveles”.`
    }
  }

  // Devengado/girado antes de DEVENGADO_DESDE (o ≤0) = sin dato, nunca "0.0%".
  const dev = t ? devengadoONull(year, t.devengado) : null
  const gir = t ? devengadoONull(year, t.girado) : null
  const frac = t ? ejecucionValida(year, t.devengado, t.pim) : null
  if (t && dev == null && !aviso && year < DEVENGADO_DESDE) {
    aviso = `El devengado y el girado de ${year} no son confiables en la fuente (solo desde ${DEVENGADO_DESDE}); se muestran como sin dato.`
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <h3 className="text-sm font-semibold text-ink-900 dark:text-ink-50">
          Resumen {year} — {nivel === 'Todos' ? 'todos los niveles' : NIVEL_OPTS.find((n) => n.value === nivel)?.label}
        </h3>
        <HelpTip>
          <strong>PIA</strong>: presupuesto inicial de apertura. <strong>PIM</strong>: presupuesto
          modificado (vigente). <strong>Devengado</strong>: obligación de pago reconocida (gasto real).
          <strong> Girado</strong>: orden de pago emitida. <strong>% ejecución</strong> = devengado / PIM
          (rojo &lt;50%, ámbar 50–80%, verde &gt;80%). Devengado y girado solo son confiables
          desde {DEVENGADO_DESDE}.
        </HelpTip>
      </div>
      {aviso && (
        <p className="mb-2 text-xs"><Pill tone="warn">{t ? 'sin dato' : 'sin desglose'}</Pill> <span className="text-ink-400">{aviso}</span></p>
      )}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
        <KPI label="PIA" value={solesCompact(t?.pia)} sub="Inicial de apertura" />
        <KPI label="PIM" value={solesCompact(t?.pim)} sub="Modificado / vigente" accent />
        <KPI label="Devengado" value={solesCompact(dev)} sub={dev == null && t ? 's/d' : 'Gasto reconocido'} />
        <KPI label="Girado" value={solesCompact(gir)} sub={gir == null && t ? 's/d' : 'Orden de pago'} />
        <Card className="px-4 py-3">
          <p className="text-xs text-ink-400">% Ejecución</p>
          {frac != null ? (
            <>
              <p className="text-2xl font-bold tracking-tight" style={{ color: colorEjec(frac) }}>{pct(frac)}</p>
              <p className="text-xs mt-0.5">
                <Pill tone={toneEjec(frac)}>{frac >= 0.8 ? 'alta' : frac >= 0.5 ? 'media' : 'baja'}</Pill>
              </p>
            </>
          ) : (
            <>
              <p className="text-2xl font-bold tracking-tight text-ink-400">—</p>
              <p className="text-xs mt-0.5"><Pill tone="neutral">sin dato</Pill></p>
            </>
          )}
        </Card>
      </div>
    </div>
  )
}

/* ───────────────────────── 2. Mapa ───────────────────────── */

function HelpTipMapa() {
  return (
    <span>
      Cada distrito se colorea por el monto de la fase elegida (más intenso = más soles). El
      popup muestra el monto y el % de ejecución de ese distrito. <strong>No</strong> es gasto
      per cápita ni por lugar de obra: es el monto registrado por la unidad ejecutora. Haz clic
      en un distrito para ver su detalle al lado.
    </span>
  )
}

type FilaDetalle = { ubigeo: string; titulo: string; sub?: string; pim: number; devengado: number; valor: number }

function MapaPanel({
  geo, distrito, depto, year, faseMapa, nivel, selDist, onSelect, rangoDetalle,
}: {
  geo: ReturnType<typeof useAsync<unknown>>
  distrito: ReturnType<typeof useAsync<PorDistrito[]>>
  depto: ReturnType<typeof useAsync<PorDepartamento[]>>
  year: number
  faseMapa: FaseMapa
  nivel: Nivel
  selDist?: string
  onSelect: (u: string | undefined) => void
  rangoDetalle: string
}) {
  // ¿Hay datos por distrito para este año? Si no, fallback a departamento. Mientras se
  // recarga un año nuevo, useAsync conserva el dato previo → no parpadea el fallback.
  const usaDistrito = !distrito.error && !!distrito.data
  const usaDepto = !usaDistrito && !distrito.loading && !depto.error && !!depto.data

  // Map de valores + listado del panel: memoizado para que MapaDistrital no reconstruya
  // la capa en cada render (p. ej. al seleccionar un distrito).
  const construido = useMemo(() => {
    const values = new Map<string, MapValue>()
    const detalle: FilaDetalle[] = []
    // Girado/devengado < DEVENGADO_DESDE = sin dato (no se colorea como 0).
    const valorFase = (a: { pim: number; devengado: number; girado: number }) =>
      faseMapa === 'pim' ? a.pim : devengadoONull(year, a[faseMapa])
    const etiquetaEjec = (dev: number, pim: number) => {
      const f = ejecucionValida(year, dev, pim)
      return f == null ? 's/d' : pct(f)
    }

    if (usaDistrito && distrito.data) {
      const rows = distrito.data.filter((r) => nivel === 'Todos' || r.nivel === nivel)
      // agrupa por ubigeo (puede haber varias filas por nivel)
      const agg = new Map<string, { pim: number; devengado: number; girado: number; distrito: string; departamento: string; provincia: string }>()
      for (const r of rows) {
        const cur = agg.get(r.ubigeo) ?? { pim: 0, devengado: 0, girado: 0, distrito: r.distrito, departamento: r.departamento, provincia: r.provincia }
        cur.pim += r.pim || 0
        cur.devengado += r.devengado || 0
        cur.girado += r.girado || 0
        agg.set(r.ubigeo, cur)
      }
      for (const [ub, a] of agg) {
        const valor = valorFase(a)
        if (valor != null) values.set(ub, { value: valor, label: `Ejec: ${etiquetaEjec(a.devengado, a.pim)}` })
        detalle.push({ ubigeo: ub, titulo: a.distrito, sub: `${a.provincia}, ${a.departamento}`, pim: a.pim, devengado: a.devengado, valor: valor ?? 0 })
      }
      return { modo: 'distrito' as const, values, detalle: detalle.sort((x, y) => y.valor - x.valor) }
    }
    if (usaDepto && depto.data && geo.data) {
      // Histórico departamental por destino (META): filtra solo por año (no tiene desglose por nivel).
      const rows = depto.data.filter((r) => r.year === year)
      const agg = new Map<string, { pim: number; devengado: number; girado: number; departamento: string }>()
      for (const r of rows) {
        const cur = agg.get(r.ubigeo) ?? { pim: 0, devengado: 0, girado: 0, departamento: r.departamento }
        cur.pim += r.pim || 0
        cur.devengado += r.devengado || 0
        cur.girado += r.girado || 0
        agg.set(r.ubigeo, cur)
      }
      // Asigna a TODOS los distritos de cada depto el mismo valor (color por departamento)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const feats: any[] = (geo.data as any).features ?? []
      for (const f of feats) {
        const dpto2 = String(f.properties?.IDDPTO ?? f.properties?.IDDIST?.slice(0, 2) ?? '')
        const a = agg.get(dpto2)
        const valor = a ? valorFase(a) : null
        if (a && valor != null) values.set(String(f.properties?.IDDIST), { value: valor, label: `Depto · Ejec: ${etiquetaEjec(a.devengado, a.pim)}` })
      }
      for (const [, a] of agg) {
        detalle.push({ ubigeo: a.departamento, titulo: a.departamento, sub: 'Departamento', pim: a.pim, devengado: a.devengado, valor: valorFase(a) ?? 0 })
      }
      return { modo: 'departamento' as const, values, detalle: detalle.sort((x, y) => y.valor - x.valor) }
    }
    return null
  }, [usaDistrito, usaDepto, distrito.data, depto.data, geo.data, nivel, faseMapa, year])

  if (geo.loading && !geo.data) return <Loading label="Cargando geografía…" />
  if (geo.error) return <ErrorBox error={geo.error} />
  if (!geo.data) return <Loading />
  if (!construido) {
    if (distrito.loading || depto.loading) return <Loading label={`Cargando ejecución ${year}…`} />
    // Sin distrito ni departamento utilizable
    return <ErrorBox error={distrito.error || depto.error || 'No hay datos territoriales para este año.'} />
  }
  const { modo, values, detalle } = construido

  // Panel de detalle del distrito seleccionado
  const sel = selDist ? detalle.find((d) => d.ubigeo === selDist) : undefined

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2">
        {modo === 'departamento' && (
          <p className="mb-2"><Pill tone="warn">aprox.</Pill> <span className="text-xs text-ink-400">No existe archivo por distrito para {year}; se muestra agregado por departamento.</span></p>
        )}
        <MapaDistrital
          geojson={geo.data}
          values={values}
          unitLabel={FASE_LABEL[faseMapa]}
          formatValue={(v) => solesCompact(v)}
          onSelect={(ub) => onSelect(ub)}
          selected={modo === 'distrito' ? selDist : undefined}
          height={520}
        />
      </div>

      {/* Panel lateral de detalle */}
      <aside className="lg:col-span-1">
        <div className="rounded-2xl border border-ink-200 dark:border-ink-800 p-4 h-full">
          <h4 className="text-sm font-semibold text-ink-900 dark:text-ink-50 mb-2">Detalle territorial</h4>
          {modo === 'distrito' && sel ? (
            <DetalleBox d={sel} fase={faseMapa} />
          ) : modo === 'distrito' ? (
            <p className="text-xs text-ink-400">Haz clic en un distrito del mapa para ver su PIM, devengado y % de ejecución.</p>
          ) : (
            <p className="text-xs text-ink-400">Vista por departamento (fallback). El detalle por distrito está disponible solo para años con detalle distrital{rangoDetalle ? ` (${rangoDetalle})` : ''}.</p>
          )}

          <div className="mt-4 pt-3 border-t border-ink-200 dark:border-ink-800">
            <p className="text-[11px] uppercase tracking-wide text-ink-400 mb-1">
              Top 6 por {FASE_LABEL[faseMapa]}
            </p>
            <ul className="space-y-1.5">
              {detalle.slice(0, 6).map((d) => (
                <li key={d.ubigeo}>
                  <button
                    type="button"
                    onClick={() => onSelect(d.ubigeo)}
                    className={`w-full text-left text-xs flex items-center justify-between gap-2 rounded-lg px-2 py-1 hover:bg-ink-100 dark:hover:bg-ink-800 transition ${selDist === d.ubigeo ? 'bg-ink-100 dark:bg-ink-800' : ''}`}
                  >
                    <span className="truncate text-ink-700 dark:text-ink-200">{d.titulo}</span>
                    <span className="shrink-0 font-medium text-ink-900 dark:text-ink-50">{solesCompact(d.valor)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </aside>
    </div>
  )
}

function DetalleBox({ d, fase }: { d: { titulo: string; sub?: string; pim: number; devengado: number; valor: number }; fase: FaseMapa }) {
  const frac = ejecucion(d.devengado, d.pim)
  return (
    <div className="space-y-2">
      <div>
        <p className="text-base font-bold text-ink-900 dark:text-ink-50">{d.titulo}</p>
        {d.sub && <p className="text-xs text-ink-400">{d.sub}</p>}
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
        <dt className="text-ink-400">{FASE_LABEL[fase]} (mapeado)</dt>
        <dd className="text-right font-medium text-ink-900 dark:text-ink-50">{soles(d.valor)}</dd>
        <dt className="text-ink-400">PIM</dt>
        <dd className="text-right text-ink-700 dark:text-ink-200">{soles(d.pim)}</dd>
        <dt className="text-ink-400">Devengado</dt>
        <dd className="text-right text-ink-700 dark:text-ink-200">{soles(d.devengado)}</dd>
        <dt className="text-ink-400">% Ejecución</dt>
        <dd className="text-right font-semibold" style={{ color: colorEjec(frac) }}>{pct(frac)}</dd>
      </dl>
      <Pill tone={toneEjec(frac)}>{frac >= 0.8 ? 'ejecución alta' : frac >= 0.5 ? 'ejecución media' : 'ejecución baja'}</Pill>
    </div>
  )
}

/* ───────────────────────── 3. Serie temporal ───────────────────────── */

function SerieTemporal({ serie }: { serie: ReturnType<typeof useAsync<SerieConCorte>> }) {
  const datos = serie.data?.serie
  const anios = datos?.map((r) => r.year) ?? []
  const rango = rangoAnios(anios)
  const ultimo = anios.length ? Math.max(...anios) : undefined
  const corteUlt = ultimo != null ? serie.data?.corte(ultimo) : undefined
  return (
    <Card>
      <CardHeader
        title={`Presupuesto público — tendencia anual${rango ? ` ${rango}` : ''}`}
        subtitle={`PIM y devengado por año · ${serie.data?.origen === 'estatico' ? 'respaldo estático (MEF)' : 'API QHAWAY (MEF, datos abiertos)'}${corteUlt && ultimo ? ` · ${ultimo} al ${fecha(corteUlt)}` : ''}`}
        help={
          <span>
            Serie nacional del gasto público ({anios.length} años): las barras son el{' '}
            <strong>PIM</strong> y el <strong>devengado</strong>. Son las mismas cifras de los KPIs
            y del flujo de fases. El devengado solo es confiable desde {DEVENGADO_DESDE}; antes
            se muestra sin dato. Cifras en <strong>soles corrientes</strong> (no ajustadas por inflación).
          </span>
        }
      />
      <div className="px-4 pb-4">
        {serie.loading && !datos ? <Loading /> : serie.error ? <ErrorBox error={serie.error} /> : !datos ? <Loading /> : (
          <SerieChartShared serie={datos} height={320} />
        )}
      </div>
    </Card>
  )
}

/* ───────────────────────── 4. Sankey de fases ───────────────────────── */

function DetalleNoDisponible({ year, rangoDetalle }: { year: number; rangoDetalle: string }) {
  return (
    <div className="px-4 py-8 text-center text-sm text-ink-400">
      <Pill tone="neutral">solo años con detalle</Pill>
      <p className="mt-2">
        Este desglose está disponible para los años con detalle cargado{rangoDetalle ? ` (${rangoDetalle})` : ''}.
        Para {year} aún no — el mapa de arriba sí muestra {year} a nivel territorial.
      </p>
    </div>
  )
}

function SankeyFases({ fila, cargando, year, rangoDetalle }: {
  fila: SerieNacional | undefined
  cargando: boolean
  year: number
  rangoDetalle: string
}) {
  // Mismo registro que los KPIs (serie nacional). Devengado/girado inválidos se omiten.
  const flujo: FlujoFases | null = useMemo(() => {
    if (!fila) return null
    const dev = devengadoONull(year, fila.devengado)
    const gir = devengadoONull(year, fila.girado)
    return {
      pia: fila.pia, pim: fila.pim, certificado: fila.certificado,
      devengado: dev ?? NaN, girado: gir ?? NaN,
    }
  }, [fila, year])
  return (
    <Card>
      <CardHeader
        title={`Flujo de fases ${year}`}
        subtitle="PIA → PIM → Certificado → Devengado → Girado"
        help={
          <span>
            Diagrama de flujo: el <strong>ancho de cada banda = monto en soles</strong>. Se lee de
            izquierda a derecha cómo el presupuesto avanza por las fases. El estrechamiento entre
            etapas muestra cuánto <strong>no</strong> llegó a la siguiente fase (lo no
            comprometido / no ejecutado). Mismas cifras que los KPIs de arriba.
          </span>
        }
      />
      <div className="px-4 pb-4">
        {cargando ? <Loading /> : !flujo ? <DetalleNoDisponible year={year} rangoDetalle={rangoDetalle} /> : (
          <SankeyChart f={flujo} />
        )}
      </div>
    </Card>
  )
}

function SankeyChart({ f }: { f: FlujoFases }) {
  // Cadena de fases en orden; omite Certificado si no viene.
  const chain: { key: keyof FlujoFases; name: string }[] = [
    { key: 'pia', name: 'PIA' },
    { key: 'pim', name: 'PIM' },
    ...(f.certificado != null ? [{ key: 'certificado' as const, name: 'Certificado' }] : []),
    // Devengado/girado sin dato (NaN: año < DEVENGADO_DESDE) no entran al flujo.
    ...(Number.isFinite(f.devengado) ? [{ key: 'devengado' as const, name: 'Devengado' }] : []),
    ...(Number.isFinite(f.girado) && Number.isFinite(f.devengado) ? [{ key: 'girado' as const, name: 'Girado' }] : []),
  ]
  const nodes = chain.map((c) => ({ name: c.name }))
  const links = chain.slice(0, -1).map((c, i) => ({
    source: c.name,
    target: chain[i + 1].name,
    // El flujo hacia la siguiente fase = monto de esa siguiente fase (lo que efectivamente avanzó)
    value: Math.max(0, Number(f[chain[i + 1].key]) || 0),
  }))

  const option: EChartsOption = {
    tooltip: {
      trigger: 'item',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      formatter: (p: any) => {
        if (p.dataType === 'edge') return `${p.data.source} → ${p.data.target}<br><b>${solesCompact(p.data.value)}</b>`
        return `<b>${p.name}</b>`
      },
    },
    series: [
      {
        type: 'sankey',
        left: 8, right: 80, top: 10, bottom: 10,
        emphasis: { focus: 'adjacency' },
        nodeWidth: 14,
        nodeGap: 14,
        lineStyle: { color: 'gradient', opacity: 0.45 },
        label: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          formatter: (p: any) => {
            const node = chain.find((c) => c.name === p.name)
            const v = node ? Number(f[node.key]) || 0 : 0
            return `${p.name}\n${solesCompact(v)}`
          },
          fontSize: 11,
        },
        data: nodes,
        links,
      },
    ],
  }
  return <Chart option={option} height={320} />
}

/* ───────────────────────── 5. Treemap por función ───────────────────────── */

function TreemapFuncion({ funcion, year, rangoDetalle }: { funcion: ReturnType<typeof useAsync<PorFuncion[]>>; year: number; rangoDetalle: string }) {
  return (
    <Card>
      <CardHeader
        title={`Presupuesto por función ${year}`}
        subtitle="Área = PIM por función"
        help={
          <span>
            Cada rectángulo es una <strong>función</strong> del gasto (educación, salud,
            transporte…). El <strong>área es proporcional al PIM</strong> asignado. El tooltip
            muestra el PIM y su % de ejecución (devengado/PIM).
          </span>
        }
      />
      <div className="px-4 pb-4">
        {funcion.loading && !funcion.data ? <Loading /> : funcion.error ? <DetalleNoDisponible year={year} rangoDetalle={rangoDetalle} /> : !funcion.data ? <Loading /> : (
          <TreemapChart data={funcion.data} />
        )}
      </div>
    </Card>
  )
}

function TreemapChart({ data }: { data: PorFuncion[] }) {
  const items = [...data]
    .filter((d) => (d.pim || 0) > 0)
    .sort((a, b) => b.pim - a.pim)
    .map((d, i) => {
      const frac = ejecucion(d.devengado, d.pim)
      return {
        name: d.funcion,
        value: d.pim,
        ejec: frac,
        itemStyle: { color: ['#14b8a6', '#0ea5e9', '#818cf8', '#f472b6', '#fb923c', '#a3e635', '#34d399', '#c084fc', '#fbbf24', '#f87171'][i % 10] },
      }
    })

  const option: EChartsOption = {
    tooltip: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      formatter: (p: any) => {
        const frac = p.data?.ejec as number
        return `<b>${p.name}</b><br>PIM: <b>${solesCompact(p.value as number)}</b><br>Ejecución: <b>${pct(frac)}</b>`
      },
    },
    series: [
      {
        type: 'treemap',
        roam: false,
        nodeClick: false,
        breadcrumb: { show: false },
        label: { show: true, formatter: '{b}', fontSize: 11, overflow: 'truncate' },
        upperLabel: { show: false },
        itemStyle: { borderColor: 'transparent', gapWidth: 2 },
        data: items,
      },
    ],
  }
  return <Chart option={option} height={320} />
}

/* ───────────────────────── 6. Ranking por sector ───────────────────────── */

function RankingSector({ sector, year, rangoDetalle }: { sector: ReturnType<typeof useAsync<PorSector[]>>; year: number; rangoDetalle: string }) {
  return (
    <Card>
      <CardHeader
        title={`Ranking por sector ${year}`}
        subtitle="Top 15 por PIM · color = % ejecución"
        help={
          <span>
            Barras del PIM asignado por sector (entidad rectora). El <strong>color</strong> indica
            la ejecución (rojo &lt;50%, ámbar 50–80%, verde &gt;80%). Recuerda: <strong>PIM ≠
            gasto</strong>; lo gastado es el devengado, que ves en el tooltip.
          </span>
        }
      />
      <div className="px-4 pb-4">
        {sector.loading && !sector.data ? <Loading /> : sector.error ? <DetalleNoDisponible year={year} rangoDetalle={rangoDetalle} /> : !sector.data ? <Loading /> : (
          <SectorChart data={sector.data} />
        )}
      </div>
    </Card>
  )
}

function SectorChart({ data }: { data: PorSector[] }) {
  const top = [...data]
    .filter((d) => (d.pim || 0) > 0)
    .sort((a, b) => b.pim - a.pim)
    .slice(0, 15)
    .reverse() // para que el mayor quede arriba en barra horizontal

  const cats = top.map((d) => d.sector)
  const vals = top.map((d) => ({
    value: d.pim,
    devengado: d.devengado,
    ejec: ejecucion(d.devengado, d.pim),
    itemStyle: { color: colorEjec(ejecucion(d.devengado, d.pim)), borderRadius: [0, 4, 4, 0] },
  }))

  const option: EChartsOption = {
    tooltip: {
      trigger: 'item',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      formatter: (p: any) => {
        const d = p.data
        return `<b>${p.name}</b><br>PIM: <b>${solesCompact(d.value)}</b><br>Devengado: <b>${solesCompact(d.devengado)}</b><br>Ejecución: <b>${pct(d.ejec)}</b>`
      },
    },
    grid: { left: 8, right: 60, top: 8, bottom: 8, containLabel: true },
    xAxis: { type: 'value', axisLabel: { formatter: (v: number) => solesCompact(v), fontSize: 10 } },
    yAxis: { type: 'category', data: cats, axisLabel: { fontSize: 10, width: 120, overflow: 'truncate' } },
    series: [
      {
        type: 'bar',
        data: vals,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        label: { show: true, position: 'right', fontSize: 10, formatter: (p: any) => solesCompact(p.value) },
      },
    ],
  }
  return <Chart option={option} height={Math.max(320, top.length * 26)} />
}
