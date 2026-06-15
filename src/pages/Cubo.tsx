import { useMemo, useState } from 'react'
import { getMeta, getPorDistrito, getGeoJSON, loadJSON } from '../lib/data'
import type { Meta, PorDistrito, IndicadorDistrito, RiesgosData } from '../lib/types'
import { useAsync } from '../lib/useAsync'
import { clasificarPiso, TODOS_PISOS } from '../lib/pisos'
import { soles, solesCompact, num, pct } from '../lib/format'
import { Card, CardHeader, HelpTip, KPI, Pill, Select, Loading, ErrorBox, SectionIntro } from '../components/ui'
import { Chart } from '../components/Chart'
import MapaDistrital, { type MapValue } from '../components/MapaDistrital'
import CuboPivotView from '../components/CuboPivot'

// ───────────────────────── Cubo Presupuestal ─────────────────────────
// Cruza, por distrito (ubigeo 6 díg), cuatro dimensiones que el MEF NO integra:
//   presupuesto (PIM por distrito, API VPS) × pobreza/IDH (PNUD 2019 / INEI) ×
//   piso altitudinal (Pulgar Vidal por altitud de capital) × riesgo climático
//   (combinación de heladas/sequía/inundaciones/huaicos a nivel departamental).
// Cada filtro tiene la opción "indiferente". El resultado son los distritos que
// cumplen TODOS los criterios activos a la vez (la intersección = "el cubo").

// ── Tipos de filtro ──
type Tri = 'all' | 'baja' | 'media' | 'alta'
type IdhSel = 'all' | 'bajo' | 'medio' | 'alto'
type RiesgoSel = 'all' | 'alto'
// OJO: los valores deben coincidir EXACTO con r.nivel de la data (plural en locales/regionales).
type NivelSel = 'Todos' | 'GOBIERNOS LOCALES' | 'GOBIERNOS REGIONALES' | 'GOBIERNO NACIONAL'

interface Filtros {
  pobreza: Tri
  idh: IdhSel
  piso: string // id de piso o 'all'
  perCapita: Tri
  riesgoClim: RiesgoSel
  nivel: NivelSel
}

const FILTROS_INICIALES: Filtros = {
  pobreza: 'all',
  idh: 'all',
  piso: 'all',
  perCapita: 'all',
  riesgoClim: 'all',
  nivel: 'GOBIERNOS LOCALES',
}

// Umbrales fijos y transparentes para pobreza e IDH (los per cápita van por terciles)
const POBREZA_ALTA = 40 // %
const POBREZA_BAJA = 20 // %
const IDH_BAJO = 25 // IDH 0-100
const IDH_ALTO = 50

// Riesgos climáticos que combinamos (los que existen en riesgos.json)
const RIESGOS_CLIMA = ['heladas', 'sequia', 'inundaciones', 'huaicos', 'friajes', 'nino'] as const
const NIVEL_VAL: Record<'alta' | 'media' | 'baja', number> = { alta: 3, media: 2, baja: 1 }

// Registro unificado por distrito (el "cubo")
interface FilaCubo {
  ubigeo: string
  nombre: string
  depto: string
  iddpto: string
  pim: number
  pob: number | null
  pimPerCapita: number | null
  idh: number | null
  pobreza: number | null
  pobrezaExt: number | null
  altitud: number | null
  pisoId: string | null
  pisoNombre: string | null
  pisoColor: string
  riesgoClim: 'alta' | 'media' | 'baja' | null
}

const PRESETS: { id: string; label: string; tone: 'brand' | 'warn'; filtros: Partial<Filtros> }[] = [
  {
    id: 'pobre_subfin',
    label: 'Alta pobreza + baja inversión',
    tone: 'brand',
    filtros: { pobreza: 'alta', perCapita: 'baja' },
  },
  {
    id: 'puna_subfin',
    label: 'Puna subfinanciada',
    tone: 'brand',
    filtros: { piso: 'puna', perCapita: 'baja' },
  },
  {
    id: 'vuln_pobre_subfin',
    label: 'Alta vulnerabilidad + alta pobreza + baja inversión',
    tone: 'brand',
    filtros: { riesgoClim: 'alto', pobreza: 'alta', perCapita: 'baja' },
  },
  {
    id: 'selva_idh',
    label: 'Selva amazónica + bajo IDH',
    tone: 'brand',
    filtros: { piso: 'selva_baja', idh: 'bajo' },
  },
]

export default function Cubo() {
  const metaQ = useAsync<Meta>(getMeta, [])
  const [year, setYear] = useState<number>(2025)

  const geoQ = useAsync(() => getGeoJSON(), [])
  const indQ = useAsync(() => loadJSON<IndicadorDistrito[]>('indicadores-distrito.json'), [])
  const riesgoQ = useAsync(() => loadJSON<RiesgosData>('riesgos.json'), [])
  const distQ = useAsync<PorDistrito[]>(() => getPorDistrito(year), [year])

  const [filtros, setFiltros] = useState<Filtros>(FILTROS_INICIALES)
  const [seleccionado, setSeleccionado] = useState<string | undefined>(undefined)
  const [sortKey, setSortKey] = useState<SortKey>('pimPerCapita')
  const [sortAsc, setSortAsc] = useState<boolean>(true)
  const [presetActivo, setPresetActivo] = useState<string | null>(null)

  function set<K extends keyof Filtros>(k: K, v: Filtros[K]) {
    setFiltros((f) => ({ ...f, [k]: v }))
    setPresetActivo(null)
  }

  function aplicarPreset(p: (typeof PRESETS)[number]) {
    setFiltros({ ...FILTROS_INICIALES, ...p.filtros })
    setPresetActivo(p.id)
  }

  // ── Nombre/depto/iddpto por ubigeo desde el geojson ──
  const nombres = useMemo(() => {
    const m = new Map<string, { nombre: string; depto: string; iddpto: string }>()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const feats = (geoQ.data as any)?.features as any[] | undefined
    if (!feats) return m
    for (const f of feats) {
      const p = f.properties
      m.set(p.IDDIST, { nombre: p.NOMBDIST, depto: p.NOMBDEP, iddpto: p.IDDPTO })
    }
    return m
  }, [geoQ.data])

  // ── Indicadores por ubigeo ──
  const indPorUbigeo = useMemo(() => {
    const m = new Map<string, IndicadorDistrito>()
    if (!indQ.data) return m
    for (const d of indQ.data) m.set(d.ubigeo, d)
    return m
  }, [indQ.data])

  // ── Riesgo climático combinado por departamento (ubigeo 2 díg) ──
  const climaPorDpto = useMemo(() => {
    const m = new Map<string, 'alta' | 'media' | 'baja'>()
    if (!riesgoQ.data) return m
    for (const r of riesgoQ.data.regions) {
      let maxLvl = 0
      for (const k of RIESGOS_CLIMA) {
        const n = r.risks[k] as 'alta' | 'media' | 'baja' | undefined
        if (n && NIVEL_VAL[n] > maxLvl) maxLvl = NIVEL_VAL[n]
      }
      if (maxLvl > 0) {
        const lvl = maxLvl === 3 ? 'alta' : maxLvl === 2 ? 'media' : 'baja'
        m.set(r.ubigeo, lvl)
      }
    }
    return m
  }, [riesgoQ.data])

  // ── Construye el cubo: PIM agregado por ubigeo (filtrado por nivel) + indicadores ──
  const cubo = useMemo<FilaCubo[]>(() => {
    if (!distQ.data) return []
    // Agrega PIM por ubigeo respetando el filtro de nivel de gobierno
    const pimPorUbigeo = new Map<string, number>()
    for (const r of distQ.data) {
      if (filtros.nivel !== 'Todos' && r.nivel !== filtros.nivel) continue
      pimPorUbigeo.set(r.ubigeo, (pimPorUbigeo.get(r.ubigeo) ?? 0) + (r.pim || 0))
    }
    const out: FilaCubo[] = []
    for (const [ubigeo, pim] of pimPorUbigeo) {
      const geo = nombres.get(ubigeo)
      const ind = indPorUbigeo.get(ubigeo)
      const depto = geo?.depto ?? ''
      const iddpto = geo?.iddpto ?? ubigeo.slice(0, 2)
      const altitud = ind?.altitud ?? null
      const piso = clasificarPiso(altitud ?? undefined, depto)
      const pob = ind && Number.isFinite(ind.pob) && ind.pob > 0 ? ind.pob : null
      out.push({
        ubigeo,
        nombre: geo?.nombre ?? ubigeo,
        depto: depto || '—',
        iddpto,
        pim,
        pob,
        pimPerCapita: pob != null ? pim / pob : null,
        idh: ind?.idh ?? null,
        pobreza: ind?.pobreza ?? null,
        pobrezaExt: ind?.pobrezaExt ?? null,
        altitud,
        pisoId: piso?.id ?? null,
        pisoNombre: piso?.nombre ?? null,
        pisoColor: piso?.color ?? '#94a3b8',
        riesgoClim: climaPorDpto.get(iddpto) ?? null,
      })
    }
    return out
  }, [distQ.data, filtros.nivel, nombres, indPorUbigeo, climaPorDpto])

  // ── Terciles de PIM per cápita (sobre distritos con dato del universo actual) ──
  const terciles = useMemo(() => {
    const vals = cubo
      .map((c) => c.pimPerCapita)
      .filter((v): v is number => v != null && Number.isFinite(v))
      .sort((a, b) => a - b)
    if (vals.length === 0) return null
    const q = (p: number) => vals[Math.min(vals.length - 1, Math.floor(p * vals.length))]
    return { t1: q(1 / 3), t2: q(2 / 3) } // <t1 baja, t1..t2 media, >t2 alta
  }, [cubo])

  // ── Aplica los filtros: un distrito "cumple" si pasa TODOS los criterios activos ──
  function cumple(c: FilaCubo): boolean {
    // Pobreza
    if (filtros.pobreza !== 'all') {
      if (c.pobreza == null) return false
      if (filtros.pobreza === 'alta' && !(c.pobreza > POBREZA_ALTA)) return false
      if (filtros.pobreza === 'baja' && !(c.pobreza < POBREZA_BAJA)) return false
      if (filtros.pobreza === 'media' && !(c.pobreza >= POBREZA_BAJA && c.pobreza <= POBREZA_ALTA)) return false
    }
    // IDH
    if (filtros.idh !== 'all') {
      if (c.idh == null) return false
      if (filtros.idh === 'bajo' && !(c.idh < IDH_BAJO)) return false
      if (filtros.idh === 'alto' && !(c.idh > IDH_ALTO)) return false
      if (filtros.idh === 'medio' && !(c.idh >= IDH_BAJO && c.idh <= IDH_ALTO)) return false
    }
    // Piso
    if (filtros.piso !== 'all') {
      if (c.pisoId !== filtros.piso) return false
    }
    // Per cápita (terciles)
    if (filtros.perCapita !== 'all') {
      if (c.pimPerCapita == null || !terciles) return false
      if (filtros.perCapita === 'baja' && !(c.pimPerCapita < terciles.t1)) return false
      if (filtros.perCapita === 'media' && !(c.pimPerCapita >= terciles.t1 && c.pimPerCapita <= terciles.t2)) return false
      if (filtros.perCapita === 'alta' && !(c.pimPerCapita > terciles.t2)) return false
    }
    // Riesgo climático
    if (filtros.riesgoClim === 'alto') {
      if (c.riesgoClim !== 'alta') return false
    }
    return true
  }

  const cumplen = useMemo(
    () => cubo.filter(cumple),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cubo, filtros, terciles],
  )
  const cumplenSet = useMemo(() => new Set(cumplen.map((c) => c.ubigeo)), [cumplen])

  // ── KPIs del resultado ──
  const kpis = useMemo(() => {
    let pob = 0
    let pim = 0
    let conPob = 0
    let sumPercap = 0
    let conPercap = 0
    for (const c of cumplen) {
      pim += c.pim
      if (c.pob != null) {
        pob += c.pob
        conPob += 1
      }
      if (c.pimPerCapita != null) {
        sumPercap += c.pimPerCapita
        conPercap += 1
      }
    }
    return {
      n: cumplen.length,
      pob,
      conPob,
      pim,
      percapProm: conPercap > 0 ? sumPercap / conPercap : null,
    }
  }, [cumplen])

  // ── Valores del mapa: resalta solo los que cumplen ──
  const mapValues = useMemo(() => {
    const m = new Map<string, MapValue>()
    for (const c of cubo) {
      const hit = cumplenSet.has(c.ubigeo)
      m.set(c.ubigeo, {
        value: hit ? 1 : 0,
        color: hit ? '#f43f5e' : 'rgba(100,116,139,.18)',
        label: hit
          ? `${c.nombre} · cumple el cruce${c.pimPerCapita != null ? ` · ${soles(c.pimPerCapita)}/hab` : ''}`
          : `${c.nombre}`,
      })
    }
    return m
  }, [cubo, cumplenSet])

  // ── Tabla ordenada (cap 200) ──
  const filasTabla = useMemo(() => {
    const arr = [...cumplen]
    arr.sort((a, b) => {
      const av = valorSort(a, sortKey)
      const bv = valorSort(b, sortKey)
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      if (typeof av === 'string' && typeof bv === 'string') {
        return sortAsc ? av.localeCompare(bv, 'es') : bv.localeCompare(av, 'es')
      }
      return sortAsc ? (av as number) - (bv as number) : (bv as number) - (av as number)
    })
    return arr
  }, [cumplen, sortKey, sortAsc])
  const filasVisibles = filasTabla.slice(0, 200)

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortAsc((s) => !s)
    else {
      setSortKey(k)
      setSortAsc(k === 'nombre' || k === 'depto' || k === 'piso')
    }
  }

  // ── Dispersión: pobreza (x) vs PIM per cápita (y), resaltando los que cumplen ──
  const scatterOption = useMemo(() => {
    const conData = cubo.filter(
      (c) => c.pobreza != null && c.pimPerCapita != null && Number.isFinite(c.pimPerCapita),
    )
    const cumplenPts = conData
      .filter((c) => cumplenSet.has(c.ubigeo))
      .map((c) => ({ value: [c.pobreza, c.pimPerCapita, c.pob ?? 0], name: c.nombre }))
    const restoPts = conData
      .filter((c) => !cumplenSet.has(c.ubigeo))
      .map((c) => ({ value: [c.pobreza, c.pimPerCapita, c.pob ?? 0], name: c.nombre }))
    const fmt = (p: { value: number[]; name: string }) =>
      `${p.name}<br/>Pobreza: ${pct((p.value[0] ?? 0) / 100)}<br/>PIM/hab: ${soles(p.value[1] ?? 0)}<br/>Población: ${num(p.value[2] ?? 0)}`
    return {
      legend: { data: ['Cumple el cruce', 'Resto'], top: 0 },
      tooltip: { trigger: 'item', formatter: fmt },
      xAxis: { name: 'Pobreza (%)', type: 'value', min: 0 },
      yAxis: { name: 'PIM / hab (S/)', type: 'value', min: 0 },
      series: [
        {
          name: 'Resto',
          type: 'scatter',
          data: restoPts,
          symbolSize: 5,
          itemStyle: { color: 'rgba(148,163,184,.35)' },
        },
        {
          name: 'Cumple el cruce',
          type: 'scatter',
          data: cumplenPts,
          symbolSize: 8,
          itemStyle: { color: '#f43f5e', opacity: 0.85 },
        },
      ],
    }
  }, [cubo, cumplenSet])

  // ── Frase interpretativa honesta ──
  const frase = useMemo(() => {
    if (kpis.n === 0) return 'Ningún distrito cumple simultáneamente todos los criterios elegidos. Relaja algún filtro o prueba un preset.'
    const partes: string[] = []
    if (filtros.pobreza === 'alta') partes.push('alta pobreza')
    if (filtros.riesgoClim === 'alto') partes.push('alta vulnerabilidad climática')
    if (filtros.idh === 'bajo') partes.push('bajo desarrollo humano')
    if (filtros.piso !== 'all') {
      const p = TODOS_PISOS.find((x) => x.id === filtros.piso)
      if (p) partes.push(`piso ${p.nombre}`)
    }
    const cond = partes.length ? partes.join(', ').replace(/, ([^,]*)$/, ' y $1') : 'los criterios elegidos'
    const percap = kpis.percapProm != null ? ` y reciben en promedio ${soles(kpis.percapProm)} de PIM por habitante` : ''
    const subfin = filtros.perCapita === 'baja' ? ' — la menor inversión per cápita del país' : ''
    return `Estos ${num(kpis.n)} distritos concentran ${cond}${percap}${subfin}. Suman ${num(kpis.pob)} habitantes y un PIM total de ${solesCompact(kpis.pim)}.`
  }, [kpis, filtros])

  // ───────── Estados ─────────
  const loading = metaQ.loading || geoQ.loading || indQ.loading || riesgoQ.loading || distQ.loading
  if (loading) return <Loading label="Cargando el cubo presupuestal…" />
  if (geoQ.error) return <ErrorBox error={geoQ.error} />
  if (indQ.error) return <ErrorBox error={indQ.error} />
  if (riesgoQ.error) return <ErrorBox error={riesgoQ.error} />
  if (distQ.error) return <ErrorBox error={`No se pudo cargar el presupuesto distrital ${year}: ${distQ.error}`} />
  if (!geoQ.data || !indQ.data || !riesgoQ.data || !distQ.data) return <Loading />

  // Solo años con detalle distrital (los demás darían 0 en el cruce).
  const distYears = metaQ.data?.distritoYears?.length ? metaQ.data.distritoYears : [2025]
  const yearOpts = [...distYears].sort((a, b) => b - a).map((y) => ({ value: y, label: String(y) }))
  const pisoOpts = [{ value: 'all', label: 'Indiferente' }, ...TODOS_PISOS.map((p) => ({ value: p.id, label: p.nombre }))]
  const ficha = cubo.find((c) => c.ubigeo === seleccionado)

  return (
    <div className="space-y-6">
      <SectionIntro title="Cubo Presupuestal">
        El diferencial estrella del observatorio. Cruza, por distrito y a la vez,{' '}
        <strong>presupuesto × pobreza × desarrollo humano × piso altitudinal × riesgo climático</strong> — una
        intersección que el MEF publica por separado y nunca integra. Define un perfil de territorio y el cubo te
        devuelve exactamente los distritos que lo cumplen.
      </SectionIntro>

      <div className="flex flex-wrap items-center gap-2">
        <Pill tone="brand">diferencial estrella</Pill>
        <Pill tone="warn">aprox.</Pill>
        <span className="text-sm text-slate-500 dark:text-slate-400">
          Presupuesto: PIM por ejecutora con ubigeo del distrito (API MEF vía VPS), agregado por distrito. Indicadores:
          IDH PNUD 2019 y pobreza INEI por distrito. Riesgo climático: nivel departamental (heladas, sequía,
          inundaciones, huaicos, friajes, El Niño). Piso altitudinal por altitud de la capital.
        </span>
      </div>

      {/* ── 0. Pivote OLAP en vivo (cruce arbitrario contra la API) ── */}
      <CuboPivotView years={distYears} />

      {/* ── 1. Presets ── */}
      <Card>
        <CardHeader
          title="Casos de uso (presets)"
          subtitle="Un clic activa varios filtros a la vez"
          help={
            <HelpTip>
              Cada chip configura el panel de filtros para responder una pregunta de política concreta. Luego puedes
              ajustar cualquier filtro manualmente. El cruce siempre exige cumplir <strong>todos</strong> los criterios
              activos a la vez.
            </HelpTip>
          }
        />
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => aplicarPreset(p)}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                presetActivo === p.id
                  ? 'border-rose-400 bg-rose-500/15 text-rose-600 dark:text-rose-300'
                  : 'border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-rose-400'
              }`}
            >
              {p.label}
            </button>
          ))}
          <button
            onClick={() => {
              setFiltros(FILTROS_INICIALES)
              setPresetActivo(null)
            }}
            className="rounded-full border border-dashed border-slate-300 dark:border-slate-700 px-3 py-1.5 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          >
            Limpiar filtros
          </button>
        </div>
      </Card>

      {/* ── 2. Panel de filtros (el corazón del cubo) ── */}
      <Card>
        <CardHeader
          title="Panel de filtros"
          subtitle="Cada eje del cubo, con opción “indiferente”"
          help={
            <HelpTip>
              Umbrales: pobreza alta &gt;40%, baja &lt;20% (INEI). IDH bajo &lt;25, alto &gt;50 (0–100). La inversión
              per cápita (PIM/hab) se clasifica por <strong>terciles</strong> del universo filtrado, así “baja/media/alta”
              es siempre relativo a los distritos comparables. El riesgo climático combina varios peligros a nivel
              departamental y toma el más severo.
            </HelpTip>
          }
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          <Select label="Año" value={year} onChange={(v) => setYear(Number(v))} options={yearOpts} />
          <Select
            label="Pobreza monetaria"
            value={filtros.pobreza}
            onChange={(v) => set('pobreza', v as Tri)}
            options={[
              { value: 'all', label: 'Indiferente' },
              { value: 'alta', label: 'Alta (>40%)' },
              { value: 'media', label: 'Media (20–40%)' },
              { value: 'baja', label: 'Baja (<20%)' },
            ]}
          />
          <Select
            label="Desarrollo humano (IDH)"
            value={filtros.idh}
            onChange={(v) => set('idh', v as IdhSel)}
            options={[
              { value: 'all', label: 'Indiferente' },
              { value: 'bajo', label: 'Bajo (<25)' },
              { value: 'medio', label: 'Medio (25–50)' },
              { value: 'alto', label: 'Alto (>50)' },
            ]}
          />
          <Select label="Piso altitudinal" value={filtros.piso} onChange={(v) => set('piso', String(v))} options={pisoOpts} />
          <Select
            label="Inversión per cápita (PIM/hab)"
            value={filtros.perCapita}
            onChange={(v) => set('perCapita', v as Tri)}
            options={[
              { value: 'all', label: 'Indiferente' },
              { value: 'baja', label: 'Baja (tercil inferior)' },
              { value: 'media', label: 'Media (tercil medio)' },
              { value: 'alta', label: 'Alta (tercil superior)' },
            ]}
          />
          <Select
            label="Riesgo climático"
            value={filtros.riesgoClim}
            onChange={(v) => set('riesgoClim', v as RiesgoSel)}
            options={[
              { value: 'all', label: 'Indiferente' },
              { value: 'alto', label: 'Alto (departamental)' },
            ]}
          />
          <Select
            label="Nivel de gobierno"
            value={filtros.nivel}
            onChange={(v) => set('nivel', v as NivelSel)}
            options={[
              { value: 'GOBIERNOS LOCALES', label: 'Gobiernos locales (recomendado)' },
              { value: 'GOBIERNOS REGIONALES', label: 'Gobiernos regionales' },
              { value: 'GOBIERNO NACIONAL', label: 'Gobierno nacional' },
              { value: 'Todos', label: 'Todos los niveles' },
            ]}
          />
        </div>
        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
          Para lectura territorial recomendamos <strong>Gobiernos locales</strong>: aproxima el gasto ejecutado en el
          propio distrito. Otros niveles incluyen ejecutoras con sede en el distrito pero alcance mayor.
        </p>
      </Card>

      {/* ── 3. Resultado: KPIs ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <KPI label="Distritos que cumplen el cruce" value={num(kpis.n)} sub={`de ${num(cubo.length)} con presupuesto ${year}`} accent />
        <KPI
          label="Población afectada"
          value={num(kpis.pob)}
          sub={kpis.conPob < kpis.n ? `${num(kpis.conPob)} de ${num(kpis.n)} con dato de población` : 'habitantes'}
        />
        <KPI
          label="PIM total que reciben"
          value={solesCompact(kpis.pim)}
          sub={kpis.percapProm != null ? `≈ ${soles(kpis.percapProm)} / hab (promedio)` : 'sin per cápita'}
        />
      </div>

      {/* Frase interpretativa */}
      <Card className="border-rose-300/60 dark:border-rose-500/30">
        <p className="text-sm text-slate-700 dark:text-slate-200">
          <strong className="text-rose-600 dark:text-rose-300">Lectura: </strong>
          {frase}
        </p>
      </Card>

      {/* ── 4. Mapa ── */}
      <Card>
        <CardHeader
          title="Mapa del cruce"
          subtitle="Resaltados los distritos que cumplen; el resto, tenue"
          help={
            <HelpTip>
              Los distritos en <span className="text-rose-500 font-semibold">rojo</span> cumplen simultáneamente todos
              los filtros activos. El resto del país queda atenuado para que la intersección destaque. Toca un distrito
              resaltado para ver su ficha. No es un ranking: es pertenencia (sí/no) al perfil definido.
            </HelpTip>
          }
        />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2">
            <MapaDistrital
              geojson={geoQ.data}
              values={mapValues}
              unitLabel="cruce"
              formatValue={(v) => (v >= 1 ? 'Cumple' : '—')}
              max={1}
              colorScale={(v) => (v >= 1 ? '#f43f5e' : 'rgba(100,116,139,.18)')}
              onSelect={(ubigeo) => setSeleccionado(ubigeo)}
              selected={seleccionado}
              height={520}
            />
          </div>
          <div>
            {ficha ? (
              <FichaDistrito d={ficha} cumple={cumplenSet.has(ficha.ubigeo)} />
            ) : (
              <div className="h-full flex items-center justify-center rounded-lg border border-dashed border-slate-300 dark:border-slate-700 p-6 text-center text-sm text-slate-500 dark:text-slate-400">
                Selecciona un distrito en el mapa para ver su ficha (presupuesto, pobreza, IDH, piso y riesgo).
              </div>
            )}
          </div>
        </div>
      </Card>

      {/* ── 5. Dispersión pobreza vs PIM per cápita ── */}
      <Card>
        <CardHeader
          title="Pobreza vs inversión per cápita"
          subtitle="Cada punto es un distrito; en rojo, los que cumplen el cruce"
          help={
            <HelpTip>
              Eje X = pobreza monetaria (más a la derecha, más pobre). Eje Y = PIM por habitante (más arriba, más
              inversión). Lo equitativo sería que los distritos más pobres tuvieran <em>más</em> inversión por persona;
              los puntos rojos abajo-derecha son territorios pobres y subfinanciados. El tamaño no codifica nada aquí;
              pasa el cursor para ver la población.
            </HelpTip>
          }
        />
        <Chart option={scatterOption} height={460} />
      </Card>

      {/* ── 6. Tabla ── */}
      <Card>
        <CardHeader
          title={`Distritos que cumplen (${num(cumplen.length)})`}
          subtitle="Ordena por cualquier columna"
          help={
            <HelpTip>
              Lista de los distritos que pasan todos los filtros. Haz clic en un encabezado para ordenar. PIM/hab usa la
              población distrital (INEI); los distritos sin población no entran en per cápita. Se muestran hasta 200
              filas.
            </HelpTip>
          }
          right={<Pill tone="neutral">{num(cumplen.length)} distritos</Pill>}
        />
        {cumplen.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">
            Ningún distrito cumple este cruce. Relaja un filtro o prueba un preset.
          </p>
        ) : (
          <>
            <TablaCubo filas={filasVisibles} sortKey={sortKey} sortAsc={sortAsc} onSort={toggleSort} />
            {filasTabla.length > 200 && (
              <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                Mostrando 200 de {num(filasTabla.length)} distritos. Afina los filtros para ver el conjunto completo.
              </p>
            )}
          </>
        )}
      </Card>
    </div>
  )
}

// ───────────────────────── Tabla ─────────────────────────

type SortKey = 'nombre' | 'depto' | 'pobreza' | 'idh' | 'piso' | 'pimPerCapita' | 'riesgo'

function valorSort(c: FilaCubo, k: SortKey): number | string | null {
  switch (k) {
    case 'nombre':
      return c.nombre
    case 'depto':
      return c.depto
    case 'pobreza':
      return c.pobreza
    case 'idh':
      return c.idh
    case 'piso':
      return c.pisoNombre
    case 'pimPerCapita':
      return c.pimPerCapita
    case 'riesgo':
      return c.riesgoClim ? NIVEL_VAL[c.riesgoClim] : null
  }
}

function flecha(active: boolean, asc: boolean): string {
  if (!active) return ''
  return asc ? ' ▲' : ' ▼'
}

function TablaCubo({
  filas,
  sortKey,
  sortAsc,
  onSort,
}: {
  filas: FilaCubo[]
  sortKey: SortKey
  sortAsc: boolean
  onSort: (k: SortKey) => void
}) {
  const Th = ({ k, children, align = 'left' }: { k: SortKey; children: React.ReactNode; align?: 'left' | 'right' }) => (
    <th
      className={`py-2 pr-2 cursor-pointer select-none whitespace-nowrap hover:text-slate-700 dark:hover:text-slate-200 ${
        align === 'right' ? 'text-right' : 'text-left'
      } ${sortKey === k ? 'text-slate-700 dark:text-slate-200' : ''}`}
      onClick={() => onSort(k)}
    >
      {children}
      {flecha(sortKey === k, sortAsc)}
    </th>
  )
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
            <Th k="nombre">Distrito</Th>
            <Th k="depto">Departamento</Th>
            <Th k="pobreza" align="right">Pobreza</Th>
            <Th k="idh" align="right">IDH</Th>
            <Th k="piso">Piso</Th>
            <Th k="pimPerCapita" align="right">PIM/hab</Th>
            <Th k="riesgo" align="right">Riesgo clim.</Th>
          </tr>
        </thead>
        <tbody>
          {filas.map((c) => (
            <tr key={c.ubigeo} className="border-b border-slate-100 dark:border-slate-800">
              <td className="py-1.5 pr-2 font-medium text-slate-800 dark:text-slate-100">{c.nombre}</td>
              <td className="py-1.5 pr-2 text-slate-500 dark:text-slate-400">{c.depto}</td>
              <td className="py-1.5 pr-2 text-right tabular-nums">{c.pobreza != null ? pct(c.pobreza / 100) : '—'}</td>
              <td className="py-1.5 pr-2 text-right tabular-nums">{c.idh != null ? c.idh.toFixed(1) : '—'}</td>
              <td className="py-1.5 pr-2">
                {c.pisoNombre ? (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: c.pisoColor }} />
                    {c.pisoNombre}
                  </span>
                ) : (
                  '—'
                )}
              </td>
              <td className="py-1.5 pr-2 text-right tabular-nums">{c.pimPerCapita != null ? soles(c.pimPerCapita) : '—'}</td>
              <td className="py-1.5 pr-2 text-right">{c.riesgoClim ? <RiesgoPill nivel={c.riesgoClim} /> : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function RiesgoPill({ nivel }: { nivel: 'alta' | 'media' | 'baja' }) {
  const tone = nivel === 'alta' ? 'warn' : nivel === 'media' ? 'neutral' : 'good'
  const txt = nivel === 'alta' ? 'Alto' : nivel === 'media' ? 'Medio' : 'Bajo'
  return <Pill tone={tone}>{txt}</Pill>
}

// ───────────────────────── Ficha ─────────────────────────

function FichaDistrito({ d, cumple }: { d: FilaCubo; cumple: boolean }) {
  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h4 className="font-semibold text-slate-800 dark:text-slate-100">{d.nombre}</h4>
          <p className="text-xs text-slate-500 dark:text-slate-400">{d.depto}</p>
        </div>
        {cumple ? <Pill tone="brand">cumple el cruce</Pill> : <Pill tone="neutral">fuera del cruce</Pill>}
      </div>
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <Dato label="PIM (nivel filtrado)" valor={solesCompact(d.pim)} />
        <Dato label="PIM / hab" valor={d.pimPerCapita != null ? soles(d.pimPerCapita) : '—'} />
        <Dato label="Población" valor={d.pob != null ? num(d.pob) : '—'} />
        <Dato label="Pobreza" valor={d.pobreza != null ? pct(d.pobreza / 100) : '—'} />
        <Dato label="Pobreza ext." valor={d.pobrezaExt != null ? pct(d.pobrezaExt / 100) : '—'} />
        <Dato label="IDH" valor={d.idh != null ? d.idh.toFixed(1) : '—'} />
        <Dato label="Altitud" valor={d.altitud != null ? `${num(d.altitud)} msnm` : '—'} />
        <Dato label="Piso" valor={d.pisoNombre ?? '—'} />
      </dl>
      <div className="flex items-center gap-2 text-sm">
        <span className="text-xs text-slate-500 dark:text-slate-400">Riesgo climático:</span>
        {d.riesgoClim ? <RiesgoPill nivel={d.riesgoClim} /> : <span className="text-slate-400">—</span>}
      </div>
      <p className="text-[11px] text-slate-400">
        PIM por ejecutora agregado al distrito (MEF, {`nivel filtrado`}). Indicadores reales PNUD/INEI. Riesgo a nivel
        departamental. <Pill tone="warn">aprox.</Pill>
      </p>
    </div>
  )
}

function Dato({ label, valor }: { label: string; valor: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="font-medium text-slate-800 dark:text-slate-100">{valor}</dd>
    </div>
  )
}
