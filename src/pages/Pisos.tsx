import { useMemo, useState } from 'react'
import { useAsync } from '../lib/useAsync'
import {
  getGeoJSON,
  getAltitudes,
  getPorDistrito,
  getMeta,
  loadJSON,
} from '../lib/data'
import type { AltitudDistrito, IndicadorDistrito, Meta, PorDistrito } from '../lib/types'
import { clasificarPiso, TODOS_PISOS, type Piso } from '../lib/pisos'
import {
  Card,
  CardHeader,
  HelpTip,
  KPI,
  Pill,
  Select,
  Loading,
  ErrorBox,
  SectionIntro,
} from '../components/ui'
import { Chart } from '../components/Chart'
import MapaDistrital, { type MapValue } from '../components/MapaDistrital'
import YearStrip from '../components/YearStrip'
import CortesPisos from '../components/CortesPisos'
import { soles, solesCompact, num, pct } from '../lib/format'
import { downloadCSV } from '../lib/download'

interface PisoFeature {
  IDDIST: string
  NOMBDIST: string
  NOMBDEP: string
}

interface FilaPiso {
  piso: Piso
  nDistritos: number
  pob: number
  tienePob: boolean
  pim: number
  devengado: number
  conPresupuesto: number
}

interface FilaDistritoPiso {
  ubigeo: string
  nombre: string
  depto: string
  pisoId: string
  piso: string
  altitud: number | null
  pob: number | null
}

// Poblaciones base de referencia para el per cápita legible.
const BASES_POBLACION: { value: number; label: string }[] = [
  { value: 1000, label: 'por cada 1,000 habitantes' },
  { value: 10000, label: 'por cada 10,000 habitantes' },
  { value: 100000, label: 'por cada 100,000 habitantes' },
]

export default function Pisos() {
  const geoRes = useAsync<unknown>(() => getGeoJSON(), [])
  const altRes = useAsync<AltitudDistrito[]>(() => getAltitudes(), [])
  const metaRes = useAsync<Meta>(() => getMeta(), [])
  const indRes = useAsync<IndicadorDistrito[]>(
    () => loadJSON<IndicadorDistrito[]>('indicadores-distrito.json'),
    [],
  )

  // Años CON detalle distrital (los únicos que sirven para la equidad presupuesto-población).
  // OJO: NO usar latestYear (puede ser 2026, que aún no tiene detalle distrital).
  const distYears = useMemo(() => {
    const ys = metaRes.data?.distritoYears
    return ys?.length ? [...ys].sort((a, b) => b - a) : [2025]
  }, [metaRes.data])
  const [yearSel, setYearSel] = useState<number | undefined>(undefined)
  const year = yearSel ?? distYears[0]
  const distRes = useAsync<PorDistrito[]>(
    () => (year ? getPorDistrito(year) : Promise.resolve([])),
    [year],
  )

  // Población base elegida por el usuario (escala del per cápita legible).
  const [base, setBase] = useState<number>(10000)

  // --- Mapas auxiliares por ubigeo6 ---
  const altPorUbigeo = useMemo(() => {
    const m = new Map<string, number>()
    for (const a of altRes.data ?? []) m.set(a.ubigeo, a.altitud)
    return m
  }, [altRes.data])

  const indPorUbigeo = useMemo(() => {
    const m = new Map<string, IndicadorDistrito>()
    for (const i of indRes.data ?? []) m.set(i.ubigeo, i)
    return m
  }, [indRes.data])

  const distPorUbigeo = useMemo(() => {
    const m = new Map<string, PorDistrito>()
    for (const d of distRes.data ?? []) m.set(d.ubigeo, d)
    return m
  }, [distRes.data])

  // --- Clasificar cada distrito del geojson a su piso (join por IDDIST) ---
  // La altitud preferente es la de indicadores-distrito (reales por ubigeo);
  // fallback a la capa de altitudes.
  const pisoPorUbigeo = useMemo(() => {
    const m = new Map<string, Piso>()
    const geo = geoRes.data as { features?: { properties?: PisoFeature }[] } | undefined
    if (!geo?.features) return m
    for (const f of geo.features) {
      const p = f.properties
      if (!p?.IDDIST) continue
      const alt = indPorUbigeo.get(p.IDDIST)?.altitud ?? altPorUbigeo.get(p.IDDIST)
      const piso = clasificarPiso(alt, p.NOMBDEP ?? '')
      if (piso) m.set(p.IDDIST, piso)
    }
    return m
  }, [geoRes.data, altPorUbigeo, indPorUbigeo])

  // --- Lista de distritos con su piso (para el explorador "distritos por piso" + descarga) ---
  const distritosLista = useMemo<FilaDistritoPiso[]>(() => {
    const geo = geoRes.data as { features?: { properties?: PisoFeature }[] } | undefined
    const out: FilaDistritoPiso[] = []
    if (!geo?.features) return out
    for (const f of geo.features) {
      const p = f.properties
      if (!p?.IDDIST) continue
      const piso = pisoPorUbigeo.get(p.IDDIST)
      if (!piso) continue
      const ind = indPorUbigeo.get(p.IDDIST)
      out.push({
        ubigeo: p.IDDIST,
        nombre: p.NOMBDIST || p.IDDIST,
        depto: p.NOMBDEP || '',
        pisoId: piso.id,
        piso: piso.nombre,
        altitud: ind?.altitud ?? null,
        pob: ind?.pob ?? null,
      })
    }
    return out.sort((a, b) => a.depto.localeCompare(b.depto, 'es') || a.nombre.localeCompare(b.nombre, 'es'))
  }, [geoRes.data, pisoPorUbigeo, indPorUbigeo])

  // --- values para el mapa coloreado por piso ---
  const mapValues = useMemo(() => {
    const m = new Map<string, MapValue>()
    const geo = geoRes.data as { features?: { properties?: PisoFeature }[] } | undefined
    if (!geo?.features) return m
    for (const f of geo.features) {
      const ubi = f.properties?.IDDIST
      if (!ubi) continue
      const piso = pisoPorUbigeo.get(ubi)
      if (!piso) continue
      const alt = indPorUbigeo.get(ubi)?.altitud ?? altPorUbigeo.get(ubi)
      const altTxt = alt !== undefined ? `${num(alt)} msnm` : 's/d'
      m.set(ubi, {
        value: TODOS_PISOS.findIndex((p) => p.id === piso.id),
        color: piso.color,
        label: `${piso.nombre} · ${altTxt}`,
      })
    }
    return m
  }, [geoRes.data, pisoPorUbigeo, altPorUbigeo, indPorUbigeo])

  // --- Agregado presupuestal + distritos + población por piso ---
  const filas = useMemo<FilaPiso[]>(() => {
    const baseMap = new Map<string, FilaPiso>()
    for (const p of TODOS_PISOS) {
      baseMap.set(p.id, {
        piso: p,
        nDistritos: 0,
        pob: 0,
        tienePob: false,
        pim: 0,
        devengado: 0,
        conPresupuesto: 0,
      })
    }
    for (const [ubi, piso] of pisoPorUbigeo) {
      const fila = baseMap.get(piso.id)
      if (!fila) continue
      fila.nDistritos += 1
      const ind = indPorUbigeo.get(ubi)
      if (ind?.pob) {
        fila.pob += ind.pob
        fila.tienePob = true
      }
      const d = distPorUbigeo.get(ubi)
      if (d) {
        fila.pim += d.pim
        fila.devengado += d.devengado
        fila.conPresupuesto += 1
      }
    }
    // Orden costa→cordillera→selva (orden de TODOS_PISOS)
    return TODOS_PISOS.map((p) => baseMap.get(p.id)!).filter((f) => f.nDistritos > 0)
  }, [pisoPorUbigeo, indPorUbigeo, distPorUbigeo])

  const hayPresupuesto = useMemo(() => filas.some((f) => f.pim > 0), [filas])
  const hayPoblacion = useMemo(() => filas.some((f) => f.tienePob && f.pob > 0), [filas])

  const pimTotal = useMemo(() => filas.reduce((s, f) => s + f.pim, 0), [filas])
  const pobTotal = useMemo(() => filas.reduce((s, f) => s + f.pob, 0), [filas])

  // KPIs altoandino (Puna+Janca), costa (Chala), selva (Alta+Baja) — per cápita.
  const kpi = useMemo(() => {
    const agreg = (ids: string[]) => {
      const fs = filas.filter((f) => ids.includes(f.piso.id))
      const pim = fs.reduce((s, f) => s + f.pim, 0)
      const pob = fs.reduce((s, f) => s + f.pob, 0)
      return { pim, pob, perCapita: pob > 0 ? pim / pob : null }
    }
    return {
      altoandino: agreg(['puna', 'janca']),
      costa: agreg(['chala']),
      selva: agreg(['selva_alta', 'selva_baja']),
    }
  }, [filas])

  // --- Estados de carga / error (bloqueantes: geojson + meta) ---
  if (geoRes.loading || metaRes.loading || (altRes.loading && indRes.loading))
    return <Loading label="Cargando pisos altitudinales…" />
  if (geoRes.error) return <ErrorBox error={geoRes.error} />
  if (metaRes.error) return <ErrorBox error={metaRes.error} />
  if (!geoRes.data || !metaRes.data) return <Loading />
  if (pisoPorUbigeo.size === 0)
    return (
      <ErrorBox error="No se pudo clasificar ningún distrito por piso altitudinal (sin datos de altitud)." />
    )

  const baseLabel = BASES_POBLACION.find((b) => b.value === base)?.label ?? ''

  // PIM por cada N habitantes (escala legible elegida por el usuario).
  const pimPorBase = (f: FilaPiso): number | null =>
    f.tienePob && f.pob > 0 ? (f.pim / f.pob) * base : null

  // ---------- Opciones ECharts ----------

  // GRÁFICO DE EQUIDAD (clave): % población vs % presupuesto por piso.
  const optEquidad = {
    grid: { left: 8, right: 16, bottom: 8, top: 36, containLabel: true },
    legend: { top: 4, data: ['% Población', '% Presupuesto (PIM)'] },
    tooltip: {
      trigger: 'axis' as const,
      formatter: (params: { name: string; seriesName: string; value: number }[]) => {
        const head = params[0]?.name ?? ''
        const body = params
          .map((p) => `${p.seriesName}: ${p.value.toFixed(1)}%`)
          .join('<br/>')
        return `${head}<br/>${body}`
      },
    },
    xAxis: {
      type: 'category' as const,
      data: filas.map((f) => f.piso.nombre),
      axisLabel: { interval: 0, rotate: 28, fontSize: 10 },
    },
    yAxis: {
      type: 'value' as const,
      axisLabel: { formatter: (v: number) => `${v}%` },
    },
    series: [
      {
        name: '% Población',
        type: 'bar' as const,
        barGap: '10%',
        data: filas.map((f) => ({
          value: pobTotal > 0 ? (f.pob / pobTotal) * 100 : 0,
          itemStyle: { color: '#64748b' },
        })),
        barMaxWidth: 26,
      },
      {
        name: '% Presupuesto (PIM)',
        type: 'bar' as const,
        data: filas.map((f) => ({
          value: pimTotal > 0 ? (f.pim / pimTotal) * 100 : 0,
          itemStyle: { color: f.piso.color },
        })),
        barMaxWidth: 26,
      },
    ],
  }

  // Barras de PIM per cápita por piso, ordenadas, color por piso.
  const filasPerCapita = [...filas]
    .filter((f) => f.tienePob && f.pob > 0 && f.pim > 0)
    .sort((a, b) => b.pim / b.pob - a.pim / a.pob)

  const optPerCapita = {
    grid: { left: 8, right: 24, bottom: 8, top: 16, containLabel: true },
    tooltip: {
      trigger: 'axis' as const,
      formatter: (params: { name: string; value: number }[]) => {
        const p = params[0]
        return `${p.name}<br/>PIM ${baseLabel}: ${soles(p.value)}`
      },
    },
    xAxis: {
      type: 'value' as const,
      axisLabel: { formatter: (v: number) => solesCompact(v) },
    },
    yAxis: {
      type: 'category' as const,
      data: filasPerCapita.map((f) => f.piso.nombre),
      inverse: true,
    },
    series: [
      {
        type: 'bar' as const,
        data: filasPerCapita.map((f) => ({
          value: (f.pim / f.pob) * base,
          itemStyle: { color: f.piso.color },
        })),
        barMaxWidth: 28,
      },
    ],
  }

  // Distribución de población por piso (si hay) o de distritos.
  const optDistribucion = {
    grid: { left: 8, right: 24, bottom: 8, top: 16, containLabel: true },
    tooltip: {
      trigger: 'axis' as const,
      formatter: (params: { name: string; value: number }[]) => {
        const p = params[0]
        return hayPoblacion
          ? `${p.name}<br/>${num(p.value)} habitantes`
          : `${p.name}<br/>${num(p.value)} distritos`
      },
    },
    xAxis: {
      type: 'value' as const,
      axisLabel: { formatter: (v: number) => num(v) },
    },
    yAxis: {
      type: 'category' as const,
      data: filas.map((f) => f.piso.nombre),
      inverse: true,
    },
    series: [
      {
        type: 'bar' as const,
        data: filas.map((f) => ({
          value: hayPoblacion ? f.pob : f.nDistritos,
          itemStyle: { color: f.piso.color },
        })),
        barMaxWidth: 28,
        label: {
          show: true,
          position: 'right' as const,
          formatter: (p: { value: number }) => num(p.value),
        },
      },
    ],
  }

  return (
    <div className="space-y-5">
      <SectionIntro title="Inteligencia territorial · Equidad presupuesto–población por piso">
        El Perú no es un país plano: su territorio se organiza en{' '}
        <strong>regiones naturales según la altitud</strong>. Aquí cruzamos esa geografía
        con la población real y el presupuesto público para responder una pregunta de
        equidad que casi nadie hace:{' '}
        <em>¿cada piso altitudinal recibe presupuesto en proporción a la gente que vive en él?</em>
      </SectionIntro>

      <DistritosPorPiso lista={distritosLista} />

      {/* 1. Metodología explícita + selector de población base */}
      <Card>
        <CardHeader
          title="Metodología: cómo clasificamos y cómo leemos el per cápita"
          subtitle="Javier Pulgar Vidal · 8 regiones naturales · enfoque poblacional"
          right={<Pill tone="warn">aprox.</Pill>}
          help={
            <HelpTip>
              «Población base» solo cambia la escala de lectura del per cápita: el orden y
              las proporciones entre pisos no cambian, pero las cifras se vuelven legibles
              (S/ por cada 1,000 / 10,000 / 100,000 habitantes).
            </HelpTip>
          }
        />
        <div className="text-sm text-zinc-600 dark:text-zinc-300 space-y-2 px-1">
          <p>
            Usamos la clasificación clásica de <strong>Javier Pulgar Vidal</strong> («Las
            ocho regiones naturales del Perú», 1941): Chala, Yunga, Quechua, Suni, Puna,
            Janca, más Selva Alta y Selva Baja.
          </p>
          <p>
            <Pill tone="warn">MVP</Pill> A cada distrito le asignamos su{' '}
            <strong>piso DOMINANTE según la altitud de su capital</strong>, no la
            composición porcentual real por modelo de elevación (DEM). Un distrito
            altoandino con valles bajos puede tener varios pisos a la vez; la composición %
            real por DEM va en el roadmap. La frontera amazónica (Selva Alta/Baja) se
            discrimina además por departamento.
          </p>
          <p>
            <strong>Enfoque poblacional:</strong> sumamos la población real por distrito
            (INEI, vía indicadores distritales) y la comparamos con el PIM. Para que el per
            cápita sea legible, elige una <strong>población base de referencia</strong> y
            expresamos el presupuesto como <strong>S/ {baseLabel}</strong>.
          </p>
          <div className="pt-1 flex flex-wrap items-center gap-4">
            <Select
              label="Población base:"
              value={base}
              onChange={setBase}
              options={BASES_POBLACION.map((b) => ({
                value: b.value,
                label: b.label.replace('por cada ', ''),
              }))}
            />
            <div className="min-w-[180px] flex-1">
              <YearStrip years={distYears} value={year} onChange={setYearSel} label="Año presup." />
            </div>
          </div>
          <p className="text-xs text-zinc-500">
            Fuentes: altitud y población distritales (INEI / SIAF-MEF). La clasificación
            piso↔distrito es una <strong>aproximación metodológica comparativa</strong>, no
            un dato oficial cerrado. Las cifras per cápita sirven para comparar pisos entre
            sí, no como gasto exacto por persona.
          </p>
          <div className="pt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            <a href="#/metodologia" className="text-brand-600 hover:underline decoration-dotted">
              → Metodología completa y glosario
            </a>
            <a
              href="https://unimauro.github.io/qhaway-observatorio-2026/entregables/QHAWAY_PROPUESTA.pdf"
              target="_blank"
              rel="noreferrer"
              className="text-brand-600 hover:underline decoration-dotted"
            >
              → Documento de la propuesta (PDF)
            </a>
          </div>
        </div>
      </Card>

      {/* 2. Mapa coloreado por piso + leyenda */}
      <Card>
        <CardHeader
          title="Mapa del Perú por piso altitudinal"
          subtitle={`${num(pisoPorUbigeo.size)} distritos clasificados`}
          help={
            <HelpTip>
              Cada distrito se pinta con el color de su piso dominante (no por monto de
              dinero). Pasa el cursor para ver el piso y la altitud de su capital en msnm.
              No interpretes la intensidad como presupuesto: aquí el color = geografía.
            </HelpTip>
          }
        />
        <MapaDistrital
          geojson={geoRes.data}
          values={mapValues}
          unitLabel="Piso"
          formatValue={(v) => TODOS_PISOS[v]?.nombre ?? '—'}
          height={520}
        />
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 px-1">
          {TODOS_PISOS.map((p) => (
            <div key={p.id} className="flex items-center gap-2 text-xs">
              <span
                className="inline-block w-3 h-3 rounded-sm shrink-0 border border-black/10"
                style={{ backgroundColor: p.color }}
              />
              <span className="text-zinc-700 dark:text-zinc-300">
                <span className="font-medium">{p.nombre}</span>
                <br />
                <span className="text-zinc-400">
                  {p.min === p.max ? `${num(p.min)}` : `${num(p.min)}–${num(p.max)}`} msnm
                </span>
              </span>
            </div>
          ))}
        </div>
      </Card>

      {/* 2c. Cortes por ámbito territorial: departamento y provincia (pedido de FIEECS) */}
      <Card>
        <CardHeader
          title="Cortes por ámbito: departamento y provincia"
          subtitle="Recalcula el cruce piso × presupuesto × población solo para los distritos del ámbito elegido"
          right={<Pill tone="brand">filtra</Pill>}
          help={
            <HelpTip>
              Elige un departamento (y opcionalmente una provincia) para ver qué pisos
              altitudinales existen en ese ámbito, su PIM, su población y el per cápita,
              recalculados solo con sus distritos. Función y categoría presupuestal NO se
              cortan aquí porque el gasto distrital no las trae (ver chips).
            </HelpTip>
          }
        />
        <div className="px-1 pb-2">
          <CortesPisos />
        </div>
      </Card>

      {hayPresupuesto ? (
        <>
          {/* 4. KPIs de equidad per cápita */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <KPI
              label={`PIM per cápita altoandino (Puna + Janca) · ${baseLabel}`}
              value={kpi.altoandino.perCapita !== null ? soles(kpi.altoandino.perCapita * base) : 's/d'}
              sub={
                kpi.costa.perCapita !== null && kpi.altoandino.perCapita !== null
                  ? `${(kpi.altoandino.perCapita / kpi.costa.perCapita).toFixed(2)}× vs costa (Chala)`
                  : `Año ${year}`
              }
              accent
            />
            <KPI
              label={`PIM per cápita costa (Chala) · ${baseLabel}`}
              value={kpi.costa.perCapita !== null ? soles(kpi.costa.perCapita * base) : 's/d'}
              sub={`Año ${year}`}
            />
            <KPI
              label={`PIM per cápita amazónico (Selva Alta + Baja) · ${baseLabel}`}
              value={kpi.selva.perCapita !== null ? soles(kpi.selva.perCapita * base) : 's/d'}
              sub={`Año ${year}`}
            />
          </div>
          <Card>
            <div className="text-sm text-zinc-600 dark:text-zinc-300 space-y-2 px-1">
              <p>
                <Pill tone="warn">lectura honesta</Pill> El per cápita altoandino suele ser{' '}
                <strong>mayor</strong> que el de la costa, pero eso{' '}
                <strong>no significa «privilegio»</strong>: en la puna hay pocos habitantes
                muy dispersos, por lo que prestar el mismo servicio cuesta más por persona.
                Un per cápita alto puede reflejar costo de provisión, no abundancia. Y un
                per cápita bajo en un piso muy poblado no implica necesariamente injusticia.
                Lee estas cifras como <strong>comparativas y aproximadas</strong>, no como
                un veredicto oficial de equidad.
              </p>
            </div>
          </Card>

          {/* 3. GRÁFICO DE EQUIDAD (clave) */}
          <Card>
            <CardHeader
              title="Equidad: % de población vs % de presupuesto por piso"
              subtitle={`Población (INEI) vs PIM ${year}`}
              right={<Pill tone="warn">comparativo</Pill>}
              help={
                <HelpTip>
                  Por cada piso comparamos dos barras: la gris es el % de la población
                  nacional clasificada que vive en ese piso; la de color es el % del PIM
                  nacional clasificado que recibe.{' '}
                  <strong>Si la barra de presupuesto es MENOR que la de población</strong>,
                  ese piso está subfinanciado per cápita (recibe proporcionalmente menos
                  dinero que gente tiene). Si es mayor, recibe proporcionalmente más. No mide
                  eficiencia ni necesidad, solo proporción.
                </HelpTip>
              }
            />
            <Chart option={optEquidad} height={Math.max(280, filas.length * 38)} />
          </Card>

          {/* 2b. Tabla por piso (cruce completo con enfoque poblacional) */}
          <Card>
            <CardHeader
              title="Presupuesto y población por piso: el cruce completo"
              subtitle={`Año ${year}`}
              right={<Pill tone="warn">piso por altitud de capital</Pill>}
              help={
                <HelpTip>
                  Cruzamos pisos (geografía), población (INEI) y PIM (SIAF). «% pob.» y «%
                  PIM» son la cuota de cada piso sobre el total clasificado. «PIM per cápita»
                  = PIM ÷ población; «PIM {baseLabel}» reescala ese per cápita a la población
                  base elegida. Donde no hay población, la celda muestra «s/d».
                </HelpTip>
              }
            />
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-zinc-500 border-b border-zinc-200 dark:border-zinc-700">
                    <th className="py-2 pr-3">Piso</th>
                    <th className="py-2 px-3 text-right">Distritos</th>
                    <th className="py-2 px-3 text-right">Población</th>
                    <th className="py-2 px-3 text-right">% pob.</th>
                    <th className="py-2 px-3 text-right">PIM</th>
                    <th className="py-2 px-3 text-right">% PIM</th>
                    <th className="py-2 px-3 text-right">PIM per cápita</th>
                    <th className="py-2 pl-3 text-right">PIM {baseLabel}</th>
                  </tr>
                </thead>
                <tbody>
                  {filas.map((f) => {
                    const perCapita = f.tienePob && f.pob > 0 ? f.pim / f.pob : null
                    const pctPob = pobTotal > 0 ? f.pob / pobTotal : null
                    const pctPim = pimTotal > 0 ? f.pim / pimTotal : null
                    const escala = pimPorBase(f)
                    // Señal de equidad: PIM% por debajo de Pob% => subfinanciado per cápita.
                    const subfinanciado =
                      pctPob !== null && pctPim !== null && f.pob > 0 && pctPim < pctPob
                    return (
                      <tr
                        key={f.piso.id}
                        className="border-b border-zinc-100 dark:border-zinc-800 last:border-0"
                      >
                        <td className="py-2 pr-3">
                          <span className="inline-flex items-center gap-2">
                            <span
                              className="inline-block w-3 h-3 rounded-sm border border-black/10"
                              style={{ backgroundColor: f.piso.color }}
                            />
                            <span className="font-medium text-zinc-700 dark:text-zinc-200">
                              {f.piso.nombre}
                            </span>
                          </span>
                        </td>
                        <td className="py-2 px-3 text-right tabular-nums">{num(f.nDistritos)}</td>
                        <td className="py-2 px-3 text-right tabular-nums">
                          {f.tienePob ? num(f.pob) : <span className="text-zinc-400">s/d</span>}
                        </td>
                        <td className="py-2 px-3 text-right tabular-nums">
                          {pctPob !== null ? pct(pctPob) : <span className="text-zinc-400">s/d</span>}
                        </td>
                        <td className="py-2 px-3 text-right tabular-nums">{solesCompact(f.pim)}</td>
                        <td className="py-2 px-3 text-right tabular-nums">
                          {pctPim !== null ? (
                            <span
                              className="font-medium"
                              style={{ color: subfinanciado ? '#f59e0b' : undefined }}
                              title={
                                subfinanciado
                                  ? 'PIM% por debajo de Población% (subfinanciado per cápita)'
                                  : undefined
                              }
                            >
                              {pct(pctPim)}
                            </span>
                          ) : (
                            <span className="text-zinc-400">s/d</span>
                          )}
                        </td>
                        <td className="py-2 px-3 text-right tabular-nums">
                          {perCapita !== null ? soles(perCapita) : <span className="text-zinc-400">s/d</span>}
                        </td>
                        <td className="py-2 pl-3 text-right tabular-nums">
                          {escala !== null ? soles(escala) : <span className="text-zinc-400">s/d</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t border-zinc-300 dark:border-zinc-600 font-medium">
                    <td className="py-2 pr-3">Total</td>
                    <td className="py-2 px-3 text-right tabular-nums">
                      {num(filas.reduce((s, f) => s + f.nDistritos, 0))}
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums">{num(pobTotal)}</td>
                    <td className="py-2 px-3 text-right tabular-nums">{pobTotal > 0 ? '100%' : ''}</td>
                    <td className="py-2 px-3 text-right tabular-nums">{solesCompact(pimTotal)}</td>
                    <td className="py-2 px-3 text-right tabular-nums">{pimTotal > 0 ? '100%' : ''}</td>
                    <td className="py-2 px-3 text-right tabular-nums">
                      {pobTotal > 0 ? soles(pimTotal / pobTotal) : ''}
                    </td>
                    <td className="py-2 pl-3 text-right tabular-nums">
                      {pobTotal > 0 ? soles((pimTotal / pobTotal) * base) : ''}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="mt-2 px-1 text-xs text-zinc-500">
              El número en{' '}
              <span className="font-medium text-amber-600 dark:text-amber-400">ámbar</span> en «%
              PIM» marca pisos cuyo porcentaje de presupuesto es menor que su porcentaje de
              población (señal de posible subfinanciamiento per cápita).
            </p>
          </Card>

          {/* 5. Barras de PIM per cápita por piso (ordenadas) */}
          {filasPerCapita.length > 0 && (
            <Card>
              <CardHeader
                title={`PIM per cápita por piso · ${baseLabel}`}
                subtitle="Ordenado de mayor a menor"
                help={
                  <HelpTip>
                    PIM ÷ población, reescalado a la población base elegida. Pisos con poca
                    gente muy dispersa (puna, janca) tienden a un per cápita alto porque el
                    costo de servir a cada persona es mayor; no lo leas como «más privilegio».
                    Compara entre pisos, no como gasto exacto por persona.
                  </HelpTip>
                }
              />
              <Chart option={optPerCapita} height={Math.max(220, filasPerCapita.length * 44)} />
            </Card>
          )}
        </>
      ) : (
        <Card>
          <CardHeader
            title="Presupuesto por piso"
            right={<Pill tone="warn">datos de presupuesto distrital en proceso</Pill>}
          />
          <div className="text-sm text-zinc-600 dark:text-zinc-300 px-1">
            {distRes.loading
              ? 'Cargando presupuesto distrital…'
              : 'Aún no hay presupuesto distrital cargado para el último año (los datos de presupuesto distrital están en proceso). Mientras tanto se muestran el mapa de pisos, la población por piso y la distribución de distritos. El análisis de equidad presupuesto–población aparecerá cuando el archivo por-distrito esté disponible.'}
          </div>
        </Card>
      )}

      {/* 6. Distribución de población (o distritos) por piso */}
      <Card>
        <CardHeader
          title={hayPoblacion ? '¿Cuánta gente vive en cada piso?' : '¿Cuántos distritos hay en cada piso?'}
          subtitle={
            hayPoblacion
              ? 'Población clasificada por región natural (INEI)'
              : 'Distribución del territorio por región natural'
          }
          help={
            <HelpTip>
              {hayPoblacion
                ? 'Población total clasificada en cada piso. La costa (Chala) concentra la mayor parte de la población; la puna y la janca, muy poca. Esta concentración es clave para leer el per cápita: pocos habitantes elevan el costo por persona.'
                : 'Número de distritos clasificados en cada piso (no es población ni área). Muestra dónde se concentra la división política del país a lo largo de la gradiente altitudinal. La etiqueta a la derecha es el conteo.'}
            </HelpTip>
          }
        />
        <Chart option={optDistribucion} height={Math.max(220, filas.length * 44)} />
      </Card>
    </div>
  )
}

// ───────────────────────── Distritos por piso (explorador + descarga CSV) ─────────────────────────
function DistritosPorPiso({ lista }: { lista: FilaDistritoPiso[] }) {
  const [pisoSel, setPisoSel] = useState<string>('all')
  const [query, setQuery] = useState('')

  const pisoOpts = useMemo(
    () => [{ value: 'all', label: 'Todos los pisos' }, ...TODOS_PISOS.map((p) => ({ value: p.id, label: p.nombre }))],
    [],
  )
  const q = query.trim().toLowerCase()
  const filtradas = useMemo(
    () =>
      lista.filter(
        (d) =>
          (pisoSel === 'all' || d.pisoId === pisoSel) &&
          (!q || d.nombre.toLowerCase().includes(q) || d.depto.toLowerCase().includes(q)),
      ),
    [lista, pisoSel, q],
  )
  const visibles = filtradas.slice(0, 400)

  const descargar = () =>
    downloadCSV(
      `qhaway-distritos-por-piso${pisoSel !== 'all' ? '-' + pisoSel : ''}`,
      [
        { key: 'ubigeo', label: 'UBIGEO' },
        { key: 'nombre', label: 'Distrito' },
        { key: 'depto', label: 'Departamento' },
        { key: 'piso', label: 'Piso altitudinal' },
        { key: 'altitud', label: 'Altitud (msnm)' },
        { key: 'pob', label: 'Poblacion' },
      ],
      filtradas.map((d) => ({ ...d, altitud: d.altitud != null ? Math.round(d.altitud) : '', pob: d.pob ?? '' })),
    )

  return (
    <Card>
      <CardHeader
        title="Distritos por piso altitudinal"
        subtitle="¿Qué distritos son Chala, Yunga, Quechua, Suni, Puna, Janca o Selva? Filtra, busca y descarga."
        right={<Pill tone="neutral">{num(filtradas.length)} distritos</Pill>}
        help={
          <HelpTip>
            Clasificación por la altitud de la capital de cada distrito (Pulgar Vidal), aproximación
            metodológica. La selva se discrimina además por departamento. Descarga la lista en CSV
            (abre en Excel) para tus informes o tesis.
          </HelpTip>
        }
      />
      <div className="flex flex-wrap items-end gap-3 px-4 pb-2">
        <Select<string> value={pisoSel} onChange={setPisoSel} options={pisoOpts} label="Piso" />
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium uppercase tracking-wide text-ink-400">Buscar</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Distrito o departamento…"
            className="rounded-lg border border-ink-200 dark:border-ink-800 bg-white dark:bg-ink-950 px-3 py-1.5 text-sm outline-none focus:border-brand-500"
          />
        </label>
        <button
          onClick={descargar}
          className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-brand-700"
        >
          ⬇ Descargar CSV
        </button>
      </div>
      <div className="px-4 pb-4">
        <div className="max-h-[460px] overflow-auto rounded-lg border border-ink-200 dark:border-ink-800">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-ink-50 dark:bg-ink-900">
              <tr className="text-xs text-ink-500 dark:text-ink-400">
                <th className="py-2 px-2 text-left">Distrito</th>
                <th className="py-2 px-2 text-left">Departamento</th>
                <th className="py-2 px-2 text-left">Piso</th>
                <th className="py-2 px-2 text-right">Altitud</th>
                <th className="py-2 px-2 text-right">Población</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((d) => (
                <tr key={d.ubigeo} className="border-t border-ink-100 dark:border-ink-800/60">
                  <td className="py-1.5 px-2 font-medium text-ink-800 dark:text-ink-100">{d.nombre}</td>
                  <td className="py-1.5 px-2 text-ink-500 dark:text-ink-400">{d.depto}</td>
                  <td className="py-1.5 px-2">{d.piso}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums">{d.altitud != null ? `${num(Math.round(d.altitud))} m` : '—'}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums">{d.pob != null ? num(d.pob) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filtradas.length > visibles.length && (
          <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
            Mostrando 400 de {num(filtradas.length)}. Afina el filtro o descarga el CSV para la lista completa.
          </p>
        )}
      </div>
    </Card>
  )
}
